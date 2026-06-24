# AI-98 MVP0 — Issue-to-PR Pipeline: Implementation Plan

**Date:** 2026-06-24
**Jira:** [AI-98](https://edfi.atlassian.net/browse/AI-98)
**Design spec:** `docs/superpowers/specs/2026-06-16-ai-98-issue-to-pr-design.md`
**Branch:** `ai-98-hitl-bug`
**Status:** Finalized 2026-06-24 — Path B (Anthropic-on-Foundry) locked; ready for implementation

---

## Overview

This plan covers the full MVP0 build of the `issue-to-pr-function` pipeline: an Azure Durable Functions app that listens for `agent-ready` GitHub label events, runs a Claude agent (hosted on Microsoft Foundry, driven by a self-owned tool-use loop — Path B, Phase 3.0), and produces a draft PR. The HITL gate is the label itself — no secondary approval gate.

Phases are ordered by dependency: each phase produces artifacts that the next phase depends on.

**What is already done:**
- `apps/issue-to-pr-function/src/functions/GitHubWebhookReceiver.js` — HTTP trigger, HMAC validation, label filtering, Durable client handoff (Phase 5.0 adds idempotency + branch-slug logic)
- `apps/issue-to-pr-function/src/lib/webhook-validator.js` — constant-time HMAC-SHA256 verification
- `apps/issue-to-pr-function/test/webhook-validator.test.js` — full unit test coverage
- `apps/issue-to-pr-function/test/GitHubWebhookReceiver.test.js` — receiver unit tests
- Project scaffold: `package.json`, `host.json`, `biome.json`, `jest.config.js`

---

## Phase 0 — Prerequisites & Platform Setup

**Goal:** All infrastructure and secrets exist before any code is written. Nothing blocks Phase 1.

### 0.1 — Existing Azure resource names (CONFIRMED)

Resolved via `az` against subscription **Ed-Fi Alliance** (2026-06-24):

| Resource | Confirmed value | Resource group |
|---|---|---|
| Key Vault | **`fiona-kv-bronze`** (no `fiona-kv` exists) | `edfi-fiona-rg` |
| Cosmos DB account | **`fiona-db-dev-cosmos`** — endpoint `https://fiona-db-dev-cosmos.documents.azure.com:443/` | `edfi-fiona-rg` |
| AI Foundry | None reusable. No ML Hub/Project exists; the only AIServices accounts (`fiona-llm`, `rober-mh3wbvuh-eastus2`) live in RG `edfi-fiona` and have **no Claude deployed**. | — |

**Decision:** Provision a **new** AI Foundry resource + project in **`edfi-fiona-rg`** (alongside Key Vault and Cosmos), compatible with a Claude Opus 4.8 deployment. All AI-98 resources therefore live in a single resource group — no cross-RG handling needed.

Record confirmed values in `infra/issue-to-pr/params.dev.json` (not committed — add to `.gitignore`).

**Acceptance criteria:**
- `params.dev.json` exists locally with `cosmosAccountName=fiona-db-dev-cosmos`, `keyVaultName=fiona-kv-bronze`, `keyVaultResourceGroup=edfi-fiona-rg`

---

### 0.2 — Register GitHub App

Create a new GitHub App under the `Ed-Fi-Alliance-OSS` organization.

**App settings:**
- Name: `Fiona Issue-to-PR`
- Homepage URL: repo URL
- Webhook URL: leave blank until Functions app is deployed; set after Phase 0.4
- Webhook secret: generate a strong random value (store immediately per 0.3)

**Repository permissions (minimum):**

| Permission | Level |
|---|---|
| Contents | Read & Write |
| Issues | Read & Write |
| Pull requests | Read & Write |
| Actions | Write |
| Checks | Read |
| Metadata | Read |

**Webhook events to subscribe:**
- `Issues` (covers label events)

**After creation:**
- Generate and download the private key (`.pem` file)
- Note the App ID
- Install the app on the `Fiona` repository only (not org-wide)

**Acceptance criteria:**
- GitHub App exists in Ed-Fi-Alliance-OSS org
- Private key downloaded
- App installed on Fiona repo
- App ID noted

---

### 0.3 — Store secrets in Key Vault

Add three secrets to `fiona-kv-bronze`:

| Secret name | Value |
|---|---|
| `github-app-private-key` | Full contents of the downloaded `.pem` file |
| `github-webhook-secret` | The webhook secret generated in 0.2 |
| `slack-webhook-url` | Slack incoming webhook URL for the fiona-bug-agent channel (confirmed) |

> **No Anthropic API key.** Per the Phase 3.0 decision (Path B), Claude is reached through the Foundry endpoint authenticated by the Functions app's **managed identity** (Microsoft Entra ID, scope `https://ai.azure.com/.default`) — there is no `anthropic-api-key` secret and no call to `api.anthropic.com`.

Also note the GitHub App ID — it will be needed as an app setting (not a secret).

```bash
az keyvault secret set --vault-name fiona-kv-bronze --name github-app-private-key --file ./fiona-issue-to-pr.pem
az keyvault secret set --vault-name fiona-kv-bronze --name github-webhook-secret --value "<value>"
az keyvault secret set --vault-name fiona-kv-bronze --name slack-webhook-url --value "<value>"
```

**Acceptance criteria:**
- All three secrets exist in Key Vault and are readable

---

### 0.4 — Write and deploy Bicep IaC

**Files to create:**

#### `infra/issue-to-pr/modules/functions.bicep`

Provisions:
- Storage account: `fionaissuetoprstorage` (LRS, StorageV2) — isolated from existing `fionastorage`
- Consumption plan Functions app: `issue-to-pr-function`
  - Runtime: Node.js 22
  - Extension bundle: `Microsoft.Azure.Functions.ExtensionBundle` version `[4.*, 5.0.0)` (standard Durable Functions bundle — not the `.Workflows` Logic Apps bundle)
  - System-assigned managed identity: enabled
- App settings (Key Vault references resolve against `fiona-kv-bronze`):
  - `GITHUB_WEBHOOK_SECRET` → `@Microsoft.KeyVault(SecretUri=https://fiona-kv-bronze.vault.azure.net/secrets/github-webhook-secret...)`
  - `GITHUB_APP_PRIVATE_KEY` → `@Microsoft.KeyVault(SecretUri=...fiona-kv-bronze.../github-app-private-key...)`
  - `GITHUB_APP_ID` → plain value (not a secret)
  - `ANTHROPIC_FOUNDRY_BASE_URL` → plain value `https://<foundry-resource-name>.services.ai.azure.com/anthropic` (the Anthropic Messages API base URL on the Foundry resource; auth is the MI's Entra ID token, scope `https://ai.azure.com/.default` — no key). Replaces the former `AI_FOUNDRY_ENDPOINT`/`ANTHROPIC_API_KEY` pair.
  - `CLAUDE_DEPLOYMENT_NAME` → plain value `claude-opus-4-8` (the Foundry deployment name; passed as the `model` field)
  - `COSMOS_ENDPOINT` → plain value `https://fiona-db-dev-cosmos.documents.azure.com:443/`
  - `SLACK_WEBHOOK_URL` → `@Microsoft.KeyVault(SecretUri=...fiona-kv-bronze.../slack-webhook-url...)`

#### `infra/issue-to-pr/modules/ai-foundry.bicep`

> **Adopted (Phase 3.0 resolved — Path B).** The spike confirmed `claude-opus-4-8` is deployable as an Anthropic / GlobalStandard model in Foundry. Base this module on the official [Claude on Foundry starter kit](https://github.com/Azure-Samples/claude) Bicep. The module is no longer conditional.

Provisions (new, in `edfi-fiona-rg`, **region `eastus2`** — Claude on Foundry is only offered in East US2 or Sweden Central):
- Foundry resource (account, kind AIServices): `fiona-ai-hub`
- Foundry project: `fiona-issue-to-pr`
- Claude Opus 4.8 model deployment named `claude-opus-4-8` (Anthropic, `GlobalStandard` SKU; pinned, not the `opus` alias). Requires Azure Marketplace access for partner model offerings (see 0.1 prerequisites).
- Output: the Anthropic base URL `https://fiona-ai-hub.services.ai.azure.com/anthropic` (used as `ANTHROPIC_FOUNDRY_BASE_URL`)

Auth: the Functions MI calls Claude via Entra ID — grant it **`Cognitive Services User`** on the Foundry resource (see `main.bicep`). No API key is provisioned. The agent definition/loop lives in `agent-runner.js` (Path B, self-owned loop), not in IaC and not in Foundry Agent Service.

#### `infra/issue-to-pr/modules/cosmos-container.bicep`

Adds to the existing Cosmos DB account `fiona-db-dev-cosmos` and `chatbot` database:
- Container: `agent-runs`
- Partition key: `/repoFullName`
- Default TTL: 7,776,000 seconds (90 days)
- Composite indexes:
  - `[repoFullName ASC, createdAt ASC]`
  - `[status ASC, createdAt ASC]`

#### `infra/issue-to-pr/main.bicep`

- Parameters (confirmed values): `cosmosAccountName=fiona-db-dev-cosmos`, `keyVaultName=fiona-kv-bronze`, `keyVaultResourceGroup=edfi-fiona-rg`, `foundryLocation=eastus2`, `location`
- Invokes `functions.bicep`, `cosmos-container.bicep`, and `ai-foundry.bicep` (all adopted)
- All resources deploy to `edfi-fiona-rg`; the Foundry resource is pinned to `eastus2` (Claude region constraint). Single RG — no cross-RG references.
- RBAC assignments on the Functions app managed identity:
  - `Key Vault Secrets User` on `fiona-kv-bronze`
  - `Cosmos DB Built-in Data Contributor` on `fiona-db-dev-cosmos`
  - `Cognitive Services User` on the `fiona-ai-hub` Foundry resource (lets the MI mint Entra ID tokens to call Claude)

**Deploy command (dev):**
```bash
az deployment group create \
  --resource-group edfi-fiona-rg \
  --template-file infra/issue-to-pr/main.bicep \
  --parameters @infra/issue-to-pr/params.dev.json
```

**Post-deploy:**
- Copy the Functions app URL and update the GitHub App webhook URL (from 0.2)
- Copy the AI Foundry project endpoint into `params.dev.json` / app settings

**Acceptance criteria:**
- Functions app exists with system-assigned MI
- MI has Key Vault Secrets User (on `fiona-kv-bronze`), Cosmos DB Built-in Data Contributor (on `fiona-db-dev-cosmos`), and Cognitive Services User (on `fiona-ai-hub`) roles
- `agent-runs` container exists with correct partition key and TTL
- Key Vault references resolve (visible in Functions app → Configuration → Values show)
- Foundry resource + project + `claude-opus-4-8` deployment exist in eastus2; a test Messages API call with the MI's Entra ID token returns 200

---

### 0.5 — Populate `local.settings.json` for local development

Create `apps/issue-to-pr-function/local.settings.json` (gitignored) from the `.example` file, populated with real values for local development. Update `local.settings.json.example` to document all required variables:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "GITHUB_WEBHOOK_SECRET": "",
    "GITHUB_APP_PRIVATE_KEY": "",
    "GITHUB_APP_ID": "",
    "ANTHROPIC_FOUNDRY_BASE_URL": "https://fiona-ai-hub.services.ai.azure.com/anthropic",
    "CLAUDE_DEPLOYMENT_NAME": "claude-opus-4-8",
    "COSMOS_ENDPOINT": "",
    "SLACK_WEBHOOK_URL": ""
  }
}
```

Locally, the Anthropic-on-Foundry client authenticates with `DefaultAzureCredential`, which uses the developer's `az login` session — no key in `local.settings.json`. (Tool dispatch is in-process, so there is no `MCP_TOOL_SERVER_URL`.)

**Acceptance criteria:**
- `local.settings.json.example` documents all required env vars with descriptions
- Local `local.settings.json` is populated and `func start` starts without missing-env errors

---

## Phase 1 — GitHub App Auth Layer

**Goal:** A single `getInstallationToken(owner, repo)` function that any MCP handler can call to get a short-lived GitHub installation access token. Nothing else should deal with JWT or token refresh.

**Prerequisite:** Phase 0.2 (GitHub App created), Phase 0.3 (private key in Key Vault / local env)

### 1.1 — Write `src/lib/github-client.js`

Responsibilities:
- Load `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_ID` from `process.env`
- Generate a JWT signed with RS256, valid for 10 minutes, with `iss: appId`
- Call `GET /repos/{owner}/{repo}/installation` to get the installation ID for that repo directly (single call — do not list all installations)
- Exchange the JWT for a short-lived installation access token via `POST /app/installations/{id}/access_tokens`
- Cache the token in memory until 60 seconds before its `expires_at`; refresh transparently on next call

Exported interface:
```javascript
export async function getInstallationToken(owner, repo) // returns string token
```

Implementation notes:
- Use `node:crypto` `createSign` for RS256 signing (no external JWT library needed)
- GitHub tokens expire after 1 hour; cache by `${owner}/${repo}` key
- All GitHub API calls use `https://api.github.com` with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`

### 1.2 — Write `test/github-client.test.js`

Test cases:
- Returns a token string when API calls succeed (mock `fetch`)
- Caches token and does not re-request before expiry
- Refreshes token when within 60 seconds of expiry
- Throws a descriptive error when private key is malformed
- Throws a descriptive error when the installation is not found (404 from GitHub)

**Acceptance criteria:**
- `npm test` passes for `github-client.test.js`
- Token caching is verified by confirming `fetch` is called only once for two calls within the cache window

---

## Phase 2 — GitHub Tool Handlers

**Goal:** Nine GitHub operations, each a plain module that `agent-runner.js` exposes to Claude as a tool and dispatches **in-process**.

**Prerequisite:** Phase 1 (auth layer)

> **Path B consequence — no standalone MCP server.** The original plan had `McpToolServer.js`, an HTTP JSON-RPC endpoint that Azure AI **Agent Service** connected to remotely (which is why it needed its own AAD/function-key auth). With Path B (Phase 3.0), `agent-runner.js` owns the tool-use loop in-process and calls these handler modules directly — there is **no remote tool server to stand up, and no separate MCP-endpoint auth concern** (the earlier criterion #3 is moot). `src/functions/McpToolServer.js` is therefore **not built** for MVP. The handler modules below are unchanged and are the unit of work; only their invocation path changes (in-process function call instead of JSON-RPC over HTTP).
>
> If a remote tool server is ever wanted (e.g. to share these tools with other agents), it can be added later as an HTTP front door over the same handlers, with the AAD-bearer-token auth described in the prior revision. Out of scope for MVP.

### 2.1 — Tool registration in `agent-runner.js`

Each handler is registered as an Anthropic tool definition (`name`, `description`, `input_schema`). When Claude emits a `tool_use` block, `agent-runner.js` looks up the matching handler in `src/lib/mcp-handlers/`, `await`s it, and returns the result as a `tool_result` block. Unknown tool name → a `tool_result` with `is_error: true` and a descriptive message (so Claude can recover). See Phase 3.1 for the loop.

### 2.2 — Write MCP handlers

One file per tool in `src/lib/mcp-handlers/`. Each handler receives a `params` object (the tool input from Claude's `tool_use` block) and returns a plain JS object (the result, serialized into the `tool_result`). All use `getInstallationToken` from `github-client.js`.

#### `read-issue.js`
- Params: `{ owner, repo, issueNumber }`
- Calls: `GET /repos/{owner}/{repo}/issues/{issueNumber}`
- Returns: `{ number, title, body, labels, state }`

#### `list-directory.js`
- Params: `{ owner, repo, path, branch }`
- Calls: `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`
- Returns: array of `{ name, type, path }` (files and subdirectories)

#### `read-file.js`
- Params: `{ owner, repo, path, branch }`
- Calls: `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`
- Returns: `{ content: string, sha }` (Base64 decoded to UTF-8)
- Errors: return descriptive message if file exceeds 1 MB (GitHub API limit)

#### `write-file.js`
- Params: `{ owner, repo, path, branch, content, message }`
- Calls: `GET` to fetch current SHA (if file exists), then `PUT /repos/{owner}/{repo}/contents/{path}`
- Body: `{ message, content: base64(content), branch, sha? }`
- Returns: `{ sha, url }`
- Errors: descriptive message if content exceeds 1 MB

#### `create-branch.js`
- Params: `{ owner, repo, branch, fromBranch? }` (`fromBranch` defaults to repo default branch). The `branch` value is the orchestrator-computed `agent/issue-{n}-{shortSlug}` (see Phase 5) — the agent does not invent it.
- Calls: `GET /repos/{owner}/{repo}/git/ref/heads/{fromBranch}` to get HEAD SHA, then `POST /repos/{owner}/{repo}/git/refs`
- **Re-run handling:** if the branch already exists (422) — which happens on an intentional re-run after the orchestration was purged (Phase 5, #5) — reset it to the `fromBranch` HEAD via `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` with `force: true` rather than failing. This gives the re-run a clean starting point.
- Returns: `{ branch, sha }`

#### `run-validation.js`
- Params: `{ owner, repo, branch }`
- Calls: `POST /repos/{owner}/{repo}/dispatches` with `{ event_type: "agent-validation", client_payload: { branch } }`
- Records `dispatchedAt` timestamp (ISO string)
- Returns: `{ dispatchedAt }` — the agent uses this with `get-validation-status` to find the correct run

Implementation note: GitHub's `repository_dispatch` API does not return the triggered run ID. `get-validation-status` must find the run by listing workflow runs filtered by branch, event type, and created-after time. Return `dispatchedAt` so the polling handler can use it as a lower bound.

#### `get-validation-status.js`
- Params: `{ owner, repo, branch, dispatchedAt }`
- Calls: `GET /repos/{owner}/{repo}/actions/runs?branch={branch}&event=repository_dispatch`
- **Matching:** because each issue gets a unique branch (`agent/issue-{n}-{shortSlug}`, Phase 6 / #6), the branch filter alone uniquely identifies this validation run. Take the most recent run on that branch; use `dispatchedAt` only as a clock-skew sanity guard (ignore runs created well before dispatch), not as the primary selector.
- Returns: `{ status, conclusion, runId, runUrl }` where `status` is `queued | in_progress | completed` and `conclusion` is `success | failure | null`
- If no run found yet, returns `{ status: "queued", conclusion: null, runId: null }`

#### `create-draft-pr.js`
- Params: `{ owner, repo, branch, baseBranch, title, body, issueNumber }`
- Calls: `POST /repos/{owner}/{repo}/pulls` with `{ title, body, head: branch, base: baseBranch, draft: true }`
- Appends to body: `\n\n---\n_Closes #${issueNumber}. Generated by Fiona coding agent._`
- Returns: `{ prNumber, prUrl }`

#### `add-issue-comment.js`
- Params: `{ owner, repo, issueNumber, body }`
- Calls: `POST /repos/{owner}/{repo}/issues/{issueNumber}/comments`
- Returns: `{ commentId, commentUrl }`

### 2.3 — Write unit tests for all handlers

Location: `test/mcp-handlers/`

For each handler:
- Mock `github-client.js` (`getInstallationToken` returns a fixed string)
- Mock `fetch` for the GitHub API calls
- Test the happy path: correct API call made, correct result shape returned
- Test the primary error case (e.g., 404 for missing file, 422 for duplicate branch, empty run list for `get-validation-status`)

**Acceptance criteria:**
- All 9 handlers have unit tests
- `npm test` passes for all handler tests
- Each handler exports a function with a stable result shape and surfaces its primary error case with a descriptive message (consumed by `agent-runner.js` as a `tool_result`)

---

## Phase 3 — Agent Runner

**Goal:** A module that runs Claude (hosted on Foundry) through a self-owned tool-use loop for a given issue, calling the Phase 2 handlers in-process, and returns a structured result.

**Prerequisite:** Phase 2 (handler modules)

### 3.0 — Agent Layer Spike — RESOLVED (Path B)

Resolved 2026-06-24 from Microsoft's GA documentation and a catalog query against our subscription — no provisioning required (the live round-trip folds into 3.1). Decision: **Path B — Anthropic SDK on Foundry, self-owned tool loop.**

**Findings against the original criteria:**
0. **Claude deployable — PASS.** `claude-opus-4-8` is an Anthropic / `GlobalStandard` (serverless) model in our subscription's catalog, in **East US2** and **Sweden Central** only. Claude-on-Foundry is GA, authenticated by Microsoft Entra ID (managed identity), with an official [starter-kit Bicep](https://github.com/Azure-Samples/claude). → Foundry resource in `eastus2`.
1. **Tool round-trip — satisfied by design (live check deferred to 3.1).** With a self-owned loop, tools are standard Anthropic tool-use; handlers run in-process.
2. **Mid-run yield — satisfied by construction.** We own the loop, so ending the agent's turn after it calls `run_validation` and resuming later is just control flow we write — no dependency on a server-side run lifecycle.
3. **MCP auth — moot.** No remote MCP server; handlers are in-process (see Phase 2). The only auth in play is the MI's Entra ID token to the Foundry Claude endpoint.

**Why Path B over the original Path A (`@azure/ai-projects` Agent Service):** Path A *can* do MCP with custom headers/Entra/OAuth and `require_approval` mid-run interception, but the docs don't clearly show Claude as the Agent-Service model, and it adds a preview, OpenAI-Responses-shaped surface. Path B is GA, Node-native (`@anthropic-ai/foundry-sdk`), keeps Claude in Azure with managed-identity auth, and resolves #2/#3 for free.

### 3.1 — Write `src/lib/agent-runner.js`

> Path B. The agent **dispatches** validation (`run_validation` tool) and then the loop ends its turn — it does NOT poll `get_validation_status` in a loop. The orchestrator drives polling and re-enters `agent-runner` for a fresh turn with the result (see Phase 4.2, #2).

Responsibilities:
- Initialize the `@anthropic-ai/foundry-sdk` `AnthropicFoundry` client with `baseURL = ANTHROPIC_FOUNDRY_BASE_URL` and `azureADTokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default')` (managed identity in production, `az login` developer credential locally). No API key.
- Run a **self-owned tool-use loop** against the Messages API: `model = CLAUDE_DEPLOYMENT_NAME` (`claude-opus-4-8`), `thinking: {type: 'adaptive'}`, `output_config: {effort: 'high'}`, streaming (long turns). Tools = the nine Phase 2 handlers as Anthropic tool definitions.
- On each `tool_use` block: dispatch to the in-process handler, append a `tool_result`. **End the turn when the agent calls `run_validation`** (return `{status:'dispatched', dispatchedAt, threadId}` where `threadId` is the persisted message history) — or when it calls `create_draft_pr` / stops.
- Re-entrant: `AgentReactToResult` (Phase 4) calls back in with the prior message history + the validation outcome to continue the loop.
- Return structured result:
  ```javascript
  // success
  { status: 'completed', prUrl: string, summary: string }
  // failure
  { status: 'failed', summary: string, error: string }
  ```

**TDD system prompt** (embed as a constant in this file):
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
- Always call create_draft_pr as your final action.
```

**Env vars required:**
- `ANTHROPIC_FOUNDRY_BASE_URL` — `https://fiona-ai-hub.services.ai.azure.com/anthropic`
- `CLAUDE_DEPLOYMENT_NAME` — `claude-opus-4-8`
- (auth is the MI's Entra ID token via `DefaultAzureCredential`; no key, no MCP server URL)

**Dependencies:** add `@anthropic-ai/foundry-sdk` and `@azure/identity`; **remove `@azure/ai-projects`** from `package.json` (it was the Path A SDK).

### 3.2 — Add `COSMOS_ENDPOINT` run tracking

In `agent-runner.js`, before starting the agent run:
- Write a record to Cosmos DB `agent-runs` container:
  ```javascript
  {
    id: instanceId,           // Durable orchestration instance ID (passed in)
    repoFullName,             // partition key
    issueNumber,
    status: 'running',
    createdAt: new Date().toISOString()
  }
  ```
- On result, update the record: `status: 'completed' | 'failed'`, add `prUrl` or `error`, add `completedAt`
- Use `@azure/cosmos` `CosmosClient` with `DefaultAzureCredential`

**Acceptance criteria:**
- `agent-runner.js` completes a live Claude tool-use loop against the Foundry Claude deployment in dev (this is the deferred Phase 3.0 criterion #1)
- A Cosmos DB record is written and updated for each run
- Successful runs return `{ status: 'completed', prUrl, summary }`
- Failed runs return `{ status: 'failed', summary, error }`
- In-process tool dispatch works: a `tool_use` for `read_issue` returns a `tool_result` and the loop continues

---

## Phase 4 — Durable Orchestrator & Activities

**Goal:** The orchestrator and its activities are wired up so that a started Durable instance runs the full pipeline: Slack notification → agent run → failure comment on error.

**Prerequisite:** Phase 3 (agent runner)

### 4.1 — Write `src/functions/WorkflowActivities.js`

Three activities, each exported as a named Durable activity function:

#### `PostSlackNotification`
- Input: `{ repoFullName, issueNumber, issueTitle }`
- Posts to `SLACK_WEBHOOK_URL` env var:
  ```
  :robot_face: Starting agent run for issue #<issueNumber> in <repoFullName>: "<issueTitle>"
  ```
- Fire-and-forget: if Slack call fails, log the error and return without throwing (do not fail the orchestration)

#### `StartAgentEdits`
- Input: `{ repoFullName, issueNumber, issueTitle, issueBody, baseBranch, branchName, instanceId }`
- Calls `agent-runner.js` to run the agent through: read issue → locate code → create branch (`branchName`) → write failing test + fix → **dispatch validation** (`run_validation`), then **end the turn**. Does NOT poll validation.
- Returns: `{ status: 'dispatched' | 'failed', dispatchedAt?, threadId?, summary?, error? }` (`threadId`/conversation handle is persisted so `AgentReactToResult` can resume the same agent turn)

#### `GetValidationStatus`
- Input: `{ repoFullName, branchName, dispatchedAt }`
- Thin wrapper over the `get-validation-status` handler; returns `{ status, conclusion, runId, runUrl }`
- Short-lived (one API call) — safe within the Consumption activity timeout

#### `AgentReactToResult`
- Input: `{ ...agent context, threadId, validationConclusion, runUrl }`
- Resumes the agent turn with the validation outcome. On `success` → agent calls `create_draft_pr` (final action). On `failure` → agent iterates (edit + re-dispatch) or gives up with a summary.
- Returns the structured result: `{ status: 'completed', prUrl, summary }` or `{ status: 'failed', summary, error }`, or `{ status: 're-dispatched', dispatchedAt }` if it wants another validation round

#### `PostIssueComment`
- Input: `{ repoFullName, issueNumber, body }`
- Parses `owner` and `repo` from `repoFullName`
- Calls `add-issue-comment` handler directly (not via MCP wire protocol)
- Returns `{ commentId, commentUrl }`

### 4.2 — Write `src/functions/WorkflowOrchestrator.js`

The orchestrator owns the GHA polling loop using `context.df.createTimer` so no single activity blocks past the Consumption timeout (#2). Each activity is short-lived; durable state persists across the timer waits.

```javascript
// Orchestrator function — must be a generator (Durable requirement)
orchestrator(context):
  const input = context.df.getInput()  // includes branchName computed by the receiver (#6)

  // Informational Slack message — non-blocking, failures do not abort
  yield context.df.callActivity('PostSlackNotification', {
    repoFullName: input.repoFullName,
    issueNumber: input.issueNumber,
    issueTitle: input.issueTitle
  })

  // Agent edits code + dispatches validation, then yields control
  let agent = yield context.df.callActivity('StartAgentEdits', {
    ...input,
    instanceId: context.df.instanceId
  })

  let result
  const MAX_ROUNDS = 5  // guard against infinite re-dispatch loops
  for (let round = 0; agent.status === 'dispatched' && round < MAX_ROUNDS; round++) {
    // Poll GHA via durable timer — not billed against an activity timeout
    let v = { status: 'queued', conclusion: null }
    while (v.status !== 'completed') {
      yield context.df.createTimer(addSeconds(context.df.currentUtcDateTime, 30))
      v = yield context.df.callActivity('GetValidationStatus', {
        repoFullName: input.repoFullName,
        branchName: input.branchName,
        dispatchedAt: agent.dispatchedAt
      })
    }

    // Feed the result back into a fresh agent turn
    result = yield context.df.callActivity('AgentReactToResult', {
      ...input,
      threadId: agent.threadId,
      validationConclusion: v.conclusion,
      runUrl: v.runUrl
    })

    // Agent may request another validation round
    agent = result.status === 're-dispatched' ? { status: 'dispatched', dispatchedAt: result.dispatchedAt, threadId: agent.threadId } : { status: 'done' }
  }

  // StartAgentEdits itself may have failed before dispatch
  if (agent.status === 'failed') result = agent

  // If the run failed, post a comment to the issue
  if (result?.status === 'failed') {
    yield context.df.callActivity('PostIssueComment', {
      repoFullName: input.repoFullName,
      issueNumber: input.issueNumber,
      body: `### Fiona agent run failed\n\n${result.summary}\n\n**Error:** ${result.error}`
    })
  }
```

Note: all values used in the orchestrator must come from activity outputs or `context.df` (deterministic replay requirement) — use `context.df.currentUtcDateTime`, never `Date.now()`.

### 4.3 — Write unit tests for activities

Location: `test/WorkflowActivities.test.js`

- `PostSlackNotification`: mock `fetch`, verify correct Slack payload; verify non-throw on Slack error
- `StartAgentEdits`: mock `agent-runner`, verify `{ status: 'dispatched', dispatchedAt, threadId }` is returned
- `GetValidationStatus`: mock the handler, verify pass-through of status/conclusion
- `AgentReactToResult`: mock `agent-runner`, verify `success`→completed/`failure`→failed mapping
- `PostIssueComment`: mock `add-issue-comment` handler, verify comment body is correct

**Acceptance criteria:**
- `npm test` passes for activity tests
- Starting a Durable orchestration (via local emulator or staging) runs activities in correct order, polling via timer until validation completes
- A failed result triggers `PostIssueComment`
- The polling loop terminates on `completed` and respects `MAX_ROUNDS`
- `PostSlackNotification` failure does not abort the orchestration

---

## Phase 5 — Ingress Completion

**Goal:** The already-built webhook receiver loads its secret from Key Vault (via app settings) and can be smoke-tested end-to-end against the local Functions emulator.

**Prerequisite:** Phase 0.4 (Functions app provisioned with Key Vault references), Phase 4 (orchestrator registered)

### 5.0 — Receiver: idempotency + branch naming (code changes required)

The already-built `GitHubWebhookReceiver.js` calls `client.startNew('WorkflowOrchestrator', { input })` with no instance ID. Update it:

- **Deterministic instanceId (#5):** compute `instanceId = sanitize(`${repoFullName}#${issueNumber}`)` (Durable instance IDs disallow some chars — replace `/`, `#` with `-`). Before `startNew`:
  ```javascript
  const status = await client.getStatus(instanceId);
  if (status && !isTerminal(status.runtimeStatus)) {
    return { status: 202, body: 'Already running' };   // no-op on re-label / redelivery
  }
  if (status && isTerminal(status.runtimeStatus)) {
    await client.purgeInstanceHistory(instanceId);      // allow intentional re-run
  }
  await client.startNew('WorkflowOrchestrator', { instanceId, input });
  ```
  (`isTerminal` = `Completed | Failed | Terminated | Canceled`.)
- **Branch slug (#6):** compute `branchName = 'agent/issue-' + issueNumber + '-' + slug(issueTitle).slice(0, 30)` (lowercase, non-alphanumeric → `-`, trim trailing `-`) and add it to the orchestration `input`. The orchestrator/agent uses this exact value; the agent never invents a branch name.

### 5.1 — Wire Key Vault reference in app settings

The `GitHubWebhookReceiver.js` reads `process.env.GITHUB_WEBHOOK_SECRET`. The Key Vault reference (→ `fiona-kv-bronze`) in the Functions app settings handles this automatically in production. Verify locally using the value from `local.settings.json`.

Confirm `GITHUB_WEBHOOK_SECRET` matches the app setting name in `main.bicep`.

### 5.2 — Smoke test with local emulator

Steps:
1. Start Azure Storage emulator (Azurite)
2. `npm run start` in `apps/issue-to-pr-function/`
3. Send a test webhook request:

```bash
# Generate a valid HMAC-SHA256 signature for the test payload
BODY='{"action":"labeled","label":{"name":"agent-ready"},"issue":{"number":1,"title":"Test","body":"Test issue"},"repository":{"full_name":"Ed-Fi-Alliance-OSS/Fiona","default_branch":"main"}}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | cut -d' ' -f2)"

curl -X POST http://localhost:7071/api/github-webhook \
  -H "Content-Type: application/json" \
  -H "x-github-event: issues" \
  -H "x-hub-signature-256: $SIG" \
  -d "$BODY"
```

4. Verify: HTTP 202 returned, Durable orchestration instance visible in storage emulator

**Acceptance criteria:**
- Valid signed request returns 202 and starts a Durable orchestration
- Invalid signature returns 400
- Non-`issues` event returns 200 `Ignored`
- `agent-ready` label filter works correctly (other labels return 200 `Ignored`)
- Re-labeling while an orchestration is still running is a no-op (deterministic instanceId, #5)
- Re-labeling after a terminal run purges and restarts cleanly
- Orchestration input carries `branchName = agent/issue-{n}-{slug}` (#6)

---

## Phase 6 — GitHub Actions Workflows

**Goal:** Three workflow files exist and behave correctly: one that the agent triggers for validation, one for PR checks on the function app, and one for CI/CD deployment.

**Prerequisite:** Phase 0.2 (GitHub App installed with `actions: write` permission)

### 6.1 — Write `.github/workflows/agent-execution.yml`

Triggered by the `run_validation` MCP tool via `repository_dispatch`.

```yaml
name: Agent Validation

on:
  repository_dispatch:
    types: [agent-validation]

jobs:
  validate:
    name: Lint and Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.client_payload.branch }}

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: apps/issue-to-pr-function/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: apps/issue-to-pr-function

      - name: Lint
        run: npm run lint
        working-directory: apps/issue-to-pr-function

      - name: Test
        run: npm run test:ci
        working-directory: apps/issue-to-pr-function
```

Note: The `working-directory` paths assume this workflow is in Fiona and the agent is working on Fiona. When expanding to other repos, each target repo must have its own `agent-execution.yml` matching its toolchain.

### 6.2 — Write `.github/workflows/on-pullrequest-issue-to-pr.yml`

Runs lint and tests on PRs that touch the function app source.

```yaml
name: PR Checks — issue-to-pr-function

on:
  pull_request:
    branches: [main]
    paths:
      - 'apps/issue-to-pr-function/**'
      - 'infra/issue-to-pr/**'

jobs:
  lint-and-test:
    name: Lint and Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: apps/issue-to-pr-function/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: apps/issue-to-pr-function

      - name: Lint
        run: npm run lint
        working-directory: apps/issue-to-pr-function

      - name: Test
        run: npm run test:ci
        working-directory: apps/issue-to-pr-function
```

### 6.3 — Write `.github/workflows/deploy-issue-to-pr-function.yml`

Deploys to Azure on push to `main` when function app source or IaC changes.

```yaml
name: Deploy — issue-to-pr-function

on:
  push:
    branches: [main]
    paths:
      - 'apps/issue-to-pr-function/**'
      - 'infra/issue-to-pr/**'

jobs:
  deploy:
    name: Deploy to Azure Functions
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: apps/issue-to-pr-function/package-lock.json

      - name: Install dependencies
        run: npm ci --omit=dev
        working-directory: apps/issue-to-pr-function

      - name: Azure login
        uses: azure/login@532459ea530d8321f2fb9bb10d1e0bcf23869a43 # v3.0.0
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy Bicep IaC
        run: |
          az deployment group create \
            --resource-group edfi-fiona-rg \
            --template-file infra/issue-to-pr/main.bicep \
            --parameters @infra/issue-to-pr/params.production.json

      - name: Deploy to Azure Functions
        run: |
          cd apps/issue-to-pr-function && zip -r ../issue-to-pr-function.zip . -x "*.test.js" -x "test/*"
          az functionapp deployment source config-zip \
            --resource-group edfi-fiona-rg \
            --name issue-to-pr-function \
            --src ../issue-to-pr-function.zip
```

Required GitHub secrets:
- `AZURE_CREDENTIALS`: Service principal JSON (`{ clientId, clientSecret, subscriptionId, tenantId }`) — stored at the `production` environment level, matching the existing pattern used by `deploy-fiona-slack-container.yml` and `deploy-usage-report-function.yml`.

Note: This follows the existing deployment pattern in the repo (`azure/login@v3.0.0` with `creds: ${{ secrets.AZURE_CREDENTIALS }}`). The `AZURE_CREDENTIALS` secret already exists at the environment level — verify it grants contributor rights to `edfi-fiona-rg` before running.

**Acceptance criteria:**
- `agent-execution.yml` can be triggered via `repository_dispatch` with `event_type: agent-validation` and a `branch` payload; runs lint and tests on the specified branch
- PR workflow triggers on PRs touching `apps/issue-to-pr-function/**` or `infra/issue-to-pr/**`
- Deploy workflow triggers on push to `main` with matching path changes
- Deploy workflow uses existing `AZURE_CREDENTIALS` service principal pattern (consistent with all other Azure deployments in this repo)

---

## Phase 7 — End-to-End Validation & Hardening

**Goal:** The full pipeline works in staging, failure paths are verified, and the system is hand-off-ready with a runbook.

**Prerequisite:** All previous phases complete in dev/staging

### 7.1 — Integration test (local emulator)

Write a script or jest test in `test/integration/` that:
1. Starts the function app locally (or assumes it is running)
2. Sends a valid signed webhook request
3. Polls the Durable management API until the orchestration reaches a terminal state
4. Asserts the orchestration completed (not failed)

This test requires a live Azurite instance and mocked agent runner (not a live Foundry call).

### 7.2 — Staging end-to-end test

Steps (manual, with a staging deployment):
1. Label a test issue in the Fiona repository with `agent-ready`
2. Verify: Slack message appears within ~30 seconds
3. Verify: a branch named per the issue is created in the Fiona repo
4. Verify: `agent-execution.yml` workflow run appears in GitHub Actions tab
5. Verify: after GHA completes, a draft PR is created linking to the test issue
6. Verify: issue has a comment if the run failed

Document actual observed behavior vs expected in a test log.

### 7.3 — Failure path test

Steps:
1. Label a deliberately ambiguous/malformed issue with `agent-ready`
2. Verify: the orchestration fails gracefully
3. Verify: a failure comment is posted to the issue with a readable summary
4. Verify: no partial branch or empty PR is left in an inconsistent state

### 7.4 — Write operator runbook

Create `docs/runbooks/issue-to-pr-operator.md` covering:

- **How to monitor runs:** Durable management API endpoint, Azure Portal → Functions → Monitor, Cosmos DB `agent-runs` container
- **How to check a specific orchestration:** `GET /runtime/webhooks/durabletask/instances/{instanceId}`
- **How to retry a failed orchestration:** terminate the stuck instance and restart with the same input payload
- **How to debug tool errors:** check Azure Monitor logs for the agent run; tool dispatch is in-process in `agent-runner.js`, so failures appear inline with the orchestration logs (correlate by `instanceId`)
- **How to debug agent run failures:** check Application Insights traces for the `StartAgentEdits`/`AgentReactToResult` activities; the Foundry Claude endpoint's request IDs appear in the SDK error. Correlate by `instanceId`
- **Common failure modes:**
  - `agent-execution.yml` missing from target repo → add the file and re-label the issue
  - GitHub token expired mid-run → token caching in `github-client.js` should prevent; check Key Vault secret expiry
  - Foundry endpoint unreachable → check AI Foundry resource health in Azure Portal
  - `write_file` fails with 422 → file may exceed 1 MB limit; Phase 2 item to upgrade to Git Data API

**Acceptance criteria:**
- Staging happy-path test passes with a draft PR created
- Failure-path comment appears on the issue
- Runbook covers all documented risk items from the design spec
- All CI checks pass on the branch before PR is opened

---

## Open Items to Resolve Before Starting

| Item | Status | Resolution |
|---|---|---|
| Key Vault name & RG | **RESOLVED** | `fiona-kv-bronze` in `edfi-fiona-rg` (no `fiona-kv` exists). Confirmed via `az` 2026-06-24. |
| Cosmos DB account name | **RESOLVED** | `fiona-db-dev-cosmos` in `edfi-fiona-rg`; endpoint `https://fiona-db-dev-cosmos.documents.azure.com:443/`. |
| AI Foundry resource | **RESOLVED** | New Foundry resource + project + `claude-opus-4-8` deployment in `edfi-fiona-rg`, **region `eastus2`** (Claude-on-Foundry is East US2 / Sweden Central only). Base on the [starter-kit Bicep](https://github.com/Azure-Samples/claude). |
| Agent layer | **RESOLVED — Path B (Phase 3.0)** | Anthropic SDK on Foundry (`@anthropic-ai/foundry-sdk`) with a **self-owned tool-use loop**; `@azure/ai-projects` dropped. Claude reached via Foundry endpoint + managed-identity Entra ID auth (no API key). |
| Long-running agent execution | **RESOLVED** | Orchestrator owns the GHA polling loop via `df.createTimer`; agent dispatches then yields. Stay on Consumption plan (#2). |
| Tool server / MCP auth | **RESOLVED — moot under Path B** | No remote MCP server; the nine GitHub handlers are dispatched in-process by `agent-runner.js`. `McpToolServer.js` not built for MVP (#3 no longer applies). |
| Idempotency & branch naming | **RESOLVED** | Deterministic instanceId `${repo}#${issue}` + purge-on-rerun (#5); orchestrator-computed `agent/issue-{n}-{slug}` (#6). |
| Claude model identifier in Foundry | **RESOLVED** | Foundry deployment name `claude-opus-4-8` (pinned, not the `opus` alias); passed as the Messages API `model` field. |
| GHA deployment auth | **RESOLVED** | Existing pattern confirmed: `azure/login@532459ea530d8321f2fb9bb10d1e0bcf23869a43 # v3.0.0` with `creds: ${{ secrets.AZURE_CREDENTIALS }}` (service principal JSON). Secret stored at `production` environment level. Phase 6.3 updated to match. |
| Slack webhook URL | **RESOLVED** | Confirmed URL for fiona-bug-agent channel. Store in Key Vault as `slack-webhook-url`. Reference via Key Vault reference in app settings. Never hardcode in source or config. |

---

## File Checklist

### New files to create

```
apps/issue-to-pr-function/
  local.settings.json.example          (update with all vars — Phase 0.5)
  src/
    functions/
      WorkflowOrchestrator.js          (Phase 4)
      WorkflowActivities.js            (Phase 4)
    lib/
      github-client.js                 (Phase 1)
      agent-runner.js                  (Phase 3 — Anthropic-on-Foundry, self-owned loop, in-process tool dispatch)
      mcp-handlers/                    (Phase 2 — invoked in-process by agent-runner, not via HTTP)
        read-issue.js                  (Phase 2)
        list-directory.js              (Phase 2)
        read-file.js                   (Phase 2)
        write-file.js                  (Phase 2)
        create-branch.js               (Phase 2)
        run-validation.js              (Phase 2)
        get-validation-status.js       (Phase 2)
        create-draft-pr.js             (Phase 2)
        add-issue-comment.js           (Phase 2)
  test/
    github-client.test.js              (Phase 1)
    WorkflowActivities.test.js         (Phase 4)
    mcp-handlers/
      read-issue.test.js               (Phase 2)
      list-directory.test.js           (Phase 2)
      read-file.test.js                (Phase 2)
      write-file.test.js               (Phase 2)
      create-branch.test.js            (Phase 2)
      run-validation.test.js           (Phase 2)
      get-validation-status.test.js    (Phase 2)
      create-draft-pr.test.js          (Phase 2)
      add-issue-comment.test.js        (Phase 2)
    integration/
      pipeline.test.js                 (Phase 7)

infra/issue-to-pr/
  main.bicep                           (Phase 0)
  modules/
    functions.bicep                    (Phase 0)
    ai-foundry.bicep                   (Phase 0)
    cosmos-container.bicep             (Phase 0)

.github/workflows/
  agent-execution.yml                  (Phase 6)
  on-pullrequest-issue-to-pr.yml       (Phase 6)
  deploy-issue-to-pr-function.yml      (Phase 6)

docs/runbooks/
  issue-to-pr-operator.md             (Phase 7)
```

### Already done (do not recreate)

```
apps/issue-to-pr-function/
  src/functions/GitHubWebhookReceiver.js   (Phase 5.0 will amend: idempotency + branch slug)
  src/lib/webhook-validator.js
  test/webhook-validator.test.js
  test/GitHubWebhookReceiver.test.js
  package.json / host.json / biome.json / jest.config.js
```
