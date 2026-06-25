# AI-98 Issue-to-PR Pipeline — Feature Guide (Phases 1–4)

**Purpose:** explain the major features built in Phases 1–4 so reviewers can (a) judge usability/behavior, (b) compare each feature against its unit tests, and (c) merge with confidence. For build status and resume steps see `docs/AI-98-implementation-status.md`; for the "why" see the two specs under `docs/superpowers/specs/`.

**Audience:** engineers verifying/reviewing the pipeline. These are not end-user GUI features — they are the building blocks (auth, GitHub tools, the agent, the orchestrator) of an Azure Functions app.

**How to use this guide:** each feature lists what it does, its inputs/outputs, important behaviors/edge cases, and the **exact test cases** that cover it. Run `cd apps/issue-to-pr-function && npm test` (expect **80 passing**) and `npm run lint` (clean) to reproduce.

---

## 0. Configuration (environment variables)
The app reads these (set via Key Vault references / app settings in prod, `local.settings.json` locally):

| Var | Used by | Notes |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | webhook receiver | HMAC-SHA256 validation |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_ID` | `github-client.js` | App auth → installation token |
| `ANTHROPIC_FOUNDRY_BASE_URL`, `CLAUDE_DEPLOYMENT_NAME` | `foundry-client.js` | Claude-on-Foundry; auth is managed-identity Entra ID (no key) |
| `COSMOS_ENDPOINT` | `run-store.js` | `agent-runs` tracking; `DefaultAzureCredential` |
| `SLACK_WEBHOOK_URL` | `PostSlackNotification` | informational only |

---

## 1. GitHub App authentication — `src/lib/github-client.js`
**Feature:** `getInstallationToken(owner, repo)` → a short-lived GitHub installation token, transparently cached.

- **Behavior:** builds an RS256 JWT with `node:crypto` (no JWT library); looks up the installation with a single `GET /repos/{owner}/{repo}/installation`; exchanges it at `POST /app/installations/{id}/access_tokens`. Caches per `owner/repo`, reusing the token until **60 s before** `expires_at`, then refreshing.
- **Usability:** callers just `await getInstallationToken(owner, repo)`; no JWT/refresh handling leaks out. All GitHub calls carry `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28`.
- **Errors:** descriptive throws on a malformed private key and on installation-not-found (404).

**Tests** (`test/github-client.test.js`): returns a token on success · caches (fetch once for two in-window calls) · refreshes within 60 s of expiry · throws on malformed key · throws on 404 installation.

**Webhook signature** (`src/lib/webhook-validator.js`, scaffold) — `validateWebhookSignature` is constant-time HMAC-SHA256. Tests (`test/webhook-validator.test.js`): valid sig true · wrong secret false · tampered body false · undefined/empty/missing-`sha256=` prefix false.

---

## 2. GitHub tool handlers — `src/lib/mcp-handlers/`
Nine in-process operations the agent calls as tools, plus a shared HTTP helper. Each handler is a plain `async` function returning a plain object.

### Shared helper — `github-request.js`
`githubRequest(owner, repo, method, path, body?)` → `{ status, data }`. Adds auth + standard headers; sends `Content-Type` + JSON body when a body is present; returns `{status:204, data:null}` for no-content. **On non-2xx it throws an `Error` with a numeric `.status` property** (and the GitHub message in the text) — this is how handlers branch on 404/422 without string-matching.
*Tests:* GET headers+parse · POST body+Content-Type · 204→null · non-2xx throws (method/path/status in message) · **`.status` attached** · GitHub message included.

### The nine tools
| Tool | Input (agent-facing) | Does | Returns / edge cases |
|---|---|---|---|
| `read_issue` | issue is fixed for the run | `GET issues/{n}` | `{number,title,body,labels[],state}`; labels→names |
| `list_directory` | `{path}` | `GET contents?ref=branch` | array of `{name,type,path}`; single file wrapped in array |
| `read_file` | `{path}` | `GET contents` | `{content (utf-8), sha}`; **throws if >1 MB** |
| `write_file` | `{path,content,message}` | GET sha (if exists) → `PUT contents` | `{sha,url}`; new file (404→no sha) vs update (with sha); **throws if >1 MB** |
| `create_branch` | `{branch?}` | ref HEAD → `POST git/refs` | `{branch,sha}`; **422 (exists) → `PATCH …force:true`** (re-run safe); non-422 re-thrown |
| `run_validation` | — | `POST dispatches {event_type:'agent-validation',client_payload:{branch}}` | `{dispatchedAt}` (ISO) |
| `get_validation_status` | — | `GET actions/runs?branch=&event=repository_dispatch` | `{status,conclusion,runId,runUrl}`; most-recent run; **clock-skew guard** vs dispatchedAt; empty→`queued` |
| `create_draft_pr` | `{title,body}` | `POST pulls {draft:true}` | `{prNumber,prUrl}`; appends `_Closes #N…_` footer |
| `add_issue_comment` | `{body}` | `POST issues/{n}/comments` | `{commentId,commentUrl}` |

**Tests** (`test/mcp-handlers/*.test.js`) cover each happy path + its primary edge case — notably: create-branch new/default-branch/**422-reset**/non-422-rethrow; write-file update-with-sha / new-no-sha / >1 MB-no-PUT; get-validation-status queued/found/**skew-guard**/most-recent; read-file >1 MB; read-issue labels mapping.

---

## 3. Agent layer — `src/lib/agent-runner.js` (+ `agent-tools.js`, `foundry-client.js`, `run-store.js`)
**Feature:** a self-owned Claude tool-use loop (Path B) that drives the TDD fix and **yields control at validation** so the durable orchestrator can own GHA polling.

