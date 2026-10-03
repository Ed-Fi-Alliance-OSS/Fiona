# Implementation Plan: Fiona Chat TUI (local prompt/model test harness)

## Overview

A small, terminal-based chat loop for developers to talk to Fiona without deploying the Slack app. It calls
`callLLM` from `apps/fiona-slack/src/agent/llm-caller.js` directly, keeps conversation history only in process
memory, and exits without persisting anything. The point is a fast edit → `/reload` → ask cycle when tuning the system
prompt or the Perplexity model.

## What the code already gives us

- `callLLM(streamer, prompts, logger)` only needs a `streamer` object with an async `append({ markdown_text })`, an
  OpenAI-style `prompts` array (`{ role, content }`, system prompt is prepended for us), and a logger with `.error`.
- It returns `{ metadata, botText, systemPromptVersion }`; `metadata.sources` holds the normalized citations.
- `llm-caller.js` imports only the Perplexity SDK, `citation-telemetry.js` (in-memory counters), and
  `source-normalizer.js`. **No Cosmos, no interaction store.** Recording is done by the Slack listeners, which the TUI
  will never import.
- `SYSTEM_PROMPT`, `PERPLEXITY_API_MODEL`, and `PERPLEXITY_DOMAIN_FILTER` are read from `process.env` **at module
  load time**. Any CLI override has to set env vars *before* a dynamic `import()` of `llm-caller.js`.
- `assertLLMConfigured()` already gives a clean fail-fast when `PERPLEXITY_API_KEY` is missing.
- Precedent: `scripts/load-slack-users.js` shows the conventions this follows. It's a plain Node ESM script that loads
  `.env` via `dotenv`, parses `--flag=value` args, guards `main()` with `import.meta.url === pathToFileURL(argv[1])`,
  and is tested in `tests/scripts/` using `jest.unstable_mockModule`.

## Architecture Decisions

- **No new dependencies.** Use `node:readline/promises` for the input loop. "Simple TUI" means a line-oriented REPL, not
  a full-screen UI (ink/blessed). That keeps the supply-chain surface and lockfile churn at zero.
- **Location:** `apps/fiona-slack/scripts/chat-tui.js` (entry/REPL) + `apps/fiona-slack/scripts/chat-session.js`
  (pure, testable logic). An npm script `chat` runs it from `apps/fiona-slack`.
- **Console streamer adapter:** a tiny object with `append({ markdown_text })` that writes to stdout. Note that
  `callPerplexityChat` buffers the whole answer and calls `append` once, so output appears all at once. A "thinking…"
  indicator covers the wait. True token streaming would require changing `llm-caller.js`, which is out of scope.
- **History is in-memory only.** The session alternates `user` and `assistant` turns. If a call fails, the pending user
  turn is **not** committed, so history never ends up with two `user` turns in a row (Perplexity rejects that).
- **Overrides via env-before-import:** `--model`, `--system-prompt-file`, and `--domains` set `PERPLEXITY_API_MODEL` /
  `SYSTEM_PROMPT` / `PERPLEXITY_DOMAIN_FILTER`, then `await import('../src/agent/llm-caller.js')`. This avoids
  touching `llm-caller.js` at all.
- **`/reload` without restarting:** re-reads `--system-prompt-file` (if given) into `SYSTEM_PROMPT`, then re-imports
  `llm-caller.js` with a cache-busting query (`llm-caller.js?reload=<n>`) so edits to `DEFAULT_SYSTEM_PROMPT` in the
  source file are also picked up. Shared dependencies (SDK, telemetry, normalizer) stay cached, which is fine.
  Conversation history is kept across a reload; `/reset` clears it if wanted.
- **Lint scope unchanged:** `npm run lint` stays `src/`-only; new scripts are checked by running Biome on them directly.
- **Sources:** a numbered source list printed after each answer is the chosen display; inline `[[n]](url)` is left as-is.
- **"No recording" is enforced by a test,** not only by convention. A test walks the TUI's static import graph and
  fails if it reaches any `*-store.js`, `cosmos-utils.js`, `interaction-telemetry.js`, `@azure/*`, or `@slack/*` module.

## Task List

### Phase 1: Core session (testable without a terminal or API key)

- [x] Task 1: Chat session core + console streamer

### Phase 2: Runnable TUI

- [x] Task 2: Interactive REPL entry point + `npm run chat`
- [x] Task 3: Isolation guard test (no DB / Slack imports)

### Checkpoint: Usable harness

- [ ] `npm test` and `npm run lint` pass
- [ ] Manual: `npm run chat` answers a question with sources, then answers a follow-up that relies on history
- [ ] Review with human before proceeding

### Phase 3: Prompt/model iteration + docs

- [ ] Task 4: CLI overrides (`--model`, `--system-prompt-file`, `--domains`)
- [ ] Task 5: `/reload` command (hot-reload system prompt / `llm-caller.js`)
- [ ] Task 6: README documentation

### Checkpoint: Complete

- [ ] All acceptance criteria met; tests and lint pass
- [ ] Manual: same question gives visibly different behavior before and after editing the prompt and running `/reload`
- [ ] Ready for review

Detailed tasks: see `tasks/todo.md`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Someone later adds a store/telemetry import to `llm-caller.js`, and the TUI starts recording silently | High (violates core requirement) | Task 3 import-graph test fails CI if `llm-caller.js` (or the TUI) ever reaches a store/Cosmos/Slack module |
| `.env` holds Cosmos credentials that get loaded into the process | Low (nothing reads them) | Isolation test proves no consumer is imported; banner states "not recording" |
| Env overrides set after import are silently ignored | Med (confusing results when testing prompts) | Always dynamic-import after arg parsing; unit test asserts env is set before import; banner prints the *effective* model and prompt source |
| Output arrives all at once (no token streaming) | Low | "Thinking…" indicator; documented limitation |
| Perplexity rejects non-alternating history after an error | Med | Session commits the user turn only on success (Task 1 test) |
| `npm run lint` covers only `src/`, so new scripts aren't linted | Low | Run `npx @biomejs/biome check scripts/chat-tui.js scripts/chat-session.js` as a per-task verification step (decided: no lint scope change) |
| Cache-busted re-imports accumulate module instances | Low (dev tool, few reloads) | Accept; documented |
| Isolation test misses a cache-busted dynamic import | Med | Isolation test strips `?query` from specifiers and resolves template-literal imports of `llm-caller.js` |

## Resolved Questions

1. Hot reload: **yes**, as a `/reload` command (Task 5).
2. Widen lint to `scripts/`: **no**.
3. Numbered source list after each answer: **yes**, sufficient.
