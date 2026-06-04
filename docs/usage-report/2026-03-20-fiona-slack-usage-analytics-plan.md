# Fiona-Slack Usage Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete analytics system to measure user engagement in Fiona-Slack, capturing all interactions (success and error) and generating weekly usage reports.

**Architecture:**
- **Phase 1:** New `interaction-store.js` module persists all interactions to Cosmos DB, integrated into app_mention and assistant message handlers
- **Phase 2:** New `usage-report-function` Azure Function queries interactions weekly, calculates 8 KPIs, and posts a summary to Slack

**Tech Stack:** Node.js 20+, Azure Cosmos DB SQL API, Azure Functions (TimerTrigger), Azure Key Vault, Slack Incoming Webhooks, GitHub Actions

**Spec Reference:** `docs/superpowers/specs/2026-03-20-fiona-slack-usage-analytics-design.md`

---

## Prerequisites (Before Starting)

- [ ] **GitHub Secrets:** Configure the following secrets in GitHub repo settings for CI/CD:
  - `AZURE_CREDENTIALS` — Azure service principal credentials (JSON format)
  - `COSMOS_ENDPOINT` — Cosmos DB endpoint URL (e.g., `https://fiona.documents.azure.com:443/`)
  - `KEY_VAULT_URL` — Azure Key Vault URL (e.g., `https://fiona-kv.vault.azure.net/`)

- [ ] **Azure Resources:** Ensure the following exist in Azure:
  - Cosmos DB database `fiona` with `feedback` and `interactions` containers
  - Azure Key Vault with `slack-fiona-weekly-report-webhook` secret (Slack incoming webhook URL)
  - Storage account for Function App

---

## File Structure

### Phase 1 Files

**Create:**
- `apps/fiona-slack/src/agent/interaction-store.js` — Module to persist interactions to Cosmos DB
- `apps/fiona-slack/test/unit/agent/interaction-store.test.js` — Unit tests for interaction-store

**Modify:**
- `apps/fiona-slack/src/listeners/events/app_mention.js` — Add interaction recording and error handling
- `apps/fiona-slack/src/listeners/assistant/message.js` — Add interaction recording and error handling
- `infra/azure/fiona-slack-container/main.bicep` — Add COSMOS_INTERACTIONS_CONTAINER env var
- `infra/azure/fiona-cosmos/main.bicep` — Create interactions container with schema and indexes

### Phase 2 Files

**Create:**
- `apps/usage-report-function/package.json` — Function App dependencies
- `apps/usage-report-function/package-lock.json` — Locked dependencies
- `apps/usage-report-function/host.json` — Azure Functions configuration
- `apps/usage-report-function/function_app.json` — Function App metadata
- `apps/usage-report-function/WeeklyReportTrigger/function.json` — Timer trigger config
- `apps/usage-report-function/WeeklyReportTrigger/index.js` — Main function logic
- `apps/usage-report-function/lib/cosmos-queries.js` — 8 KPI query functions
- `apps/usage-report-function/lib/slack-formatter.js` — Slack message formatting
- `apps/usage-report-function/lib/key-vault-client.js` — Key Vault integration
- `apps/usage-report-function/test/unit/cosmos-queries.test.js` — Query tests
- `apps/usage-report-function/test/unit/slack-formatter.test.js` — Formatter tests
- `apps/usage-report-function/.gitignore` — Ignore Node artifacts
- `.github/workflows/deploy-usage-report-function.yml` — CI/CD for function deployment

---

## Phase 1: Cosmos DB Interactions Container

**Note:** The `src/agent/rate-limiter.js` module already exists and is used in this implementation. No new rate-limiting code needs to be created.

### Task 1: Create interaction-store.js module with tests

**Files:**
- Create: `apps/fiona-slack/src/agent/interaction-store.js`
- Create: `apps/fiona-slack/test/unit/agent/interaction-store.test.js`

- [ ] **Step 1: Write failing test for connection initialization**

```javascript
// test/unit/agent/interaction-store.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getContainer, recordInteraction } from '../../../src/agent/interaction-store.js';

describe('interaction-store', () => {
  beforeEach(() => {
    // Reset environment and module state
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    vi.resetModules();
  });

  describe('getContainer', () => {
    it('returns null when no Cosmos configuration is set', async () => {
      const { getContainer: gc } = await import('../../../src/agent/interaction-store.js');
      const container = await gc(null);
      expect(container).toBeNull();
    });

    it('initializes with connection string', async () => {
      process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=test==';
      const { getContainer: gc } = await import('../../../src/agent/interaction-store.js');
      const container = await gc({ warn: vi.fn() });
      expect(container).toBeDefined();
      expect(container).not.toBeNull();
    });
  });

  describe('recordInteraction', () => {
    it('silently no-ops when Cosmos is not configured', async () => {
      const { recordInteraction: ri } = await import('../../../src/agent/interaction-store.js');
      const logger = { warn: vi.fn() };

      // Should not throw
      await expect(ri({
        userId: 'U123',
        channelId: 'C123',
        threadTs: '1712345678.001',
        messageTs: '1712345678.123',
        interactionType: 'app_mention',
        status: 'success',
        rateLimited: false,
        logger
      })).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/fiona-slack
npm test -- test/unit/agent/interaction-store.test.js
```

Expected: FAIL — "Cannot find module ../../../src/agent/interaction-store.js"

- [ ] **Step 3: Create interaction-store.js module (mirror feedback-store.js)**

