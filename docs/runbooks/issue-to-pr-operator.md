# Issue-to-PR Pipeline — Operator Runbook

**Service:** `issue-to-pr-function` (Azure Durable Functions, `edfi-fiona-rg`). Turns a GitHub issue labeled `agent-ready` into a draft PR via a Claude (Foundry) TDD agent. Design: `docs/superpowers/specs/2026-06-16-ai-98-issue-to-pr-design.md`; feature/test map: `docs/AI-98-feature-guide.md`.

> This runbook covers operating the pipeline once deployed. It assumes the Phase 0 deploy is done (Bicep + Marketplace access + GitHub App webhook URL set). See `docs/AI-98-implementation-status.md` for deploy prerequisites.

## At a glance
| Thing | Value |
|---|---|
| Function app | `issue-to-pr-function` · RG `edfi-fiona-rg` |
| Webhook endpoint | `POST https://issue-to-pr-function.azurewebsites.net/api/github-webhook` |
| Trigger | GitHub issue **labeled `agent-ready`** (HITL gate) |
| Agent model | `claude-opus-4-8` on Foundry `fiona-ai-hub` (eastus2), managed-identity auth |
| Run tracking | Cosmos `fiona-db-dev-cosmos` → db `chatbot` → container `agent-runs` |
| Validation | GitHub Actions `agent-execution.yml` (`repository_dispatch: agent-validation`) on the target repo |
| Orchestration id | deterministic: `sanitize("{repoFullName}#{issueNumber}")`, e.g. `Ed-Fi-Alliance-OSS-Fiona-42` |
| Working branch | `agent/issue-{number}-{slug}` |

## Normal flow (what "healthy" looks like)
1. Engineer labels an issue `agent-ready` → 202 from the receiver; a Slack message appears in the fiona-bug-agent channel within ~30 s.
2. A `running` record appears in `agent-runs`. The agent creates branch `agent/issue-{n}-{slug}`, edits a failing test + fix, then dispatches validation.
3. An `agent-execution.yml` run appears under the target repo's Actions tab on that branch. The orchestrator polls it on a 30 s durable timer.
4. On success the agent opens a **draft PR** linking the issue; the `agent-runs` record flips to `completed` with `prUrl`. On failure a comment is posted to the issue and the record is `failed`.

## Monitoring runs
- **Cosmos `agent-runs`** (fastest health view). Query in Data Explorer:
  ```sql
  SELECT c.id, c.issueNumber, c.status, c.createdAt, c.completedAt, c.prUrl, c.error
  FROM c WHERE c.repoFullName = "Ed-Fi-Alliance-OSS/Fiona" ORDER BY c.createdAt DESC
  ```
  `status` ∈ `running | completed | failed`. A record stuck in `running` well past ~1 h → see "stuck" below.
- **Application Insights** (Functions app → Monitor / Logs): traces for the orchestrator and activities (`StartAgentEdits`, `GetValidationStatus`, `AgentReactToResult`, `PostSlackNotification`, `PostIssueComment`). Filter by the orchestration `instanceId`.
- **Slack**: the informational start message (fire-and-forget — its absence does NOT mean the run failed; check Cosmos/AppInsights).

## Inspect a specific orchestration (Durable management API)
`instanceId` is deterministic from the issue: sanitize `{owner}/{repo}#{number}` by replacing every non-`[A-Za-z0-9_-]` char with `-`. E.g. issue #42 in `Ed-Fi-Alliance-OSS/Fiona` → `Ed-Fi-Alliance-OSS-Fiona-42`.
```
GET https://issue-to-pr-function.azurewebsites.net/runtime/webhooks/durabletask/instances/{instanceId}?code={DURABLE_SYSTEM_KEY}
```
(Get the durable system key from the Functions app → App keys → `durabletask_extension`, or use the Azure Portal **Durable Functions** monitor blade.) The response shows `runtimeStatus`, `input`, `customStatus`, `output`, and history.

## Retry a failed or stuck run
**Preferred (idempotent): re-label the issue.** Remove the `agent-ready` label and add it again. The receiver computes the same deterministic `instanceId`; if the prior run is terminal it **purges and restarts** cleanly; if one is still running, the re-label is a **no-op** (you won't get duplicates).

**Manual (Durable API)** if the instance is wedged in `running` but doing nothing:
```
POST .../instances/{instanceId}/terminate?reason=manual&code={key}
POST .../instances/{instanceId}/purge?code={key}
```
then re-label the issue to start fresh.

## Debugging
- **Tool errors (GitHub API):** tool dispatch is **in-process** in `agent-runner.js` (Path B — there is no separate MCP server), so failures surface inline in the agent run's App Insights traces. The shared `github-request` helper throws with the HTTP method, path, status, and GitHub message — search traces for that text. A `write_file` failure on a >1 MB file is expected behavior (handler guard), not an outage.
- **Agent run failures:** check the `StartAgentEdits` / `AgentReactToResult` activity traces. The Foundry/Claude call is in `foundry-client.js`; SDK errors include the Foundry request id. Correlate everything by `instanceId`.
- **Validation never completes:** the orchestrator polls `GetValidationStatus` (matches GHA runs by the **branch** `agent/issue-{n}-{slug}`). If no run is ever found, the agent's branch may not exist or `agent-execution.yml` is missing on the target repo (below). After `MAX_POLLS` (120 × 30 s ≈ 1 h) the orchestrator gives up and marks the run `failed`.

## Common failure modes
| Symptom | Cause | Fix |
|---|---|---|
| Run `failed`, comment says validation failed but no Actions run existed | `agent-execution.yml` missing on the **target repo** (it must be present on the repo's default branch with `repository_dispatch: [agent-validation]`) | Add the workflow to the target repo; re-label the issue |
| Immediate `failed` at StartAgentEdits, Foundry/401/403 | Managed identity lacks `Cognitive Services User` on `fiona-ai-hub`, or Foundry/Marketplace access lapsed, or Claude not deployed | Re-check the `main.bicep` RBAC + the Marketplace subscription for the Anthropic offering |
| GitHub calls 401 mid-run | `github-app-private-key` rotated/expired, or App uninstalled from the repo | Re-store the key in `fiona-kv-bronze`; confirm the App is installed on the target repo |
| Receiver returns 400 | Bad/missing `x-hub-signature-256` or wrong `github-webhook-secret` | Confirm the GitHub App webhook secret matches the KV secret |
| Label added but nothing happens | Webhook URL not set on the GitHub App, or event not `issues`/`labeled`/`agent-ready` | Set the App webhook URL to `/api/github-webhook`; confirm the label name exactly |
| Branch `agent/issue-N-` (trailing dash) | Issue title was empty/all-punctuation | Cosmetic; give the issue a descriptive title and re-label |
| Run stuck `running` ~1 h then `failed` | GHA validation never produced a matching run (see above), or GHA outage | Fix the validation workflow / wait out the GHA incident; re-label |

## Notes & limits
- **Single tool call per turn** (`disable_parallel_tool_use`) — by design, so the durable yield at `run_validation` stays valid; agent turns are sequential.
- **GHA coupling:** every target repo needs `agent-execution.yml`. GHA outages/queue depth directly delay completion (documented MVP trade-off; ACI is a future option).
- **Secrets** live in `fiona-kv-bronze` (`github-app-private-key`, `github-webhook-secret`, `slack-webhook-url`); Claude auth is managed-identity Entra ID (no API key). Never paste secret values into logs or chat.
- **Cost:** Claude-on-Foundry is pay-as-you-go; each run consumes tokens. Watch `agent-runs` volume.
