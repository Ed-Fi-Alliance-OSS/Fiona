# AI-98: HITL Automation of Bug Fixes — Design Spec

**Date:** 2026-06-16
**Author:** Robert Hunter
**Jira:** [AI-98](https://edfi.atlassian.net/browse/AI-98)
**Status:** Approved — ready for implementation

---

## Problem

Ed-Fi engineers want GitHub issues to automatically trigger a TDD coding agent that creates a draft PR — but only after a human has explicitly decided the issue is worth acting on (is the bug real? well-defined? do we have bandwidth to review?).

## HITL Gate

The human-in-the-loop approval **is the GitHub label event itself.** An engineer triages the issue, then adds the label `agent-ready`. That label fires the webhook and starts the pipeline. No secondary approval gate for MVP.

---

## Architecture

```
GitHub Issue (label: "agent-ready")
  ↓ GitHub App webhook
Azure Function — GitHubWebhookReceiver   [HTTP trigger]
  - Validates HMAC-SHA256 signature
  - Filters to correct label
  - Starts Durable orchestration, returns 202 immediately
  ↓
Azure Durable Function — WorkflowOrchestrator
  - Posts Slack notification (informational only)
  - Agent edits + dispatches validation, then yields
  - Orchestrator owns the GHA polling loop (df.createTimer); feeds result to a fresh agent turn
  - On failure: posts issue comment with error summary
  ↓
Agent layer — Claude (TDD system prompt, see below)
  - Path decided by Phase 3.0 spike:
      preferred → Azure AI Agent Service (Azure AI Foundry) + Claude deployment
      fallback  → direct Anthropic SDK with a self-managed tool-use loop
  - Connected to MCP Tool Server via HTTP (AAD bearer token; function-key fallback)
  ↓
Azure Function — McpToolServer            [HTTP trigger, JSON-RPC 2.0]
  Exposes: read_issue, list_directory, read_file, write_file,
           create_branch, run_validation, get_validation_status,
           create_draft_pr, add_issue_comment
  ↓ (for run_validation / get_validation_status)
GitHub Actions — agent-execution.yml      [repository_dispatch]
  - Checkout branch, npm ci, npm run lint, npm test
  - Job conclusion polled by agent via get_validation_status
```

### GHA Tight Coupling (Documented Risk)

The execution environment is GitHub Actions. This means:

- Every target repo **must have `agent-execution.yml` present** — adding a new target repo is a deployment prerequisite.
- The workflow file must match the repo's toolchain (Node.js version, test command).
- The GitHub App needs `actions: write` and `checks: read` permissions.
- GHA outages or runner queue depth directly delay agent completion.

This is an acceptable MVP trade-off: GHA is already in every Ed-Fi repo, zero Docker image maintenance, 6-hour job timeout. Revisit with Azure Container Instances if multi-repo scale or GHA reliability becomes a concern (Phase 3).

---

## Repo Structure

```
apps/
  issue-to-pr-function/
    host.json                          # Azure Functions host config (Durable extension)
    package.json
    .env.sample
    src/
      functions/
        GitHubWebhookReceiver.js       # HTTP trigger: ingress + signature validation
        WorkflowOrchestrator.js        # Durable orchestrator
        WorkflowActivities.js          # Durable activities (StartAgentEdits, GetValidationStatus, AgentReactToResult, PostSlackNotification, PostIssueComment)
        McpToolServer.js               # HTTP trigger: MCP protocol endpoint
      lib/
        webhook-validator.js           # HMAC-SHA256 signature check
        github-client.js               # GitHub App auth (private key → JWT → installation token)
        agent-runner.js                # Azure AI Agent Service client
        mcp-handlers/
          read-issue.js
          list-directory.js
          read-file.js
          write-file.js                # GitHub Contents API; 1 MB per-file limit (Phase 2: Git Data API)
          create-branch.js
          run-validation.js            # Dispatches repository_dispatch, returns run ID
          get-validation-status.js     # Polls GHA run status
          create-draft-pr.js
          add-issue-comment.js
    test/
      webhook-validator.test.js
      github-client.test.js
      mcp-handlers/*.test.js

infra/
  issue-to-pr/
    main.bicep
    modules/
      functions.bicep                  # Consumption plan Functions app + storage account
      ai-foundry.bicep                 # AI Foundry hub + project + Agent Service resource
      cosmos-container.bicep           # agent-runs container on existing Cosmos account

.github/
  workflows/
    agent-execution.yml                # Dispatched by run_validation; runs lint + tests on branch
    deploy-issue-to-pr-function.yml    # CI/CD for new function app
    on-pullrequest-issue-to-pr.yml     # Lint + test on PRs
```

---

## Key Implementation Details

### GitHub App

Create a new GitHub App (not a PAT):

- **Webhook events:** `issues` (label events)
- **Permissions:** `issues: write`, `contents: write`, `pull_requests: write`, `actions: write`, `checks: read`, `metadata: read`
- Store private key + webhook secret in Key Vault `fiona-kv-bronze`

### Webhook Receiver

```
POST /api/github-webhook
1. Verify X-Hub-Signature-256 (HMAC-SHA256, webhook secret from Key Vault)
2. Filter: event == "issues", action == "labeled", label == "agent-ready"
3. Extract: repo, issue_number, issue_title, issue_body, base_branch
4. Start Durable orchestration with payload
5. Return 202 immediately
```

### Durable Orchestrator

```javascript
orchestrator(context):
  input = context.df.getInput()   // includes branchName = agent/issue-{n}-{slug}
  yield context.df.callActivity("PostSlackNotification", input)

  agent = yield context.df.callActivity("StartAgentEdits", input)  // edits + dispatch, then yields
  while agent.status === "dispatched":          // orchestrator owns the poll loop
    v = { status: "queued" }
    while v.status !== "completed":
      yield context.df.createTimer(+30s)        // durable wait, not an activity timeout
      v = yield context.df.callActivity("GetValidationStatus", input + agent.dispatchedAt)
    result = yield context.df.callActivity("AgentReactToResult", input + v.conclusion)
    agent = (result.status === "re-dispatched") ? { status: "dispatched", ... } : { status: "done" }

  if result.status === "failed":
    yield context.df.callActivity("PostIssueComment", { ...input, body: result.summary })
```

The orchestrator owns the GHA polling loop (`df.createTimer`) so no single activity blocks past the Consumption-plan timeout; Durable persists state across waits and the agent yields control after dispatching validation.

### Agent System Prompt (TDD — AI-98 Acceptance Criteria)

```
You are a TDD coding agent. Given a GitHub issue:
1. Read the issue and understand the bug.
2. Locate the relevant code and existing tests.
3. Write or modify a failing test that captures the expected behavior.
4. Write the minimal code change to make the test pass.
5. Run validation (lint + tests) and iterate until passing.
6. Create a draft PR. In the PR body, flag any changes to public APIs or
   user-facing behavior that need documentation.

Constraints:
- Do NOT refactor unrelated code.
- Follow existing patterns and conventions in the file you are modifying.
- Stick to the smallest change that fixes the bug.
```

### MCP Tool Catalog

| Tool | GitHub API | Notes |
|---|---|---|
| `read_issue` | GET /repos/{owner}/{repo}/issues/{n} | |
| `list_directory` | GET /repos/{owner}/{repo}/contents/{path} | On branch |
| `read_file` | GET /repos/{owner}/{repo}/contents/{path} | Base64 decode |
| `write_file` | PUT /repos/{owner}/{repo}/contents/{path} | Needs SHA for updates; **1 MB limit** |
| `create_branch` | POST /repos/{owner}/{repo}/git/refs | From default branch HEAD |
| `run_validation` | POST /repos/{owner}/{repo}/dispatches | Triggers `agent-execution.yml`; returns run ID |
| `get_validation_status` | GET /repos/{owner}/{repo}/actions/runs/{id} | `queued/in_progress/completed` + conclusion |
| `create_draft_pr` | POST /repos/{owner}/{repo}/pulls | `draft: true`, links originating issue |
| `add_issue_comment` | POST /repos/{owner}/{repo}/issues/{n}/comments | |

GitHub auth: GitHub App private key → JWT → short-lived installation access token, refreshed per request.

### GitHub Actions Runner (`agent-execution.yml`)

```yaml
on:
  repository_dispatch:
    types: [agent-validation]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.client_payload.branch }}
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

Agent polls `get_validation_status` until terminal state, reads job conclusion.

---

## Azure Resources

### Reuse (do not re-provision)

| Resource | Name | Reuse |
|---|---|---|
| Cosmos DB account | `fiona-db-dev-cosmos` | Add `agent-runs` container |
| Cosmos DB database | `chatbot` | Same database |
| Key Vault | `fiona-kv-bronze` | Add 4 secrets: `github-app-private-key`, `github-webhook-secret`, `anthropic-api-key`, `slack-webhook-url` |
| Resource group | `edfi-fiona-rg` | Deploy all new resources here |

> **Confirmed (2026-06-24, `az`):** Key Vault is `fiona-kv-bronze` (no `fiona-kv` exists) and Cosmos is `fiona-db-dev-cosmos`, both in `edfi-fiona-rg`. The new AI Foundry resource is also created in `edfi-fiona-rg`, so all AI-98 resources share one resource group — no cross-RG references.

### New Resources

| Resource | Name | Notes |
|---|---|---|
| Azure Functions app | `issue-to-pr-function` | Consumption plan for MVP; upgrade to EP1 if cold-start or timeout issues arise |
| Storage account | `fionaissuetoprstorage` | Isolated from `fionastorage` to keep Durable state separate |
| Azure AI Foundry resource | `fiona-ai-hub` | **New**, in `edfi-fiona-rg`. No reusable Hub exists; `fiona-llm` (RG `edfi-fiona`) has no Claude. Deferred until Phase 3.0 spike selects the Foundry path; dropped entirely on the direct-Anthropic fallback. |
| Azure AI Foundry Project | `fiona-issue-to-pr` | New, in `edfi-fiona-rg`. Hosts the `claude-opus-4-8` deployment + agent run history. |
| System-assigned MI | on Functions app | Key Vault Secrets User + Cosmos DB Built-in Data Contributor |

### New Cosmos DB Container

- **Name:** `agent-runs`
- **Partition key:** `/repoFullName` (e.g., `"Ed-Fi-Alliance/Fiona"`)
- **Composite indexes:** `repoFullName+createdAt`, `status+createdAt`
- **TTL:** 90 days

---

## Phased Delivery

### Phase 1 — MVP (this spec)
- Single target repo: Fiona
- Label trigger: `agent-ready`
- Tools: read, write, branch, validate (GHA), draft PR, issue comment
- Slack: informational notification only
- Observability: Azure Monitor + Durable run history

### Phase 2 — Robustness
- Migrate Claude to Azure-hosted model in Foundry (remove direct Anthropic API dependency)
- Add `get_ci_status` tool (full CI pipeline, not just unit tests)
- Slack approve/reject button for high-risk paths
- Expand to additional Ed-Fi repos (each needs `agent-execution.yml`)
- Upgrade `write_file` to Git Data API for files > 1 MB

### Phase 3 — Scale
- Multi-repo policy packs
- ACI execution environment option
- Agent observability dashboard in Azure AI Foundry

---

## Risks & Open Decisions

| Risk | Mitigation |
|---|---|
| GHA runner queue depth delays agent | Documented; Phase 3: ACI option |
| GHA outage blocks agent completion | Durable retries activity; orchestration state persists |
| Claude output variability (bad file paths, hallucinated APIs) | Strong system prompt + descriptive MCP tool error messages |
| GitHub App permissions scope | Minimum required; security review before production |
| `write_file` 1 MB limit | Documented; Phase 2: Git Data API |
| `agent-execution.yml` missing from target repo | Deployment runbook; template committed to this repo |
| Anthropic external model endpoint (preview in Foundry) | Acceptable MVP; Phase 2 migrates to Azure-hosted Claude |
| Claude Opus 4.8 may not be deployable to Foundry in our region | **Phase 3.0 spike** confirms availability before any Foundry infra; direct-Anthropic SDK fallback if unavailable |
| Foundry preview MCP connector may not present an AAD token | Spike-gated; fall back to a Functions host key (`mcp-function-key`) if needed; AAD is the hardening target |
| Foundry Agent Service may not yield control mid-run (needed for orchestrator-owned GHA polling) | Spike acceptance criterion; if it can't, the direct-Anthropic path owns the loop natively |

---

## Verification

1. **Unit tests:** `webhook-validator.js`, `github-client.js` (JWT generation), each MCP handler (mock GitHub API)
2. **Integration:** Fire a test webhook against `func start` local emulator; verify Durable orchestration starts
3. **End-to-end (staging):** Label a test issue in Fiona repo → observe Slack notification → GHA `agent-execution.yml` fires → draft PR created → issue comment posted
4. **Failure path:** Ambiguous issue → verify failure comment lands on issue with categorized error summary
