# AI-98 Issue-to-PR Pipeline — Implementation Status & Resume Guide

**Last updated:** 2026-06-24
**Branch:** `ai-98-hitl-bug` (HEAD `4d7f4ae`)
**Status:** Phases 0–3 implemented & reviewed; Phases 4–7 remain. 66 unit tests passing.

> This document is the walkthrough + handoff. It explains what's built, what's left, and how a new session resumes. Authoritative design lives in the two specs below; this file is the map.

## Source specs (read these for the "why")
- Design: `docs/superpowers/specs/2026-06-16-ai-98-issue-to-pr-design.md`
- Implementation plan: `docs/superpowers/specs/2026-06-24-ai-98-mvp0-implementation-plan.md` (finalized; **Path B** locked)

## What this builds
An Azure Durable Functions app that turns a GitHub issue labeled **`agent-ready`** into a **draft PR**, via a TDD coding agent. The human-in-the-loop gate IS the label — no secondary approval. The agent is **Claude Opus 4.8 hosted on Microsoft Foundry**, driven by a **self-owned tool-use loop** (Path B; NOT Azure AI Agent Service), calling GitHub through nine in-process tool handlers. Validation runs on GitHub Actions; the Durable **orchestrator owns the GHA polling loop** (the agent yields after dispatching validation).

## Architecture (flow)
```
GitHub issue labeled "agent-ready"
  → GitHubWebhookReceiver (HTTP, HMAC-validated)  [Phase 5 will add idempotency + branch slug]
  → WorkflowOrchestrator (Durable)                 [Phase 4 — NOT YET BUILT]
      → PostSlackNotification (informational)
      → StartAgentEdits ──► agent-runner loop (Claude on Foundry + in-process tools)
            agent dispatches run_validation, then YIELDS
      → orchestrator polls GHA via df.createTimer ──► GetValidationStatus
      → AgentReactToResult (resumes agent with the conclusion) ──► draft PR, or re-validate
      → PostIssueComment on failure
  → GitHub Actions agent-execution.yml runs lint+tests  [Phase 6 — NOT YET BUILT]
```

---

## ✅ Implemented (Phases 0–3)

### Phase 0 — Infra & platform
- `infra/issue-to-pr/` Bicep: `main.bicep` + `modules/{functions,ai-foundry,cosmos-container}.bicep` + `params.dev.json.example`. Compiles clean (`az bicep build`). Provisions: Consumption Functions app (Node 22, system MI), storage `fionaissuetoprstorage`, NEW Foundry resource `fiona-ai-hub` in **eastus2** + `claude-opus-4-8` (GlobalStandard) deployment, `agent-runs` container on existing `fiona-db-dev-cosmos`. RBAC: KV Secrets User, Cosmos **sqlRoleAssignment** Data Contributor, Cognitive Services User.
- `apps/issue-to-pr-function/local.settings.json.example` updated.
- **0.1 confirmed:** KV `fiona-kv-bronze`, Cosmos `fiona-db-dev-cosmos`, both in `edfi-fiona-rg`.
- **0.2 done:** GitHub App `Fiona Issue-to-PR` created; **0.3 done:** 3 secrets in `fiona-kv-bronze` (`github-app-private-key`, `github-webhook-secret`, `slack-webhook-url`) verified. Webhook URL deferred to post-deploy. **App ID held by Robert** (needed for `params.dev.json`).

### Phase 1 — GitHub App auth
- `src/lib/github-client.js` — `getInstallationToken(owner, repo)`: RS256 JWT via `node:crypto`, single `/installation` lookup, token exchange, in-memory cache refreshing 60s before expiry. Tested.

### Phase 2 — Nine GitHub tool handlers (in-process)
- `src/lib/mcp-handlers/`: `github-request.js` (shared helper — auth + fetch + `{status,data}`, throws `Error` with numeric `.status` on non-2xx) + `read-issue, list-directory, read-file, write-file, create-branch, run-validation, get-validation-status, create-draft-pr, add-issue-comment`. Each tested (happy + edge: 1MB byte-accurate guard, write-file sha new/update, create-branch 422→PATCH force, get-validation-status empty→queued).

### Phase 3 — Agent layer (Path B)
- `src/lib/agent-runner.js` — `startAgentEdits()` + `agentReactToResult()` + shared loop. Yields on `run_validation` (defers its tool_result so the orchestrator owns polling); resumes by attaching the conclusion to the pending tool_use id; `disable_parallel_tool_use: true` keeps the yield valid; max-turns cap; writes/updates the Cosmos run record.
- `src/lib/agent-tools.js` — 9 Anthropic tool defs + context-injecting `dispatchTool(name, params, {owner,repo,branch,baseBranch,issueNumber})`.
- `src/lib/foundry-client.js` — lazy `AnthropicFoundry` client (managed-identity Entra ID; base URL `ANTHROPIC_FOUNDRY_BASE_URL`; model `CLAUDE_DEPLOYMENT_NAME`).
- `src/lib/run-store.js` — Cosmos `agent-runs` create (upsert) + update (patch).