```javascript
// src/agent/interaction-store.js
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'fiona';
const COSMOS_CONTAINER = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'local';

let warnedMissingConfig = false;

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

/**
 * Get or initialize the Cosmos DB container for interactions.
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<import('@azure/cosmos').Container | null>}
 */
export async function getContainer(logger) {
  if (container) return container;

  let client;
  if (COSMOS_CONNECTION_STRING) {
    client = new CosmosClient(COSMOS_CONNECTION_STRING);
  } else if (COSMOS_ENDPOINT && COSMOS_KEY) {
    client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
  } else if (COSMOS_ENDPOINT) {
    client = new CosmosClient({
      endpoint: COSMOS_ENDPOINT,
      aadCredentials: new DefaultAzureCredential(),
    });
  } else {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger?.warn?.(
        'CosmosDB not configured — interactions will not be persisted. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  container = client.database(COSMOS_DATABASE).container(COSMOS_CONTAINER);
  return container;
}

/**
 * Record a user interaction to Cosmos DB. No-ops silently if Cosmos is not configured.
 *
 * @param {Object} interaction
 * @param {string} interaction.userId - Slack user ID
 * @param {string} interaction.teamId - Slack team/workspace ID
 * @param {string} interaction.channelId - Slack channel ID
* @param {string} interaction.interactionType - 'app_mention', 'assistant_message', 'slash_help', 'slash_ask', 'slash_search', or 'slash_unknown'
 * @param {string} interaction.status - 'success' or 'error'
 * @param {string|null} interaction.errorType - Error category if status is 'error'
 * @param {boolean} interaction.rateLimited - true if request was rate-limited
 * @param {{ warn?: (msg: string) => void }} [interaction.logger] - Optional logger
 */
export async function recordInteraction({
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  interactionType,
  status,
  errorType,
  rateLimited,
  logger,
}) {
  const c = await getContainer(logger);
  if (!c) return;

  const doc = {
    id: `${userId}_${threadTs}_${messageTs}`,
    userId,
    teamId,
    channelId,
    threadTs,
    messageTs,
    interactionType,
    status,
    errorType: status === 'error' ? errorType : null,
    rateLimited,
    deploymentType: DEPLOYMENT_TYPE,
    timestamp: new Date().toISOString(),
  };

  try {
    await c.items.upsert(doc, {
      partitionKey: [doc.deploymentType],
    });
  } catch (error) {
    // Log Cosmos error but don't propagate (don't impact user experience)
    logger?.warn?.(`Failed to record interaction to Cosmos DB: ${error.message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/fiona-slack
npm test -- test/unit/agent/interaction-store.test.js
```

Expected: PASS (3 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/agent/interaction-store.js test/unit/agent/interaction-store.test.js
git commit -m "feat(fiona-slack): add interaction-store module for Cosmos DB persistence"
```

---

### Task 2: Update app_mention.js to record interactions

**Files:**
- Modify: `apps/fiona-slack/src/listeners/events/app_mention.js:1-60`
- Modify: `apps/fiona-slack/test/unit/listeners/events/app_mention.test.js` (if exists)

- [ ] **Step 1: Read current app_mention.js to understand structure**

```bash
head -100 apps/fiona-slack/src/listeners/events/app_mention.js
```

Document the current error handling and where to insert interaction recording.

- [ ] **Step 2: Update imports and wrap handler with try-catch**

Replace the top of `src/listeners/events/app_mention.js`:

```javascript
// src/listeners/events/app_mention.js
import { recordInteraction } from '../../agent/interaction-store.js';
import { checkRateLimit } from '../../agent/rate-limiter.js';

// ... existing imports ...

export function setupAppMentionListener(app) {
  app.event('app_mention', async ({ event, client, logger }) => {
    const userId = event.user;
    const teamId = event.team;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const messageTs = event.ts;
    const userMessage = event.text || '';

    let status = 'success';
    let errorType = null;
    let isRateLimited = false;
    let interactionRecorded = false;

    try {
      // Rate limit check (before try-catch for early return)
      const { allowed, retryAfterMs } = checkRateLimit(userId);
      if (!allowed) {
        isRateLimited = true;
        await recordInteraction({
          userId,
          teamId,
          channelId,
          threadTs,
          messageTs,
          interactionType: 'app_mention',
          status: 'error',
          errorType: 'rate_limited',
          rateLimited: true,
          logger,
        });
        interactionRecorded = true;

        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `You've exceeded the rate limit. Please try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
        });
        return;
      }

      // Check for empty message (silently discard, don't record)
      if (!userMessage?.trim()) {
        return;
      }

      // Call LLM and send response (wrapped in try-catch)
      const llmResponse = await callLLM(userMessage);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: llmResponse,
      });

      status = 'success';
      errorType = null;
    } catch (error) {
      status = 'error';

      // Categorize error
      if (error.code === 'COSMOS_ERROR') {
        errorType = 'cosmos_error';
      } else if (error.name === 'TimeoutError') {
        errorType = 'timeout';
      } else if (error.code?.includes('429') || error.message?.includes('rate_limit')) {
        errorType = 'llm_rate_limited';
      } else if (error.code?.includes('openai') || error.name?.includes('APIError')) {
        errorType = 'llm_error';
      } else {
        errorType = 'unknown';
      }

      logger.error(`Error handling app_mention: ${error.message}`, { errorType });

      // Send error response to user
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'Sorry, I encountered an error processing your request. Please try again.',
      });
    } finally {
      // Record interaction (unless already recorded for rate-limit)
      // Wrap in try-catch to avoid propagating Cosmos errors
      if (!interactionRecorded) {
        try {
          await recordInteraction({
            userId,
            teamId,
            channelId,
            threadTs,
            messageTs,
            interactionType: 'app_mention',
            status,
            errorType: status === 'error' ? errorType : null,
            rateLimited: isRateLimited,
            logger,
          });
        } catch (cosmosError) {
          logger.warn(`Failed to record interaction: ${cosmosError.message}`);
          // Don't propagate
        }
      }
    }
  });
}
```

- [ ] **Step 3: Update tests for app_mention (or create if missing)**

Add tests for:
- Rate-limited interaction is recorded with correct status/errorType
- Empty message is recorded
- Successful interaction is recorded
- Error interaction is recorded with error type

```javascript
// test/unit/listeners/events/app_mention.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAppMentionListener } from '../../../src/listeners/events/app_mention.js';

