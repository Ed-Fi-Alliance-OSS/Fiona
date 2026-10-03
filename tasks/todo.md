# Todo: Fiona Chat TUI

All paths are relative to `apps/fiona-slack/`. Commands run from that directory.

## Task 1: Chat session core + console streamer

**Description:** Create `scripts/chat-session.js` with the logic that doesn't need a terminal: a console streamer
adapter (`append({ markdown_text })` → injected `write` fn), a `createChatSession({ callLLM, streamer, logger })`
that keeps in-memory alternating history and exposes `send(text)` / `reset()` / `history`, and a
`formatSources(metadata)` helper that renders a numbered source list. `callLLM` is injected so tests need no SDK or
API key.

**Acceptance criteria:**

- [ ] `send(text)` calls `callLLM(streamer, [...history, { role: 'user', content: text }], logger)` and, on success,
      appends both the user and assistant (`botText`) turns to history
- [ ] On `callLLM` rejection, history is unchanged and the error propagates; `reset()` clears history
- [ ] `formatSources` returns `''` for no sources and `[n] title — url` lines otherwise

**Verification:**

- [ ] Tests pass: `npm test -- tests/scripts/chat-session.test.js`
- [ ] Lint: `npx @biomejs/biome check scripts/chat-session.js`

**Dependencies:** None

**Files likely touched:**

- `scripts/chat-session.js` (new, with license header)
- `tests/scripts/chat-session.test.js` (new)

**Estimated scope:** Small

## Task 2: Interactive REPL entry point + `npm run chat`

**Description:** Create `scripts/chat-tui.js`. It loads `.env` (same approach as `load-slack-users.js`), dynamically
imports `llm-caller.js`, calls `assertLLMConfigured()` (prints a friendly error and exits 1 if no key), prints a banner
(model, system prompt version/source, domain filter, "history is in memory only — nothing is recorded"), then runs a
`node:readline/promises` loop. Slash commands: `/reset`, `/history`, `/help`, `/exit` (plus Ctrl+C/Ctrl+D). It shows a
"thinking…" indicator while waiting and prints sources after each answer. Errors are printed and the loop keeps going.
`main()` is guarded so the module can be imported in tests. Add `"chat": "node scripts/chat-tui.js"` to `package.json`.

**Acceptance criteria:**

- [ ] `npm run chat` with a valid key starts a session. A follow-up question is answered using prior context.
- [ ] Missing `PERPLEXITY_API_KEY` exits with code 1 and a clear message, without a stack trace
- [ ] An API error (e.g. a bad model name) prints the error and returns to the prompt instead of crashing

**Verification:**

- [ ] Tests pass: `npm test -- tests/scripts/chat-tui.test.js` (command parsing and the missing-key path, with `llm-caller.js` mocked)
- [ ] Lint: `npx @biomejs/biome check scripts/chat-tui.js`
- [ ] Manual: two-turn conversation; `/reset` then the follow-up loses context; `/exit` leaves cleanly

**Dependencies:** Task 1

**Files likely touched:**

- `scripts/chat-tui.js` (new)
- `package.json`
- `tests/scripts/chat-tui.test.js` (new)

**Estimated scope:** Medium

## Task 3: Isolation guard test (no DB / Slack imports)

**Description:** Add a test that walks the static and dynamic relative-import graph starting from
`scripts/chat-tui.js` (reusing the regex approach in `tests/agent/layering.test.js`, extended to `import('…')`). It
asserts that no reachable module is a `*-store.js`, `cosmos-utils.js`, `interaction-telemetry.js`, or
`conversation-capture-store.js`, and that none imports `@azure/*` or `@slack/*`. This turns "the TUI must not record"
into a CI-enforced invariant.

**Acceptance criteria:**

- [ ] The test passes against the current code
- [ ] Temporarily adding `import './interaction-store.js'` to `llm-caller.js` makes the test fail with a message that
      names the offending path (check by hand, then revert)

**Verification:**

- [ ] Tests pass: `npm test -- tests/scripts/chat-tui.isolation.test.js`
- [ ] Full suite: `npm test`

**Dependencies:** Task 2

**Files likely touched:**

- `tests/scripts/chat-tui.isolation.test.js` (new)

**Estimated scope:** Small

## Checkpoint: Usable harness (after Tasks 1–3)

- [ ] `npm test` passes; `npm run lint` passes; new scripts pass Biome check
- [ ] Manual end-to-end: question with sources → history-dependent follow-up → `/reset` → `/exit`
- [ ] Human review before Phase 3

