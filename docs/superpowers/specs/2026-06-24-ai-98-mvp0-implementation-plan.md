# AI-98 MVP0 — Issue-to-PR Pipeline: Implementation Plan

**Date:** 2026-06-24
**Jira:** [AI-98](https://edfi.atlassian.net/browse/AI-98)
**Design spec:** `docs/superpowers/specs/2026-06-16-ai-98-issue-to-pr-design.md`
**Branch:** `ai-98-hitl-bug`
**Status:** Ready for implementation

---

## Overview

This plan covers the full MVP0 build of the `issue-to-pr-function` pipeline: an Azure Durable Functions app that listens for `agent-ready` GitHub label events, invokes a Claude agent via Azure AI Agent Service, and produces a draft PR. The HITL gate is the label itself — no secondary approval gate.

Phases are ordered by dependency: each phase produces artifacts that the next phase depends on.

**What is already done:**
- `apps/issue-to-pr-function/src/functions/GitHubWebhookReceiver.js` — HTTP trigger, HMAC validation, label filtering, Durable client handoff
- `apps/issue-to-pr-function/src/lib/webhook-validator.js` — constant-time HMAC-SHA256 verification
- `apps/issue-to-pr-function/test/webhook-validator.test.js` — full unit test coverage
- Project scaffold: `package.json`, `host.json`, `biome.json`, `jest.config.js`

---

## Phase 0 — Prerequisites & Platform Setup

**Goal:** All infrastructure and secrets exist before any code is written. Nothing blocks Phase 1.

### 0.1 — Confirm existing Azure resource names

Before writing any Bicep parameters, verify:

- Which resource group `fiona-kv` is in — design assumes `edfi-fiona-rg` but it may be `fiona-rg`. Run: `az keyvault list --query "[].{name:name,rg:resourceGroup}" -o table`
- Cosmos DB account name — required as a Bicep parameter for the new container. Run: `az cosmosdb list -g edfi-fiona-rg --query "[].name" -o table`
- Whether an AI Foundry Hub already exists in the subscription. Run: `az cognitiveservices account list --query "[?kind=='AIServices'].{name:name,rg:resourceGroup}" -o table`

Document confirmed values in a `infra/issue-to-pr/params.dev.json` file (not committed — add to `.gitignore`).

**Acceptance criteria:**
- Key Vault resource group confirmed
- Cosmos DB account name confirmed
- AI Foundry Hub status confirmed
- `params.dev.json` exists locally for use during Bicep deployment

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

Add three secrets to `fiona-kv`:

| Secret name | Value |
|---|---|
| `github-app-private-key` | Full contents of the downloaded `.pem` file |
| `github-webhook-secret` | The webhook secret generated in 0.2 |
| `anthropic-api-key` | Anthropic API key for Claude access |

Also note the GitHub App ID — it will be needed as an app setting (not a secret).

```bash
az keyvault secret set --vault-name fiona-kv --name github-app-private-key --file ./fiona-issue-to-pr.pem
az keyvault secret set --vault-name fiona-kv --name github-webhook-secret --value "<value>"
az keyvault secret set --vault-name fiona-kv --name anthropic-api-key --value "<value>"
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
- App settings (Key Vault references for secrets):
  - `GITHUB_WEBHOOK_SECRET` → `@Microsoft.KeyVault(SecretUri=...github-webhook-secret...)`
  - `GITHUB_APP_PRIVATE_KEY` → `@Microsoft.KeyVault(SecretUri=...github-app-private-key...)`
  - `ANTHROPIC_API_KEY` → `@Microsoft.KeyVault(SecretUri=...anthropic-api-key...)`
  - `GITHUB_APP_ID` → plain value (not a secret)
  - `AI_FOUNDRY_ENDPOINT` → plain value (Foundry project endpoint)
  - `COSMOS_ENDPOINT` → plain value
  - `SLACK_WEBHOOK_URL` → Key Vault reference or plain (not sensitive but treat as secret)

#### `infra/issue-to-pr/modules/ai-foundry.bicep`

Provisions (skip Hub creation if one already exists — see 0.1):
- AI Foundry Hub: `fiona-ai-hub`
- AI Foundry Project: `fiona-issue-to-pr`
- Output: project endpoint URL (used in Functions app settings)

Note: The agent definition itself is created at runtime by `agent-runner.js`, not by IaC.

#### `infra/issue-to-pr/modules/cosmos-container.bicep`

Adds to the existing Cosmos DB account and `chatbot` database:
- Container: `agent-runs`
- Partition key: `/repoFullName`
- Default TTL: 7,776,000 seconds (90 days)
- Composite indexes:
  - `[repoFullName ASC, createdAt ASC]`
  - `[status ASC, createdAt ASC]`

#### `infra/issue-to-pr/main.bicep`

- Parameters: `cosmosAccountName`, `keyVaultName`, `keyVaultResourceGroup`, `location`
- Invokes all three modules
- RBAC assignments on the Functions app managed identity:
  - `Key Vault Secrets User` on `fiona-kv`
  - `Cosmos DB Built-in Data Contributor` on the Cosmos DB account

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
- MI has Key Vault Secrets User and Cosmos DB Built-in Data Contributor roles
- AI Foundry Hub + Project exist and endpoint is reachable
- `agent-runs` container exists with correct partition key and TTL
- Key Vault references resolve (visible in Functions app → Configuration → Values show)

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
    "AI_FOUNDRY_ENDPOINT": "",
    "COSMOS_ENDPOINT": "",
    "SLACK_WEBHOOK_URL": ""
  }
}
```

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
- Call `POST /app/installations` to find the installation ID for a given owner/repo
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

## Phase 2 — MCP Tool Server

**Goal:** A running Azure Function that accepts JSON-RPC 2.0 requests and routes them to the correct GitHub operation. The Azure AI Agent Service connects to this endpoint as the agent's tool server.

**Prerequisite:** Phase 1 (auth layer)

### 2.1 — Write `src/functions/McpToolServer.js`

Responsibilities:
- HTTP trigger, accepts `POST` at route `mcp`
- Parse body as JSON-RPC 2.0 (`{ jsonrpc, id, method, params }`)
- Route `method` to the correct handler in `src/lib/mcp-handlers/`
- Return `{ jsonrpc: "2.0", id, result }` on success
- Return `{ jsonrpc: "2.0", id, error: { code, message } }` on handler error
- Return `-32601 Method not found` for unknown methods

### 2.2 — Write MCP handlers

One file per tool in `src/lib/mcp-handlers/`. Each handler receives `params` (the JSON-RPC params object) and returns a plain JS object (the result). All use `getInstallationToken` from `github-client.js`.

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
- Params: `{ owner, repo, branch, fromBranch? }` (`fromBranch` defaults to repo default branch)
- Calls: `GET /repos/{owner}/{repo}/git/ref/heads/{fromBranch}` to get HEAD SHA, then `POST /repos/{owner}/{repo}/git/refs`
- Returns: `{ branch, sha }`
- Errors: descriptive message if branch already exists (422)

#### `run-validation.js`
- Params: `{ owner, repo, branch }`
- Calls: `POST /repos/{owner}/{repo}/dispatches` with `{ event_type: "agent-validation", client_payload: { branch } }`
- Records `dispatchedAt` timestamp (ISO string)
- Returns: `{ dispatchedAt }` — the agent uses this with `get-validation-status` to find the correct run

Implementation note: GitHub's `repository_dispatch` API does not return the triggered run ID. `get-validation-status` must find the run by listing workflow runs filtered by branch, event type, and created-after time. Return `dispatchedAt` so the polling handler can use it as a lower bound.

#### `get-validation-status.js`
- Params: `{ owner, repo, branch, dispatchedAt }`
- Calls: `GET /repos/{owner}/{repo}/actions/runs?branch={branch}&event=repository_dispatch&created=>={dispatchedAt}`
- Finds the most recent matching run
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
- `McpToolServer.js` routes to correct handler and returns valid JSON-RPC 2.0 envelope
- Unknown method returns `-32601` error code

---

## Phase 3 — Agent Runner

**Goal:** A module that creates/retrieves the Claude agent definition in Azure AI Agent Service, starts a run for a given issue, and returns a structured result.

**Prerequisite:** Phase 2 (MCP Tool Server must be deployed or running locally with a reachable URL)

### 3.1 — Write `src/lib/agent-runner.js`

Responsibilities:
- Initialize `@azure/ai-projects` `AIProjectsClient` using the `AI_FOUNDRY_ENDPOINT` env var and `DefaultAzureCredential` (managed identity in production, developer credential locally)
- On first call, create or retrieve the agent definition named `fiona-coding-agent`:
  - Model: Claude via Anthropic endpoint configured in the Foundry project
  - System prompt: TDD prompt from the design spec (see below)
  - Tools: MCP tool server connected at `{MCP_TOOL_SERVER_URL}/api/mcp`
- Start a thread and run for the given issue context
- Poll the run status until terminal state (`completed`, `failed`, `cancelled`)
- On `completed`: extract the last assistant message and parse for PR URL
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
- `AI_FOUNDRY_ENDPOINT` — Foundry project endpoint URL
- `MCP_TOOL_SERVER_URL` — base URL of the deployed MCP tool server (e.g., `https://issue-to-pr-function.azurewebsites.net`)

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
- `agent-runner.js` starts a run against the live Foundry Agent Service in dev
- A Cosmos DB record is written and updated for each run
- Successful runs return `{ status: 'completed', prUrl, summary }`
- Failed runs return `{ status: 'failed', summary, error }`
- MCP tools are reachable from the agent during a run (verify in Foundry run history)

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

#### `StartAgentRun`
- Input: `{ repoFullName, issueNumber, issueTitle, issueBody, baseBranch, instanceId }`
- Calls `agent-runner.js` `runAgent(input)`
- Returns the structured result from `agent-runner.js`

#### `PostIssueComment`
- Input: `{ repoFullName, issueNumber, body }`
- Parses `owner` and `repo` from `repoFullName`
- Calls `add-issue-comment` handler directly (not via MCP wire protocol)
- Returns `{ commentId, commentUrl }`

### 4.2 — Write `src/functions/WorkflowOrchestrator.js`

```javascript
// Orchestrator function — must be a generator (Durable requirement)
orchestrator(context):
  const input = context.df.getInput()

  // Informational Slack message — non-blocking, failures do not abort
  yield context.df.callActivity('PostSlackNotification', {
    repoFullName: input.repoFullName,
    issueNumber: input.issueNumber,
    issueTitle: input.issueTitle
  })

  // Run the agent
  const result = yield context.df.callActivity('StartAgentRun', {
    ...input,
    instanceId: context.df.instanceId
  })

  // If agent failed, post a comment to the issue
  if (result.status === 'failed') {
    yield context.df.callActivity('PostIssueComment', {
      repoFullName: input.repoFullName,
      issueNumber: input.issueNumber,
      body: `### Fiona agent run failed\n\n${result.summary}\n\n**Error:** ${result.error}`
    })
  }