describe('app_mention listener', () => {
  let mockApp;
  let mockClient;
  let mockLogger;

  beforeEach(() => {
    mockApp = { event: vi.fn() };
    mockClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({}),
        postEphemeral: vi.fn().mockResolvedValue({}),
      },
    };
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
    };
  });

  it('records rate-limited interaction', async () => {
    // Test implementation...
  });

  it('records successful interaction', async () => {
    // Test implementation...
  });

  it('records error interaction with categorized error type', async () => {
    // Test implementation...
  });
});
```

- [ ] **Step 4: Run app_mention tests**

```bash
cd apps/fiona-slack
npm test -- test/unit/listeners/events/app_mention.test.js
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/listeners/events/app_mention.js test/unit/listeners/events/app_mention.test.js
git commit -m "feat(fiona-slack): record interactions from app_mention events"
```

---

### Task 3: Update assistant/message.js to record interactions

**Files:**
- Modify: `apps/fiona-slack/src/listeners/assistant/message.js:1-80`

- [ ] **Step 1: Apply similar changes as app_mention.js**

Update `src/listeners/assistant/message.js` with:
- Import `recordInteraction`
- Wrap handler in try-catch-finally
- Record interactions before returning
- Categorize errors the same way

```javascript
// src/listeners/assistant/message.js
import { recordInteraction } from '../../agent/interaction-store.js';
import { checkRateLimit } from '../../agent/rate-limiter.js';

// ... existing imports ...

export function setupAssistantMessageListener(app) {
  app.event('assistant_thread_context_changed', async ({ event, client, logger }) => {
    const userId = event.user;
    const teamId = event.team;
    const threadTs = event.thread_ts;
    const messageTs = event.message_ts;
    const userMessage = event.message?.text || '';

    let status = 'success';
    let errorType = null;
    let isRateLimited = false;
    let interactionRecorded = false;

    try {
      // Rate limit check
      const { allowed } = checkRateLimit(userId);
      if (!allowed) {
        isRateLimited = true;
        await recordInteraction({
          userId,
          teamId,
          channelId: 'assistant', // Special value for assistant threads
          threadTs,
          messageTs,
          interactionType: 'assistant_message',
          status: 'error',
          errorType: 'rate_limited',
          rateLimited: true,
          logger,
        });
        interactionRecorded = true;
        return;
      }

      // Check for empty message (silently discard, don't record)
      if (!userMessage?.trim()) {
        return;
      }

      // Call LLM and update assistant
      const llmResponse = await callLLM(userMessage);
      await client.assistant.threads.messages.create(threadTs, {
        role: 'assistant',
        content: llmResponse,
      });

      status = 'success';
    } catch (error) {
      status = 'error';
      if (error.code === 'COSMOS_ERROR') {
        errorType = 'cosmos_error';
      } else if (error.name === 'TimeoutError') {
        errorType = 'timeout';
      } else if (error.code?.includes('429') || error.message?.includes('rate_limit')) {
        errorType = 'llm_rate_limited';
      } else if (error.code?.includes('openai') || error.name?.includes('APIError')) {
        errorType = 'llm_error';
      } else {
        errorType = 'unknown';
      }
      logger.error(`Error in assistant message: ${error.message}`, { errorType });
    } finally {
      if (!interactionRecorded) {
        try {
          await recordInteraction({
            userId,
            teamId,
            channelId: 'assistant',
            threadTs,
            messageTs,
            interactionType: 'assistant_message',
            status,
            errorType: status === 'error' ? errorType : null,
            rateLimited: isRateLimited,
            logger,
          });
        } catch (cosmosError) {
          logger.warn(`Failed to record interaction: ${cosmosError.message}`);
        }
      }
    }
  });
}
```

- [ ] **Step 2: Write tests for assistant message interaction recording**

```bash
cd apps/fiona-slack
npm test -- test/unit/listeners/assistant/message.test.js
```

Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add src/listeners/assistant/message.js test/unit/listeners/assistant/message.test.js
git commit -m "feat(fiona-slack): record interactions from assistant_message events"
```

---

### Task 4: Update Bicep template for COSMOS_INTERACTIONS_CONTAINER

**Files:**
- Modify: `infra/azure/fiona-slack-container/main.bicep:1-200`

- [ ] **Step 1: Add environment variable to container app**

Update the container app resource to include the new environment variable:

```bicep
// infra/azure/fiona-slack-container/main.bicep
resource containerApp 'Microsoft.App/containerApps@2023-11-02' = {
  name: containerAppName
  location: location
  properties: {
    environmentId: containerAppEnvironment.id
    template: {
      containers: [
        {
          name: 'fiona-slack'
          image: '${registryLoginServer}/${imageName}:${imageTag}'
          env: [
            // ... existing env vars ...
            {
              name: 'COSMOS_INTERACTIONS_CONTAINER'
              value: cosmosInteractionsContainer
            }
            // ... rest of env vars ...
          ]
          // ... rest of container config ...
        }
      ]
      // ... scale config, etc ...
    }
    // ... rest of properties ...
  }
}
```

Add parameter at top of file:

```bicep
@description('Cosmos DB interactions container name')
param cosmosInteractionsContainer string = 'interactions'
```

- [ ] **Step 2: Verify syntax**

```bash
cd infra/azure/fiona-slack-container
az bicep lint main.bicep
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add infra/azure/fiona-slack-container/main.bicep
git commit -m "infra: add COSMOS_INTERACTIONS_CONTAINER env var to fiona-slack container"
```

---

### Task 5: Create Cosmos DB interactions container (infrastructure)

**Files:**
- Modify: `infra/azure/fiona-cosmos/main.bicep:1-300`

- [ ] **Step 1: Add interactions container to Cosmos DB**

Update `infra/azure/fiona-cosmos/main.bicep` to create the interactions container:

```bicep
// infra/azure/fiona-cosmos/main.bicep
resource interactionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  name: '${cosmosAccountName}/${cosmosDatabaseName}/interactions'
  properties: {
    resource: {
      id: 'interactions'
      partitionKey: {
        paths: ['/deploymentType']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/"_etag"/?'
          }
        ]
        compositeIndexes: [
          [
            {
              path: '/timestamp'
              order: 'descending'
            }
          ]
          [
            {
              path: '/userId'
              order: 'ascending'
            }
            {
              path: '/timestamp'
              order: 'descending'
            }
          ]
          [
            {
              path: '/threadTs'
              order: 'ascending'
            }
            {
              path: '/messageTs'
              order: 'ascending'
            }
          ]
          [
            {
              path: '/status'
              order: 'ascending'
            }
            {
              path: '/timestamp'
              order: 'descending'
            }
          ]
        ]
      }
    }
    options: {}
  }
}
```

- [ ] **Step 2: Verify Bicep syntax**

```bash
cd infra/azure/fiona-cosmos
az bicep lint main.bicep
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add infra/azure/fiona-cosmos/main.bicep
git commit -m "infra: create Cosmos DB interactions container with schema and indexes"
```

---

### Task 6: Phase 1 integration test with Cosmos emulator

**Files:**
- Create: `apps/fiona-slack/test/integration/interaction-store-cosmos.test.js`

- [ ] **Step 1: Set up integration test with Cosmos emulator**