- **`foundry-client.js`** — lazily constructs the `AnthropicFoundry` client (managed-identity Entra ID; `ANTHROPIC_FOUNDRY_BASE_URL`; model `CLAUDE_DEPLOYMENT_NAME`). The single model call is behind one function for testability.
- **`agent-tools.js`** — the nine Anthropic tool definitions + `dispatchTool(name, agentParams, context)`. **Context injection:** `owner/repo/branch/baseBranch/issueNumber` are injected by the runner, so the agent never passes them (fewer hallucinations). Tool calls use `disable_parallel_tool_use: true` (one tool per turn — required for a clean yield).
- **`agent-runner.js`** — two entry points the orchestrator calls:
  - `startAgentEdits(input)` → runs the loop from the issue context. Returns `{status:'completed',prUrl,summary}`, `{status:'failed',summary,error}`, or — when the agent calls `run_validation` — **`{status:'dispatched',dispatchedAt,messages,pendingToolUseId,context}`** (it dispatches GHA, then STOPS without the tool_result).
  - `agentReactToResult({…,messages,pendingToolUseId,validationConclusion,runUrl,context})` → attaches the deferred validation conclusion to the pending tool call and resumes. Returns `completed`/`failed`/`{status:'re-dispatched',…}`.
  - Safety: a **max-turns cap** ends a runaway loop as `failed`; a defensive guard fails fast if `run_validation` ever co-occurs with other tools.
- **`run-store.js`** — `createRunRecord` (upsert `running`) and `updateRunRecord` (Cosmos `patch` of status/completedAt/prUrl|error) in `chatbot/agent-runs`.

**Tests:** `agent-runner.test.js` — dispatched-yield · straight-to-PR completed · model-throws→failed+recorded · **tool_choice disable_parallel asserted** · multi-tool-with-validation→failed guard · max-turns→failed · react success→PR completed · react failure→re-dispatched. `agent-tools.test.js` — exactly nine tools · schemas valid · **no owner/repo/branch leaked into schemas** · dispatch routing+injection per tool · unknown-tool throws. `run-store.test.js` — upsert shape · patch set-ops (status/completedAt/prUrl) · failed→error op, no prUrl.

---

## 4. Durable orchestrator & activities — `src/functions/Workflow{Orchestrator,Activities}.js`
**Feature:** the durable workflow that ties everything together and owns the GHA polling loop.

- **Activities** (`WorkflowActivities.js`):
  - `PostSlackNotification` — informational; **fire-and-forget** (never throws, even if Slack/`SLACK_WEBHOOK_URL` is down — must not abort the run).
  - `StartAgentEdits` / `AgentReactToResult` — thin wrappers over the agent-runner entry points.
  - `GetValidationStatus` / `PostIssueComment` — split `repoFullName`→owner/repo and call the handler.
- **Orchestrator** (`WorkflowOrchestrator.js`, a deterministic generator):
  1. Slack notification.
  2. `StartAgentEdits`.
  3. While the agent is `dispatched`/`re-dispatched`: schedule `df.createTimer(currentUtcDateTime + 30 s)`, then `GetValidationStatus`, until `completed`; then `AgentReactToResult`.
  4. On a `failed` result, `PostIssueComment` with the error.
  - **Guards:** `MAX_ROUNDS=5` (re-validation rounds), `MAX_POLLS=120` (~1 h, then give up → treat validation as failed).
  - **Replay-safe:** no `Date.now()`/`fetch`/`Math.random`/`process.env` in the orchestrator body — only `context.df.*`.

**Tests** (`WorkflowOrchestrator.test.js`, `WorkflowActivities.test.js`): happy path (PR, timer-before-each-poll, **timer fires at clock+30 s**, no comment) · state threading (instanceId + messages/pendingToolUseId/context to the right activities) · failure→PostIssueComment · re-dispatch→second round→completed · **MAX_ROUNDS** guard · **MAX_POLLS** give-up · determinism scan · Slack fire-and-forget (rejects + unset URL both non-throwing) · activity repoFullName splitting + pass-through.

---

## End-to-end behavior (current)
`agent-ready` label → receiver validates HMAC, filters to `issues`/`labeled`/`agent-ready`, starts the orchestration → Slack → agent edits + dispatches validation, yields → orchestrator polls GHA on a durable timer → agent reacts (opens a draft PR on success, or re-validates / fails) → failure posts an issue comment. The Cosmos `agent-runs` record tracks each run.

> **Not yet wired (Phase 5, in progress):** the receiver computing a deterministic instance id (idempotency) and the `branchName` the orchestrator/agent require. Until Phase 5 lands, an end-to-end run polls `?branch=undefined`. **Do not judge end-to-end usability until Phase 5 is merged.**

## What to verify before merge
1. `npm test` → 80 passing; `npm run lint` clean; `az bicep build --file infra/issue-to-pr/main.bicep` compiles.
2. Spot-check the test-case lists above against the specs' acceptance criteria (plan §1–§4).
3. Confirm the deferred/non-blocking items in `docs/AI-98-implementation-status.md` are acceptable for MVP (storage-key connection, model `version` pin, minor test tightenings).
4. **Human review of the AI-written code** (foundation policy) — accountability rests with the reviewer; the deploy is operator-gated.

## Known limitations (Phases 1–4)
- No live integration test yet — all external behavior (GitHub API, Foundry/Claude, Cosmos, Slack, GHA) is covered by mocks; live verification is Phase 7 (staging).
- Sequential tool use only (`disable_parallel_tool_use`) — a deliberate trade for a clean durable yield.
- `MAX_POLLS` converts a never-completing validation into a failed run after ~1 h.