## Task 4: CLI overrides for prompt/model iteration

**Description:** Parse `--model=<name>`, `--system-prompt-file=<path>`, `--domains=<a,b>`, and `--help` in
`chat-tui.js` *before* importing `llm-caller.js`. Set `PERPLEXITY_API_MODEL`, `SYSTEM_PROMPT` (file contents), and
`PERPLEXITY_DOMAIN_FILTER` accordingly. CLI flags win over `.env`. The banner reports where the system prompt came
from (`file:<path>`, `env`, or `default (llm-caller.js)`) and the effective `LLM_MODEL` read back from the imported
module.

**Acceptance criteria:**

- [ ] Each flag sets its env var before `llm-caller.js` is imported (unit test checks env at mocked-import time)
- [ ] A missing or empty `--system-prompt-file` exits 1 with a clear message
- [ ] `--help` prints usage and exits 0 without importing `llm-caller.js` or requiring an API key

**Verification:**

- [ ] Tests pass: `npm test -- tests/scripts/chat-tui.test.js`
- [ ] Manual: `npm run chat -- --system-prompt-file=./tmp-prompt.txt --model=sonar-pro`. The banner reflects both, and
      the answers follow the custom prompt.

**Dependencies:** Task 2

**Files likely touched:**

- `scripts/chat-tui.js`
- `tests/scripts/chat-tui.test.js`

**Estimated scope:** Small

## Task 5: `/reload` command

**Description:** Add a `/reload` slash command so prompt changes can be tested without restarting. It re-reads the
`--system-prompt-file` (if one was given) into `process.env.SYSTEM_PROMPT`, then re-imports `llm-caller.js` with a
cache-busting query string (`../src/agent/llm-caller.js?reload=<counter>`), so edits to `DEFAULT_SYSTEM_PROMPT` in
the source file are picked up too. The session switches to the newly imported `callLLM`. History is kept; the
banner-style summary (model, prompt source, first line or char count of the prompt) is printed again so the developer
can confirm the change took effect. The model and domain overrides from the CLI stay in force.

**Acceptance criteria:**

- [ ] After editing the prompt file and running `/reload`, the next `send` uses the new prompt (unit test: the mocked
      `llm-caller.js` import is called again, and `SYSTEM_PROMPT` env holds the new file contents)
- [ ] If the reload fails (e.g. a syntax error in `llm-caller.js`, or the prompt file was deleted), the error is printed and
      the previous `callLLM` stays active
- [ ] `/help` lists `/reload`

**Verification:**

- [ ] Tests pass: `npm test -- tests/scripts/chat-tui.test.js`
- [ ] Isolation test still passes: `npm test -- tests/scripts/chat-tui.isolation.test.js` (update the walker to strip
      `?query` and handle the template-literal import if needed)
- [ ] Lint: `npx @biomejs/biome check scripts/chat-tui.js scripts/chat-session.js`
- [ ] Manual: ask a question, edit the prompt file (e.g. "always answer in French"), `/reload`, ask again, and confirm the behavior
      changed. Repeat by editing `DEFAULT_SYSTEM_PROMPT` in `llm-caller.js` with no prompt file.

**Dependencies:** Task 4

**Files likely touched:**

- `scripts/chat-tui.js`
- `scripts/chat-session.js` (allow swapping `callLLM`)
- `tests/scripts/chat-tui.test.js`
- `tests/scripts/chat-tui.isolation.test.js`

**Estimated scope:** Medium

## Task 6: README documentation

**Description:** Add a "Local chat harness (no Slack)" section to `apps/fiona-slack/README.md`. Cover what the harness
is for, `npm run chat`, the flags, the slash commands (including `/reload`), the guarantee that nothing is recorded, and the known
limitation that output isn't token-streamed. Add `scripts/chat-tui.js` to the Project Structure block.

**Acceptance criteria:**

- [ ] A new developer can run the harness from the README alone, needing only `PERPLEXITY_API_KEY`
- [ ] The README states explicitly that no Slack tokens or Cosmos DB settings are needed and that no conversation data
      is persisted

**Verification:**

- [ ] Manual: follow the README steps from a clean `.env` containing only `PERPLEXITY_API_KEY`

**Dependencies:** Task 5

**Files likely touched:**

- `README.md`

**Estimated scope:** XS

## Checkpoint: Complete

- [ ] All acceptance criteria met; `npm test` and `npm run lint` pass
- [ ] Manual: the same question gives visibly different answers before and after editing the prompt file and running `/reload`
- [ ] Ready for review / PR