```

### 4.3 — Write unit tests for activities

Location: `test/WorkflowActivities.test.js`

- `PostSlackNotification`: mock `fetch`, verify correct Slack payload; verify non-throw on Slack error
- `StartAgentRun`: mock `agent-runner`, verify result is passed through
- `PostIssueComment`: mock `add-issue-comment` handler, verify comment body is correct

**Acceptance criteria:**
- `npm test` passes for activity tests
- Starting a Durable orchestration (via local emulator or staging) runs activities in correct order
- A failed `StartAgentRun` result triggers `PostIssueComment`
- `PostSlackNotification` failure does not abort the orchestration

---

## Phase 5 — Ingress Completion

**Goal:** The already-built webhook receiver loads its secret from Key Vault (via app settings) and can be smoke-tested end-to-end against the local Functions emulator.

**Prerequisite:** Phase 0.4 (Functions app provisioned with Key Vault references), Phase 4 (orchestrator registered)

### 5.1 — Wire Key Vault reference in app settings

The `GitHubWebhookReceiver.js` already reads `process.env.GITHUB_WEBHOOK_SECRET`. The Key Vault reference in the Functions app settings handles this automatically in production. Verify locally using the value from `local.settings.json`.

No code changes required unless the env var name differs — confirm `GITHUB_WEBHOOK_SECRET` matches the app setting name in `main.bicep`.

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

permissions:
  id-token: write
  contents: read

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

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to Azure Functions
        uses: azure/functions-action@v1
        with:
          app-name: issue-to-pr-function
          package: apps/issue-to-pr-function
          respect-funcignore: true
```