**Already present from scaffold:** `src/functions/GitHubWebhookReceiver.js`, `src/lib/webhook-validator.js` (+ tests).

---

## ⬜ Remaining (Phases 4–7)

### Phase 4 — Durable orchestrator & activities (NEXT, code)
- `src/functions/WorkflowActivities.js` — `PostSlackNotification`, `StartAgentEdits` (→ agent-runner), `GetValidationStatus` (→ handler), `AgentReactToResult` (→ agent-runner), `PostIssueComment`.
- `src/functions/WorkflowOrchestrator.js` — generator: Slack → StartAgentEdits → `while dispatched { df.createTimer(+30s); GetValidationStatus until completed; AgentReactToResult }` → PostIssueComment on failure. Use `context.df.currentUtcDateTime` (deterministic), `MAX_ROUNDS` guard. See plan §4.2 for the exact shape.
- Tests for activities; verify polling-loop termination.

### Phase 5 — Ingress completion (code + local emulator)
- Amend `GitHubWebhookReceiver.js`: deterministic Durable `instanceId = sanitize(${repoFullName}#${issueNumber})` (no-op if running, purge+restart if terminal); compute `branchName = agent/issue-{n}-{slug}` and pass in orchestration input. See plan §5.0.
- Smoke test against Azurite + `func start` (plan §5.2).

### Phase 6 — GitHub Actions workflows (code)
- `.github/workflows/agent-execution.yml` (repository_dispatch `agent-validation` → checkout branch, npm ci, lint, test), `on-pullrequest-issue-to-pr.yml`, `deploy-issue-to-pr-function.yml` (uses existing `AZURE_CREDENTIALS` SP pattern). See plan §6.

### Phase 7 — E2E validation & runbook (needs live infra)
- Integration test (Azurite + mocked agent), staging happy-path, failure-path, operator runbook `docs/runbooks/issue-to-pr-operator.md`. See plan §7.

---

## ⏳ Human-gated (Robert — not delegatable)
- **Deploy 0.4:** confirm Azure **Marketplace** access for the Anthropic Claude offering, fill real `params.dev.json` (incl. **GitHub App ID**), `az deployment group create -g edfi-fiona-rg ...`. Incurs pay-as-you-go spend.
- **Post-deploy:** set the GitHub App **webhook URL** to `https://issue-to-pr-function.azurewebsites.net/api/github-webhook`.
- **Live agent round-trip** (deferred Phase 3.0 criterion #1) validates during Phase 7 staging.

## Deferred follow-ups (fix at final whole-branch review / Phase 7 hardening)
- `functions.bicep`: `AzureWebJobsStorage` uses `listKeys()` embedded key (identity-based connection on Consumption content-share is caveated).
- `ai-foundry.bicep`: Claude deployment has no pinned `model.version`.
- `create-draft-pr.test.js`: footer asserted via `toContain` (could be exact); duplicate `add-issue-comment` test; seedless `reduce` in get-validation-status (guarded).
- `run-validation.js`: captures `dispatchedAt` after the await (negligible).

---

## How to resume (new session)
1. **Read this file + both specs.** Confirm Path B and the orchestrator-owned-polling design.
2. **Process:** we're using **subagent-driven-development** (fresh implementer subagent per task → task review → fix loop). Ledger at `.superpowers/sdd/progress.md` (git-ignored scratch in this worktree; mirrors this doc). Check it + `git log --oneline main..HEAD` after any compaction.
3. **Verify baseline:** `cd apps/issue-to-pr-function && npm test` → expect **66 passing**; `npm run lint` clean. `az bicep build --file infra/issue-to-pr/main.bicep` compiles (az is at `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`, not on PATH; `az login` already done).
4. **Next task:** Phase 4 (orchestrator + activities). Dispatch an implementer per the plan §4; the agent-runner exports `startAgentEdits`/`agentReactToResult` already match the activities' needs.
5. **Conventions:** ESM, Apache-2.0 header on new JS files, Jest (`npm test`), biome (`npm run lint`), no new deps without reason. Tell subagents: touch only their task's files; don't reformat unrelated files.
6. **Accountability (MSDF policy):** this code is substantially AI-written — a human review is required before merge/deploy, and the deploy is Robert's.