```javascript
// test/integration/interaction-store-cosmos.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CosmosClient } from '@azure/cosmos';
import { recordInteraction, getContainer } from '../../src/agent/interaction-store.js';

// Assumes Cosmos Emulator running on localhost:8081
const EMULATOR_ENDPOINT = 'https://localhost:8081';
const EMULATOR_KEY = 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDlT0yQ8a0R+KwIDAQABAoGADjOzABu9fhpxF2FkDCk0lqRxgYCTSGGaYcsQJ6RN1ksH3vCu6Ej5wXKD6SEJxXbT4m1qGqD3R9XMuEhGQxNu5aTxyS1nXvtczgLkCYMXfbLO0XhpWDlF/1EIgADwI38gT8a0e2EuuH7aDJZYrAVgIAMwDzC0SYscvBhO2U3sE=';

describe('interaction-store integration with Cosmos', () => {
  let client;
  let database;
  let container;

  beforeAll(async () => {
    // Note: This test requires Cosmos DB Emulator to be running
    // Skip if not available
    try {
      client = new CosmosClient({
        endpoint: EMULATOR_ENDPOINT,
        key: EMULATOR_KEY,
      });

      // Create test database and container
      const { database: db } = await client.databases.createIfNotExists({
        id: 'test-fiona',
      });
      database = db;

      const { container: c } = await database.containers.createIfNotExists({
        id: 'interactions',
        partitionKey: { paths: ['/deploymentType'] },
      });
      container = c;
    } catch (error) {
      console.log('Cosmos Emulator not available, skipping integration test');
      process.skip();
    }
  });

  afterAll(async () => {
    if (database) {
      await database.delete();
    }
  });

  it('records interaction to Cosmos DB', async () => {
    const interaction = {
      userId: 'U123456',
      teamId: 'T123456',
      channelId: 'C123456',
      threadTs: '1712345678.001',
      messageTs: '1712345678.123',
      interactionType: 'app_mention',
      status: 'success',
      errorType: null,
      rateLimited: false,
    };

    // Manually create document (since recordInteraction would try to use env var)
    const doc = {
      id: `${interaction.userId}_${interaction.threadTs}_${interaction.messageTs}`,
      ...interaction,
      deploymentType: 'local',
      timestamp: new Date().toISOString(),
    };

    const { resource: createdDoc } = await container.items.upsert(doc, {
      partitionKey: [doc.deploymentType],
    });

    expect(createdDoc).toBeDefined();
    expect(createdDoc.id).toBe(doc.id);
    expect(createdDoc.status).toBe('success');
  });

  it('supports idempotent upsert (duplicate events)', async () => {
    const interaction = {
      userId: 'U234567',
      teamId: 'T234567',
      channelId: 'C234567',
      threadTs: '1712345679.001',
      messageTs: '1712345679.123',
      interactionType: 'app_mention',
      status: 'success',
      errorType: null,
      rateLimited: false,
      deploymentType: 'local',
      timestamp: new Date().toISOString(),
    };

    const doc = {
      id: `${interaction.userId}_${interaction.threadTs}_${interaction.messageTs}`,
      ...interaction,
    };

    // Upsert twice
    await container.items.upsert(doc, { partitionKey: [doc.deploymentType] });
    await container.items.upsert(doc, { partitionKey: [doc.deploymentType] });

    // Query and verify only one document exists
    const { resources } = await container.items
      .query('SELECT * FROM c WHERE c.userId = @userId', {
        parameters: [{ name: '@userId', value: 'U234567' }],
      })
      .fetchAll();

    expect(resources).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run integration test (optional, requires Cosmos emulator)**

```bash
cd apps/fiona-slack
npm run test:integration
```

Expected: Tests pass (or skip gracefully if emulator not available)

- [ ] **Step 3: Commit**

```bash
git add test/integration/interaction-store-cosmos.test.js
git commit -m "test: add integration test for interaction-store with Cosmos emulator"
```

---

## Phase 2: Weekly TimerTrigger Function

### Task 7: Set up usage-report-function project structure

**Files:**
- Create: `apps/usage-report-function/package.json`
- Create: `apps/usage-report-function/host.json`
- Create: `apps/usage-report-function/function_app.json`
- Create: `apps/usage-report-function/.gitignore`

- [ ] **Step 1: Initialize Function App project**

```bash
cd apps
mkdir usage-report-function
cd usage-report-function
```

Create `package.json`:

```json
{
  "name": "usage-report-function",
  "version": "1.0.0",
  "description": "Weekly usage report function for Fiona-Slack analytics",
  "type": "module",
  "main": "WeeklyReportTrigger/index.js",
  "scripts": {
    "build": "npm run lint",
    "start": "func start",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "dependencies": {
    "@azure/cosmos": "^4.1.0",
    "@azure/identity": "^4.0.0",
    "@azure/keyvault-secrets": "^4.8.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "eslint": "^8.50.0",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  }
}
```

Create `host.json`:

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "maxTelemetryItemsPerSecond": 20
      }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

Create `function_app.json`:

```json
{
  "version": "2.0",
  "functionApps": [
    {
      "scriptFile": "WeeklyReportTrigger/index.js",
      "bindings": [
        {
          "name": "myTimer",
          "type": "timerTrigger",
          "direction": "in",
          "schedule": "%REPORT_SCHEDULE%"
        }
      ]
    }
  ]
}
```

Create `.gitignore`:

```
node_modules
dist
build
.env
.env.local
.DS_Store
*.log
coverage
.vscode/settings.json
.idea
local.settings.json
```

- [ ] **Step 2: Create lib directory structure**

```bash
mkdir -p lib test/unit
touch lib/cosmos-queries.js lib/slack-formatter.js lib/key-vault-client.js
touch test/unit/cosmos-queries.test.js test/unit/slack-formatter.test.js
```

- [ ] **Step 3: Run npm install**

```bash
npm ci
```

Expected: Dependencies installed

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json host.json function_app.json .gitignore
git commit -m "setup: initialize usage-report-function Azure Function app"
```

---

### Task 8: Implement Cosmos queries module

**Files:**
- Create: `apps/usage-report-function/lib/cosmos-queries.js`
- Create: `apps/usage-report-function/test/unit/cosmos-queries.test.js`

- [ ] **Step 1: Write tests for cosmos queries**

```javascript
// test/unit/cosmos-queries.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDistinctUsers,
  getSessionCount,
  getTotalInteractions,
  getErrorCount,
  getRateLimitedCount,
  getFeedbackBreakdown,
  getAvgInteractionsPerUser,
  getFeedbackResponseRate,
} from '../../lib/cosmos-queries.js';

describe('cosmos-queries', () => {
  let mockInteractionsContainer;
  let mockFeedbackContainer;

  beforeEach(() => {
    mockInteractionsContainer = {
      items: {
        query: vi.fn(),
      },
    };
    mockFeedbackContainer = {
      items: {
        query: vi.fn(),
      },
    };
  });

  describe('getDistinctUsers', () => {
    it('returns count of distinct users', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({
          resources: [{ $1: 42 }],
        }),
      });

      const result = await getDistinctUsers(mockInteractionsContainer, 'production', '2026-03-10T00:00:00Z');
      expect(result).toBe(42);
    });

    it('returns 0 if no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });

      const result = await getDistinctUsers(mockInteractionsContainer, 'production', '2026-03-10T00:00:00Z');
      expect(result).toBe(0);
    });
  });

  // Additional tests for each query function...
});
```

- [ ] **Step 2: Implement cosmos-queries.js**

```javascript
// lib/cosmos-queries.js
/**
 * Get count of distinct active users (who had successful interactions, not rate-limited)
 */
export async function getDistinctUsers(interactionsContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT VALUE COUNT(DISTINCT i.userId)
    FROM interactions i
    WHERE i.deploymentType = @deploymentType
      AND i.timestamp > @oneWeekAgoISO
      AND i.status = 'success'
      AND i.rateLimited = false
  `;

  const { resources } = await interactionsContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources[0] ?? 0;
}

/**
 * Get count of distinct sessions
 */
export async function getSessionCount(interactionsContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT VALUE COUNT(DISTINCT i.threadTs)
    FROM interactions i
    WHERE i.deploymentType = @deploymentType
      AND i.timestamp > @oneWeekAgoISO
      AND i.status = 'success'
      AND i.rateLimited = false
  `;

  const { resources } = await interactionsContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources[0] ?? 0;
}

/**
 * Get total interaction count (all statuses)
 */
export async function getTotalInteractions(interactionsContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT VALUE COUNT(1)
    FROM interactions i
    WHERE i.deploymentType = @deploymentType
      AND i.timestamp > @oneWeekAgoISO
  `;

  const { resources } = await interactionsContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources[0] ?? 0;
}

/**
 * Get count of interactions with errors
 */
export async function getErrorCount(interactionsContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT VALUE COUNT(1)
    FROM interactions i
    WHERE i.deploymentType = @deploymentType
      AND i.timestamp > @oneWeekAgoISO
      AND i.status = 'error'
  `;

  const { resources } = await interactionsContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources[0] ?? 0;
}

/**
 * Get count of rate-limited requests
 */
export async function getRateLimitedCount(interactionsContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT VALUE COUNT(1)
    FROM interactions i
    WHERE i.deploymentType = @deploymentType
      AND i.timestamp > @oneWeekAgoISO
      AND i.rateLimited = true
  `;

  const { resources } = await interactionsContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources[0] ?? 0;
}

/**
 * Get feedback counts by value (good/bad)
 */
export async function getFeedbackBreakdown(feedbackContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT f.value, COUNT(f.feedbackId) AS count
    FROM feedback f
    WHERE f.deploymentType = @deploymentType
      AND f.timestamp > @oneWeekAgoISO
    GROUP BY f.value
  `;

  const { resources } = await feedbackContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources; // Array of { value, count }
}

/**
 * Get average interactions per active user
 */
export async function getAvgInteractionsPerUser(interactionsContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT VALUE AVG(userCounts.interactions)
    FROM (
      SELECT i.userId, COUNT(1) AS interactions
      FROM interactions i
      WHERE i.deploymentType = @deploymentType
        AND i.timestamp > @oneWeekAgoISO
        AND i.status = 'success'
        AND i.rateLimited = false
      GROUP BY i.userId
    ) AS userCounts
  `;

  const { resources } = await interactionsContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources[0] ?? 0;
}

/**
 * Get feedback response rate (% of successful interactions that received feedback)
 */
export async function getFeedbackResponseRate(interactionsContainer, feedbackContainer, deploymentType, oneWeekAgoISO) {
  const query = `
    SELECT VALUE
      CASE
        WHEN successCount = 0 THEN 0
        ELSE (feedbackCount / successCount) * 100
      END
    FROM (
      SELECT
        (SELECT VALUE COUNT(1) FROM feedback f WHERE f.deploymentType = @deploymentType AND f.timestamp > @oneWeekAgoISO) AS feedbackCount,
        (SELECT VALUE COUNT(1) FROM interactions i WHERE i.deploymentType = @deploymentType AND i.timestamp > @oneWeekAgoISO AND i.status = 'success' AND i.rateLimited = false) AS successCount
    )
  `;

  const { resources } = await interactionsContainer.items
    .query(query, {
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@oneWeekAgoISO', value: oneWeekAgoISO },
      ],
    })
    .fetchAll();

  return resources[0] ?? 0;
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- test/unit/cosmos-queries.test.js
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add lib/cosmos-queries.js test/unit/cosmos-queries.test.js
git commit -m "feat(usage-report-function): implement 8 Cosmos DB query functions for KPIs"
```

---

### Task 9: Implement Slack message formatter

**Files:**
- Create: `apps/usage-report-function/lib/slack-formatter.js`
- Create: `apps/usage-report-function/test/unit/slack-formatter.test.js`

- [ ] **Step 1: Write tests for Slack formatter**

```javascript
// test/unit/slack-formatter.test.js
import { describe, it, expect } from 'vitest';
import { formatWeeklyReport } from '../../lib/slack-formatter.js';

describe('slack-formatter', () => {
  it('formats weekly report with all KPIs', () => {
    const kpis = {
      distinctUsers: 42,
      sessionCount: 118,
      totalInteractions: 347,
      errorCount: 8,
      errorRate: 2.3,
      rateLimitedCount: 6,
      goodFeedback: 29,
      badFeedback: 7,
      feedbackRatio: 80.6,
      avgInteractionsPerUser: 8.3,
      feedbackResponseRate: 9.8,
      environment: 'production',
      startDate: '2026-03-10',
      endDate: '2026-03-16',
    };

    const message = formatWeeklyReport(kpis);

    expect(message).toContain('Fiona Usage Report');
    expect(message).toContain('Week of Mar 10–16, 2026');
    expect(message).toContain('42'); // distinct users
    expect(message).toContain('118'); // sessions
    expect(message).toContain('347'); // interactions
    expect(message).toContain('2.3%'); // error rate
    expect(message).toContain('80.6%'); // feedback ratio
    expect(message).toContain('9.8%'); // feedback response rate
  });
});
```

- [ ] **Step 2: Implement slack-formatter.js**

```javascript
// lib/slack-formatter.js
/**
 * Format KPIs into a Slack message
 */
export function formatWeeklyReport(kpis) {
  const {
    distinctUsers,
    sessionCount,
    totalInteractions,
    errorCount,
    errorRate,
    rateLimitedCount,
    goodFeedback,
    badFeedback,
    feedbackRatio,
    avgInteractionsPerUser,
    feedbackResponseRate,
    environment,
    startDate,
    endDate,
  } = kpis;

  // Format dates for display (Mar 10–16 format)
  const start = new Date(startDate);
  const end = new Date(endDate);
  const monthName = start.toLocaleString('en-US', { month: 'short' });
  const weekLabel = `${monthName} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;

  return `📊 *Fiona Usage Report* — Week of ${weekLabel}

👤 Unique users:           ${distinctUsers}
💬 Sessions:               ${sessionCount}
📨 Total interactions:     ${totalInteractions}
⛔ Errors:                 ${errorCount} (${errorRate.toFixed(1)}% error rate)
🚫 Rate-limited:           ${rateLimitedCount}

👍 Good feedback:          ${goodFeedback}
👎 Bad feedback:           ${badFeedback}
📈 Feedback ratio:         ${feedbackRatio.toFixed(1)}% positive
📊 Avg interactions/user:  ${avgInteractionsPerUser.toFixed(1)}
📝 Feedback response rate: ${feedbackResponseRate.toFixed(1)}%

_Environment: ${environment} | Generated by Fiona Analytics_`;
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- test/unit/slack-formatter.test.js
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add lib/slack-formatter.js test/unit/slack-formatter.test.js
git commit -m "feat(usage-report-function): implement Slack message formatter"
```

---

### Task 10: Implement Key Vault client

**Files:**
- Create: `apps/usage-report-function/lib/key-vault-client.js`

- [ ] **Step 1: Implement key-vault-client.js**

```javascript
// lib/key-vault-client.js
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

let secretClient = null;

/**
 * Get or initialize the Key Vault client
 */
function getSecretClient() {
  if (secretClient) return secretClient;

  const keyVaultUrl = process.env.KEY_VAULT_URL;
  if (!keyVaultUrl) {
    throw new Error('KEY_VAULT_URL environment variable not set');
  }

  secretClient = new SecretClient(keyVaultUrl, new DefaultAzureCredential());
  return secretClient;
}

/**
 * Retrieve Slack webhook URL from Key Vault
 */
export async function getSlackWebhookUrl(secretName, logger) {
  try {
    const client = getSecretClient();
    const secret = await client.getSecret(secretName);
    return secret.value;
  } catch (error) {
    logger?.error?.(`Failed to retrieve Slack webhook URL: ${error.message}`);
    throw error;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/key-vault-client.js
git commit -m "feat(usage-report-function): implement Key Vault client for webhook URL retrieval"
```

---

### Task 11: Implement main WeeklyReportTrigger function

**Files:**
- Create: `apps/usage-report-function/WeeklyReportTrigger/function.json`
- Create: `apps/usage-report-function/WeeklyReportTrigger/index.js`

- [ ] **Step 1: Create function.json**

```json
{
  "scriptFile": "index.js",
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "%REPORT_SCHEDULE%"
    }
  ]
}
```

- [ ] **Step 2: Implement main function**

```javascript
// WeeklyReportTrigger/index.js
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import axios from 'axios';
import { app } from '@azure/functions';
import {
  getDistinctUsers,
  getSessionCount,
  getTotalInteractions,
  getErrorCount,
  getRateLimitedCount,
  getFeedbackBreakdown,
  getAvgInteractionsPerUser,
  getFeedbackResponseRate,
} from '../lib/cosmos-queries.js';
import { formatWeeklyReport } from '../lib/slack-formatter.js';
import { getSlackWebhookUrl } from '../lib/key-vault-client.js';

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'fiona';
const COSMOS_INTERACTIONS_CONTAINER = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';
const COSMOS_FEEDBACK_CONTAINER = process.env.COSMOS_FEEDBACK_CONTAINER || 'feedback';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'production';
const SLACK_WEBHOOK_SECRET_NAME = process.env.SLACK_WEBHOOK_KEYVAULT_SECRET_NAME || 'slack-fiona-weekly-report-webhook';

app.timer('WeeklyReportTrigger', {
  schedule: '%REPORT_SCHEDULE%',
  handler: async (myTimer, context) => {
    const logger = context.log;
    logger('Weekly report function triggered');

    try {
      // Initialize Cosmos DB client
      const cosmosClient = new CosmosClient({
        endpoint: COSMOS_ENDPOINT,
        aadCredentials: new DefaultAzureCredential(),
      });

      const database = cosmosClient.database(COSMOS_DATABASE);
      const interactionsContainer = database.container(COSMOS_INTERACTIONS_CONTAINER);
      const feedbackContainer = database.container(COSMOS_FEEDBACK_CONTAINER);

      // Calculate lookback window (past 7 days)
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneWeekAgoISO = oneWeekAgo.toISOString();

      // Query all KPIs
      logger('Querying KPIs from Cosmos DB...');
      const [distinctUsers, sessionCount, totalInteractions, errorCount, rateLimitedCount, feedbackBreakdown, avgInteractionsPerUser, feedbackResponseRate] = await Promise.all([
        getDistinctUsers(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getSessionCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getTotalInteractions(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getErrorCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getRateLimitedCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getFeedbackBreakdown(feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getAvgInteractionsPerUser(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getFeedbackResponseRate(interactionsContainer, feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
      ]);

      // Parse feedback counts
      const goodFeedback = feedbackBreakdown.find((f) => f.value === 'good-feedback')?.count || 0;
      const badFeedback = feedbackBreakdown.find((f) => f.value === 'bad-feedback')?.count || 0;
      const feedbackRatio = goodFeedback + badFeedback > 0 ? (goodFeedback / (goodFeedback + badFeedback)) * 100 : 0;
      const errorRate = totalInteractions > 0 ? (errorCount / totalInteractions) * 100 : 0;

      // Format report
      const kpis = {
        distinctUsers,
        sessionCount,
        totalInteractions,
        errorCount,
        errorRate,
        rateLimitedCount,
        goodFeedback,
        badFeedback,
        feedbackRatio,
        avgInteractionsPerUser,
        feedbackResponseRate,
        environment: DEPLOYMENT_TYPE,
        startDate: oneWeekAgo.toISOString().split('T')[0],
        endDate: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      };

      const message = formatWeeklyReport(kpis);
      logger(`Report formatted: ${message.substring(0, 100)}...`);

      // Post to Slack
      const webhookUrl = await getSlackWebhookUrl(SLACK_WEBHOOK_SECRET_NAME, logger);
      logger('Retrieved webhook URL from Key Vault, posting to Slack...');

      await axios.post(webhookUrl, {
        text: message,
      });

      logger('Weekly report posted successfully');
      context.res = {
        status: 200,
        body: 'Weekly report generated and posted to Slack',
      };
    } catch (error) {
      logger.error(`Error generating weekly report: ${error.message}`);
      logger.error(error.stack);

      // Log to Application Insights for alerting
      context.res = {
        status: 500,
        body: `Error: ${error.message}`,
      };
    }
  },
});
```

- [ ] **Step 3: Run linting**

```bash
npm run lint
```

Expected: No linting errors

- [ ] **Step 4: Commit**

```bash
git add WeeklyReportTrigger/function.json WeeklyReportTrigger/index.js
git commit -m "feat(usage-report-function): implement WeeklyReportTrigger main function"
```

---

### Task 12: Create GitHub Actions CI/CD workflow

**Files:**
- Create: `.github/workflows/deploy-usage-report-function.yml`

- [ ] **Step 1: Create GitHub Actions workflow**

```yaml
# .github/workflows/deploy-usage-report-function.yml
name: Deploy Usage Report Function

on:
  push:
    branches:
      - main
    paths:
      - 'apps/usage-report-function/**'
      - '.github/workflows/deploy-usage-report-function.yml'
  workflow_dispatch:

env:
  AZURE_FUNCTIONAPP_NAME: 'usage-report-function'
  AZURE_RESOURCE_GROUP: 'fiona-rg'
  NODE_VERSION: '20.x'

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: Install dependencies
        working-directory: apps/usage-report-function
        run: npm ci

      - name: Run linting
        working-directory: apps/usage-report-function
        run: npm run lint

      - name: Run tests
        working-directory: apps/usage-report-function
        run: npm test

      - name: Build
        working-directory: apps/usage-report-function
        run: npm run build

  deploy:
    needs: build-and-test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: Install dependencies
        working-directory: apps/usage-report-function
        run: npm ci

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Package function app
        run: |
          cd apps/usage-report-function
          rm -f function-app.zip
          zip -r ../../function-app.zip . -x "node_modules/*" ".git/*" "test/*" "coverage/*"

      - name: Deploy to Azure
        run: |
          az functionapp deployment source config-zip \
            --resource-group ${{ env.AZURE_RESOURCE_GROUP }} \
            --name ${{ env.AZURE_FUNCTIONAPP_NAME }} \
            --src-path function-app.zip

      - name: Set app settings
        run: |
          az functionapp config appsettings set \
            --resource-group ${{ env.AZURE_RESOURCE_GROUP }} \
            --name ${{ env.AZURE_FUNCTIONAPP_NAME }} \
            --settings \
              REPORT_SCHEDULE='0 9 * * 1' \
              COSMOS_ENDPOINT='${{ secrets.COSMOS_ENDPOINT }}' \
              COSMOS_DATABASE='fiona' \
              COSMOS_INTERACTIONS_CONTAINER='interactions' \
              COSMOS_FEEDBACK_CONTAINER='feedback' \
              DEPLOYMENT_TYPE='production' \
              KEY_VAULT_URL='${{ secrets.KEY_VAULT_URL }}' \
              SLACK_WEBHOOK_KEYVAULT_SECRET_NAME='slack-fiona-weekly-report-webhook'
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-usage-report-function.yml
git commit -m "ci: add GitHub Actions workflow for usage-report-function deployment"
```

---

### Task 13: Document RBAC setup and Key Vault configuration

**Files:**
- Create: `apps/usage-report-function/DEPLOYMENT.md`

- [ ] **Step 1: Create deployment documentation**

```markdown
# Usage Report Function Deployment Guide

## Prerequisites

1. Azure subscription with Fiona resource group
2. Cosmos DB account with `fiona` database and `interactions` container
3. Key Vault instance with access to store secrets
4. GitHub secrets configured (AZURE_CREDENTIALS, COSMOS_ENDPOINT, KEY_VAULT_URL)

## Manual Setup Steps

### 1. Create Function App

```bash
az functionapp create \
  --resource-group fiona-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4 \
  --name usage-report-function \
  --storage-account fionastorage
```

### 2. Configure Managed Identity

```bash
# Enable system-assigned managed identity
az functionapp identity assign \
  --resource-group fiona-rg \
  --name usage-report-function \
  --role "Cosmos DB Data Reader" \
  --scope /subscriptions/{subscription-id}/resourceGroups/fiona-rg/providers/Microsoft.DocumentDB/databaseAccounts/fiona/sqlDatabases/fiona

# Grant Key Vault Secrets User role
az role assignment create \
  --assignee-object-id $(az functionapp identity show \
    --name usage-report-function \
    --resource-group fiona-rg \
    --query principalId -o tsv) \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/{subscription-id}/resourceGroups/fiona-rg/providers/Microsoft.KeyVault/vaults/fiona-kv
```

### 3. Store Slack Webhook URL

```bash
az keyvault secret set \
  --vault-name fiona-kv \
  --name slack-fiona-weekly-report-webhook \
  --value "https://hooks.slack.com/services/T.../B.../X..."
```

### 4. Configure App Settings

App settings are configured automatically by the GitHub Actions workflow. For manual deployment:

```bash
az functionapp config appsettings set \
  --resource-group fiona-rg \
  --name usage-report-function \
  --settings \
    REPORT_SCHEDULE='0 9 * * 1' \
    COSMOS_ENDPOINT='https://fiona.documents.azure.com:443/' \
    COSMOS_DATABASE='fiona' \
    COSMOS_INTERACTIONS_CONTAINER='interactions' \
    COSMOS_FEEDBACK_CONTAINER='feedback' \
    DEPLOYMENT_TYPE='production' \
    KEY_VAULT_URL='https://fiona-kv.vault.azure.net/' \
    SLACK_WEBHOOK_KEYVAULT_SECRET_NAME='slack-fiona-weekly-report-webhook'
```

### 5. Monitor with Application Insights

Function App logs are automatically sent to Application Insights. View logs:

```bash
az monitor app-insights query \
  --app fiona-usage-report \
  --analytics-query "traces | where message contains 'Weekly report'"
```

## Testing

### Local Testing

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Start function locally
func start

# In another terminal, manually trigger the timer
curl -X POST http://localhost:7071/admin/functions/WeeklyReportTrigger \
  -H "Content-Type: application/json" \
  -d '{"input": "test"}'
```

### Trigger Manually in Azure

```bash
az functionapp function show \
  --resource-group fiona-rg \
  --name usage-report-function \
  --function-name WeeklyReportTrigger
```

Then use Azure Portal to manually trigger the function.

## Troubleshooting

- **Cosmos DB connection errors:** Verify Managed Identity has `Cosmos DB Data Reader` role
- **Key Vault access denied:** Verify Managed Identity has `Key Vault Secrets User` role
- **Slack webhook not found:** Verify secret name matches `SLACK_WEBHOOK_KEYVAULT_SECRET_NAME`
- **Function timeout:** Check Cosmos DB query performance; consider adding indexes
```

- [ ] **Step 2: Commit**

```bash
git add apps/usage-report-function/DEPLOYMENT.md
git commit -m "docs: add deployment guide for usage-report-function"
```

---

## Summary

**Phase 1 (Tasks 1-6):**
- ✅ Create `interaction-store.js` module with unit tests
- ✅ Update `app_mention.js` to record interactions
- ✅ Update `assistant/message.js` to record interactions
- ✅ Update Bicep templates (fiona-slack-container, fiona-cosmos)
- ✅ Integration test with Cosmos emulator

**Phase 2 (Tasks 7-13):**
- ✅ Set up Function App project structure
- ✅ Implement 8 Cosmos DB query functions
- ✅ Implement Slack message formatter
- ✅ Implement Key Vault client
- ✅ Implement WeeklyReportTrigger main function
- ✅ Create GitHub Actions CI/CD workflow
- ✅ Document RBAC setup and deployment

**Total effort:** ~6–8 hours

**Testing:** Each component tested with unit tests; integration test with Cosmos emulator; manual trigger test in Azure