Required GitHub secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
Set up a federated credential on the deployment service principal for the `main` branch of this repo.

**Acceptance criteria:**
- `agent-execution.yml` can be triggered via `repository_dispatch` with `event_type: agent-validation` and a `branch` payload; runs lint and tests on the specified branch
- PR workflow triggers on PRs touching `apps/issue-to-pr-function/**` or `infra/issue-to-pr/**`
- Deploy workflow triggers on push to `main` with matching path changes
- Deploy workflow uses OIDC (no long-lived secrets)

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
- **How to debug MCP tool errors:** check Azure Monitor logs for `McpToolServer` function, filter by `x-ms-request-id`
- **How to debug agent run failures:** check Foundry Agent Service run history in Azure AI Studio, correlate by `instanceId`
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

| Item | Decision needed |
|---|---|
| Key Vault resource group | Confirm `fiona-kv` is in `edfi-fiona-rg` or `fiona-rg` (Phase 0.1) |
| AI Foundry Hub | Confirm whether one already exists in the subscription (Phase 0.1) |
| Cosmos DB account name | Confirm exact name for Bicep parameter (Phase 0.1) |
| Claude model identifier in Foundry | Confirm the model name/deployment name for Claude in the Foundry project (Phase 3) |
| OIDC deployment principal | Create or identify the service principal + federated credential for the deploy workflow (Phase 6.3) |
| Slack webhook URL | Obtain or create the webhook URL for the Fiona Slack channel (Phase 4.1) |

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
      McpToolServer.js                 (Phase 2)
    lib/
      github-client.js                 (Phase 1)
      agent-runner.js                  (Phase 3)
      mcp-handlers/
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
  src/functions/GitHubWebhookReceiver.js
  src/lib/webhook-validator.js
  test/webhook-validator.test.js
  package.json / host.json / biome.json / jest.config.js
```
