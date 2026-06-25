# AI-129 Conversation Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture all Fiona conversations (user message + bot response + thread history + metadata) to a new Cosmos DB `conversations` container for human evaluation, gated by a `CAPTURE_ALL_CONVERSATIONS` env var.

> **Implementation update (2026-06-08):** The merged implementation uses a **180-day TTL** (not 360) and includes `systemPromptVersion` in captured conversation records. Follow-up hardening/refactor work is tracked separately in issue #57.

**Architecture:** A new `conversation-capture-store.js` module (following the existing `interaction-store.js` / `feedback-store.js` pattern) writes to a dedicated Cosmos container. `callLLM` is modified to return the accumulated bot response text alongside the metadata envelope, so listeners can pass both to the store after a successful LLM call. Infrastructure provisioning adds the container via Bicep. All changes are independent of the slash command work (AI-119) and will compose cleanly after that PR merges.

**Tech Stack:** Node.js (ESM), `@azure/cosmos`, `@azure/identity`, Jest (`jest.unstable_mockModule`), Azure Bicep

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/fiona-slack/src/agent/llm-caller.js` | Return `{ metadata, botText }` from `callLLM`; return `{ botText, citations }` from `callPerplexityChat`; export `LLM_MODEL` |
| Modify | `apps/fiona-slack/tests/agent/llm-caller.aggregate-perplexity.test.js` | Update destructure for new `callPerplexityChat` return shape |
| Create | `apps/fiona-slack/src/agent/conversation-capture-store.js` | Cosmos writer for full conversation records; no-ops when flag is off or Cosmos unconfigured |
| Create | `apps/fiona-slack/tests/agent/conversation-capture-store.test.js` | Unit tests for the store module |
| Modify | `apps/fiona-slack/src/listeners/events/app_mention.js` | Destructure `{ metadata, botText }` from `callLLM`; call `captureConversation` after success |
| Modify | `apps/fiona-slack/src/listeners/assistant/message.js` | Same as above for the assistant message path |
| Modify | `apps/fiona-slack/tests/listeners/events/app-mention.test.js` | Update mocks for new `callLLM` shape; assert capture is called |
| Modify | `apps/fiona-slack/tests/listeners/assistant/message.test.js` | Same |
| Modify | `infra/fiona-slack-container/main.bicep` | Add `conversations` container (360-day TTL); add `COSMOS_CONVERSATIONS_CONTAINER` and `CAPTURE_ALL_CONVERSATIONS` env vars |

---

## Task 1: Expose bot text from `callLLM` and export `LLM_MODEL`

`callPerplexityChat` already accumulates the full LLM response in `linkifiedText` but currently discards it (returning only `citations`). This task surfaces that text through `callLLM` so listeners can capture it.

**Files:**
- Modify: `apps/fiona-slack/src/agent/llm-caller.js`
- Modify: `apps/fiona-slack/tests/agent/llm-caller.aggregate-perplexity.test.js`

- [ ] **Step 1: Write the failing test for `callLLM` returning `botText`**

Add this test inside the existing `describe` block in `apps/fiona-slack/tests/agent/llm-caller.metadata.test.js` (append before the final closing `}`):

```javascript
it('returns botText alongside the metadata envelope', async () => {
  process.env.PERPLEXITY_API_KEY = 'test-key';
  const { callLLM } = await import('../../src/agent/llm-caller.js');

  const fakeStreamer = { append: jest.fn().mockResolvedValue(undefined), stop: jest.fn() };
  // mockCreate is already set up in this test file's beforeAll; provide a minimal stream
  mockCreate.mockResolvedValueOnce(
    (async function* () {
      yield { choices: [{ delta: { content: 'Hello world' } }] };
    })(),
  );

  const result = await callLLM(fakeStreamer, [{ role: 'user', content: 'hi' }], { error: jest.fn(), warn: jest.fn(), info: jest.fn() });

  expect(result).toHaveProperty('metadata');
  expect(result).toHaveProperty('botText', 'Hello world');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/agent/llm-caller.metadata.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `result.botText` is undefined (current `callLLM` returns the metadata envelope directly, not `{ metadata, botText }`).

- [ ] **Step 3: Modify `callPerplexityChat` to return `{ botText, citations }`**

In `apps/fiona-slack/src/agent/llm-caller.js`, find the end of `callPerplexityChat` (around line 415):

```javascript
  if (textBuffer) {
    const sourceIndexMap = streamer?.__citation_metadata?.source_index_map || {};
    const linkifiedText = linkifyCitationMarkers(textBuffer, sourceIndexMap);
    await streamer.append({ markdown_text: linkifiedText });
  }

  return citations;
}
```

Replace with:

```javascript
  let botText = '';
  if (textBuffer) {
    const sourceIndexMap = streamer?.__citation_metadata?.source_index_map || {};
    botText = linkifyCitationMarkers(textBuffer, sourceIndexMap);
    await streamer.append({ markdown_text: botText });
  }

  return { botText, citations };
}
```

- [ ] **Step 4: Modify `callLLM` to capture `botText` and return `{ metadata, botText }`**

In `apps/fiona-slack/src/agent/llm-caller.js`, find inside `callLLM` (around line 450):

```javascript
  try {
    await callPerplexityChat(streamer, [{ role: 'system', content: SYSTEM_PROMPT }, ...prompts]);
```

Replace with:

```javascript
  let botText = '';
  try {
    ({ botText } = await callPerplexityChat(streamer, [{ role: 'system', content: SYSTEM_PROMPT }, ...prompts]));
```

Then find the `return metadata;` line at the end of `callLLM` and replace it:

```javascript
  return { metadata, botText };
```

- [ ] **Step 5: Export `LLM_MODEL` from `llm-caller.js`**

Find the line (near the top of the file):

```javascript
const PERPLEXITY_API_MODEL = process.env.PERPLEXITY_API_MODEL || 'sonar';
```

Add after it:

```javascript
export const LLM_MODEL = PERPLEXITY_API_MODEL;
```

- [ ] **Step 6: Fix the `callPerplexityChat` test that checks the `citations` return**

In `apps/fiona-slack/tests/agent/llm-caller.aggregate-perplexity.test.js`, find (around line 152):

```javascript
    const citations = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(citations).toEqual(['https://result.example.com']);
```

Replace with:

```javascript
    const { citations } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(citations).toEqual(['https://result.example.com']);
```

- [ ] **Step 7: Run all llm-caller tests to verify they pass**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/agent/llm-caller --no-coverage 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 8: Update listener callers to destructure the new return shape**

In `apps/fiona-slack/src/listeners/events/app_mention.js`, find:

```javascript
      const metadata = await callLLM(streamer, prompts, logger);
```

Replace with:

```javascript
      const { metadata, botText } = await callLLM(streamer, prompts, logger);
```

In `apps/fiona-slack/src/listeners/assistant/message.js`, find (inside the `else` block):

```javascript
        const metadata = await callLLM(streamer, prompts, logger);
```

Replace with:

```javascript
        const { metadata, botText } = await callLLM(streamer, prompts, logger);
```

> `botText` is now declared in scope for use in Task 3 (capture wiring). The `metadata` variable is otherwise used identically.

- [ ] **Step 9: Update the `callLLM` mock default in listener tests**

In `apps/fiona-slack/tests/listeners/events/app-mention.test.js`, find the mock module factory:

```javascript
  callLLM: jest.fn().mockResolvedValue(undefined),
```

Replace with:

```javascript
  callLLM: jest.fn().mockResolvedValue({ metadata: null, botText: '' }),
```

In `apps/fiona-slack/tests/listeners/assistant/message.test.js`, make the same change:

```javascript
  callLLM: jest.fn().mockResolvedValue({ metadata: null, botText: '' }),
```

- [ ] **Step 10: Update `mockResolvedValueOnce` calls in listener tests to wrap metadata in new shape**

In `apps/fiona-slack/tests/listeners/events/app-mention.test.js`:

Find the citation-logging test:
```javascript
    callLLM.mockResolvedValueOnce({
      finalize_state: 'ready_to_finalize',
      sources: [{ url: 'https://a.com' }],
      source_index_map: { 'https://a.com': 1 },
    });
```
Replace with:
```javascript
    callLLM.mockResolvedValueOnce({
      metadata: {
        finalize_state: 'ready_to_finalize',
        sources: [{ url: 'https://a.com' }],
        source_index_map: { 'https://a.com': 1 },
      },
      botText: 'test response',
    });
```

Find the `finalizeMetadataEnvelope` test:
```javascript
    const metadata = {
      finalize_state: 'ready_to_finalize',
      sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs' }],
      source_index_map: { 'https://docs.ed-fi.org': 1 },
    };
    callLLM.mockResolvedValueOnce(metadata);
```
Replace with:
```javascript
    const metadata = {
      finalize_state: 'ready_to_finalize',
      sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs' }],
      source_index_map: { 'https://docs.ed-fi.org': 1 },
    };
    callLLM.mockResolvedValueOnce({ metadata, botText: 'test response' });
```

Apply the same two changes in `apps/fiona-slack/tests/listeners/assistant/message.test.js`.

- [ ] **Step 11: Run all listener tests to verify they pass**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/listeners --no-coverage 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 12: Run the full test suite**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/fiona-slack/src/agent/llm-caller.js \
        apps/fiona-slack/tests/agent/llm-caller.metadata.test.js \
        apps/fiona-slack/tests/agent/llm-caller.aggregate-perplexity.test.js \
        apps/fiona-slack/src/listeners/events/app_mention.js \
        apps/fiona-slack/src/listeners/assistant/message.js \
        apps/fiona-slack/tests/listeners/events/app-mention.test.js \
        apps/fiona-slack/tests/listeners/assistant/message.test.js
git commit -m "refactor(ai-129): expose botText from callLLM for conversation capture"
```

---

## Task 2: Implement `conversation-capture-store.js`

**Files:**
- Create: `apps/fiona-slack/src/agent/conversation-capture-store.js`
- Create: `apps/fiona-slack/tests/agent/conversation-capture-store.test.js`

- [ ] **Step 1: Write the failing test file**

Create `apps/fiona-slack/tests/agent/conversation-capture-store.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';

const mockUpsert = jest.fn().mockResolvedValue({});
const mockContainerObj = { items: { upsert: mockUpsert } };
const mockDatabase = { container: jest.fn().mockReturnValue(mockContainerObj) };
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
}));

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: MockCosmosClient,
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

const VALID_CAPTURE = {
  userId: 'U123',
  teamId: 'T456',
  channelId: 'C789',
  threadTs: '1000.0001',
  messageTs: '1000.0002',
  entryPoint: 'app_mention',
  userMessage: 'What is Ed-Fi?',
  botResponse: 'Ed-Fi is a data standard.',
  threadHistory: [{ role: 'user', content: 'What is Ed-Fi?' }],
  llmProvider: 'perplexity',
  llmModel: 'sonar',
  sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs', index: 1 }],
};

describe('conversation-capture-store - CAPTURE_ALL_CONVERSATIONS disabled', () => {
  let captureConversation;

  beforeAll(async () => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_CONVERSATIONS_CONTAINER;
    ({ captureConversation } = await import('../../src/agent/conversation-capture-store.js'));
  });

  it('is a no-op when CAPTURE_ALL_CONVERSATIONS is not set', async () => {
    await captureConversation(VALID_CAPTURE);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('conversation-capture-store - Cosmos not configured', () => {
  let captureConversation;

  beforeAll(async () => {
    process.env.CAPTURE_ALL_CONVERSATIONS = 'true';
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_CONVERSATIONS_CONTAINER;
    jest.resetModules();
    ({ captureConversation } = await import('../../src/agent/conversation-capture-store.js'));
  });

  afterAll(() => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
  });

  it('is a no-op and warns once when Cosmos is not configured', async () => {
    const logger = { warn: jest.fn() };
    await captureConversation({ ...VALID_CAPTURE, logger });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CosmosDB not configured'));
  });

  it('warns only once across multiple calls', async () => {
    const logger = { warn: jest.fn() };
    await captureConversation({ ...VALID_CAPTURE, logger });
    await captureConversation({ ...VALID_CAPTURE, logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('conversation-capture-store - Cosmos configured via connection string', () => {
  let captureConversation;

  beforeAll(async () => {
    process.env.CAPTURE_ALL_CONVERSATIONS = 'true';
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=dGVzdA==';
    process.env.COSMOS_CONVERSATIONS_CONTAINER = 'conversations';
    process.env.DEPLOYMENT_TYPE = 'local';
    jest.resetModules();
    MockCosmosClient.mockClear();
    mockUpsert.mockClear();
    ({ captureConversation } = await import('../../src/agent/conversation-capture-store.js'));
  });

  afterAll(() => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_CONVERSATIONS_CONTAINER;
  });

  beforeEach(() => {
    mockUpsert.mockClear();
  });

  it('upserts a document with all required fields', async () => {
    await captureConversation(VALID_CAPTURE);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.id).toBe('U123_1000.0001_1000.0002');
    expect(doc.userId).toBe('U123');
    expect(doc.teamId).toBe('T456');
    expect(doc.channelId).toBe('C789');
    expect(doc.threadTs).toBe('1000.0001');
    expect(doc.messageTs).toBe('1000.0002');
    expect(doc.entryPoint).toBe('app_mention');
    expect(doc.userMessage).toBe('What is Ed-Fi?');
    expect(doc.botResponse).toBe('Ed-Fi is a data standard.');
    expect(doc.threadHistory).toEqual([{ role: 'user', content: 'What is Ed-Fi?' }]);
    expect(doc.llmProvider).toBe('perplexity');
    expect(doc.llmModel).toBe('sonar');
    expect(doc.sources).toEqual([{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs', index: 1 }]);
    expect(doc.deploymentType).toBe('local');
    expect(doc.ttl).toBe(31_104_000);
    expect(doc.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('uses deploymentType and userId as the partition key', async () => {
    await captureConversation(VALID_CAPTURE);
    const [, options] = mockUpsert.mock.calls[0];
    expect(options.partitionKey).toEqual(['local', 'U123']);
  });

  it('defaults sources to empty array when not provided', async () => {
    await captureConversation({ ...VALID_CAPTURE, sources: undefined });
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.sources).toEqual([]);
  });

  it('silently swallows Cosmos write errors and warns', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('cosmos timeout'));
    const logger = { warn: jest.fn() };
    await expect(captureConversation({ ...VALID_CAPTURE, logger })).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to capture conversation'));
  });

  it('skips write and warns when required fields are missing', async () => {
    const logger = { warn: jest.fn() };
    await captureConversation({ ...VALID_CAPTURE, userId: undefined, logger });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing required fields'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/agent/conversation-capture-store --no-coverage 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `conversation-capture-store.js`**

Create `apps/fiona-slack/src/agent/conversation-capture-store.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const CAPTURE_ALL_CONVERSATIONS = process.env.CAPTURE_ALL_CONVERSATIONS === 'true';
const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'fiona';
const COSMOS_CONVERSATIONS_CONTAINER = process.env.COSMOS_CONVERSATIONS_CONTAINER || 'conversations';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'local';

// 360 days in seconds for per-document TTL
const CONVERSATION_TTL_SECONDS = 31_104_000;

let warnedMissingConfig = false;

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

/**
 * @param {{ warn?: (msg: string) => void } | null} [logger]
 * @returns {Promise<import('@azure/cosmos').Container | null>}
 */
async function getContainer(logger) {
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
        'CosmosDB not configured — conversations will not be captured. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  container = client.database(COSMOS_DATABASE).container(COSMOS_CONVERSATIONS_CONTAINER);
  return container;
}

/**
 * Capture a full conversation to Cosmos DB for human evaluation.
 * No-ops silently when CAPTURE_ALL_CONVERSATIONS is false or Cosmos is unconfigured.
 *
 * @param {Object} capture
 * @param {string} capture.userId - Slack user ID
 * @param {string} [capture.teamId] - Slack workspace ID
 * @param {string} capture.channelId - Slack channel ID
 * @param {string} capture.threadTs - Thread timestamp (session identifier)
 * @param {string} capture.messageTs - Message timestamp (event identifier)
 * @param {string} capture.entryPoint - 'app_mention' or 'assistant_message'
 * @param {string} capture.userMessage - The user's message text
 * @param {string} capture.botResponse - The full bot response text
 * @param {Array<{role: string, content: string}>} capture.threadHistory - Full thread context sent to LLM
 * @param {string} capture.llmProvider - LLM provider name (e.g. 'perplexity')
 * @param {string} capture.llmModel - LLM model name (e.g. 'sonar')
 * @param {Array} [capture.sources] - Citation sources from metadata
 * @param {{ warn?: (msg: string) => void }} [capture.logger] - Optional logger
 */
export async function captureConversation({
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  entryPoint,
  userMessage,
  botResponse,
  threadHistory,
  llmProvider,
  llmModel,
  sources,
  logger,
}) {
  if (!CAPTURE_ALL_CONVERSATIONS) return;

  const c = await getContainer(logger);
  if (!c) return;

  if (!userId || !channelId || !threadTs || !messageTs || !entryPoint) {
    logger?.warn?.(
      `Missing required fields for capturing conversation: ${JSON.stringify({ userId, channelId, threadTs, messageTs, entryPoint })}`,
    );
    return;
  }

  const doc = {
    id: `${userId}_${threadTs}_${messageTs}`,
    userId,
    teamId,
    channelId,
    threadTs,
    messageTs,
    entryPoint,
    userMessage,
    botResponse,
    threadHistory,
    llmProvider,
    llmModel,
    sources: sources ?? [],
    deploymentType: DEPLOYMENT_TYPE,
    timestamp: new Date().toISOString(),
    ttl: CONVERSATION_TTL_SECONDS,
  };

  try {
    await c.items.upsert(doc, {
      partitionKey: [doc.deploymentType, doc.userId],
    });
  } catch (error) {
    logger?.warn?.(`Failed to capture conversation to Cosmos DB: ${error.message}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/agent/conversation-capture-store --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/fiona-slack/src/agent/conversation-capture-store.js \
        apps/fiona-slack/tests/agent/conversation-capture-store.test.js
git commit -m "feat(ai-129): add conversation-capture-store for full conversation persistence"
```

---

## Task 3: Wire capture into `app_mention.js` and `message.js`

**Files:**
- Modify: `apps/fiona-slack/src/listeners/events/app_mention.js`
- Modify: `apps/fiona-slack/src/listeners/assistant/message.js`
- Modify: `apps/fiona-slack/tests/listeners/events/app-mention.test.js`
- Modify: `apps/fiona-slack/tests/listeners/assistant/message.test.js`

- [ ] **Step 1: Write the failing tests for `app_mention.js` capture**

In `apps/fiona-slack/tests/listeners/events/app-mention.test.js`, add `captureConversation` to the mock module factory. Find the existing mock factory block (the `jest.unstable_mockModule('../../src/agent/llm-caller.js', ...)` section) and locate any `jest.unstable_mockModule` near the top. Add a new mock **before** the module is imported:

After all existing `jest.unstable_mockModule` calls, add:

```javascript
jest.unstable_mockModule('../../src/agent/conversation-capture-store.js', () => ({
  captureConversation: jest.fn().mockResolvedValue(undefined),
}));
```

Then in the `beforeAll` import block (where `callLLM` and others are imported), add:

```javascript
const { captureConversation } = await import('../../../src/agent/conversation-capture-store.js');
```

Then add these tests to the test suite (before the final closing `}`):

```javascript
describe('conversation capture', () => {
  beforeEach(() => {
    captureConversation.mockClear();
    callLLM.mockResolvedValue({
      metadata: { finalize_state: 'ready_to_finalize', sources: [], source_index_map: {}, provider: 'perplexity' },
      botText: 'Bot answer here.',
    });
  });

  it('calls captureConversation with correct fields after a successful LLM response', async () => {
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(captureConversation).toHaveBeenCalledTimes(1);
    const call = captureConversation.mock.calls[0][0];
    expect(call.userId).toBe(mockEvent.user);
    expect(call.channelId).toBe(mockEvent.channel);
    expect(call.entryPoint).toBe('app_mention');
    expect(call.botResponse).toBe('Bot answer here.');
    expect(call.llmProvider).toBe('perplexity');
  });

  it('does not call captureConversation when callLLM throws', async () => {
    callLLM.mockRejectedValueOnce(new Error('LLM failure'));

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(captureConversation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new app_mention capture tests to verify they fail**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/listeners/events/app-mention --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `captureConversation` is never called.

- [ ] **Step 3: Wire capture into `app_mention.js`**

In `apps/fiona-slack/src/listeners/events/app_mention.js`, add the import after the existing imports:

```javascript
import { captureConversation } from '../../agent/conversation-capture-store.js';
import { LLM_MODEL } from '../../agent/llm-caller.js';
```

Then, after `finalizeMetadataEnvelope(metadata);`, add:

```javascript
      await captureConversation({
        userId: user,
        teamId: team,
        channelId: channel,
        threadTs: thread_ts,
        messageTs,
        entryPoint: 'app_mention',
        userMessage: text,
        botResponse: botText,
        threadHistory: prompts,
        llmProvider: metadata?.provider ?? 'perplexity',
        llmModel: LLM_MODEL,
        sources: metadata?.sources,
        logger,
      });
```

- [ ] **Step 4: Run the app_mention tests to verify they pass**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/listeners/events/app-mention --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Write the failing tests for `message.js` capture**

In `apps/fiona-slack/tests/listeners/assistant/message.test.js`, add the same `jest.unstable_mockModule` for `conversation-capture-store.js` and import `captureConversation` alongside the other imports. Then add these tests:

```javascript
describe('conversation capture', () => {
  beforeEach(() => {
    captureConversation.mockClear();
    callLLM.mockResolvedValue({
      metadata: { finalize_state: 'ready_to_finalize', sources: [], source_index_map: {}, provider: 'perplexity' },
      botText: 'Bot answer here.',
    });
  });

  it('calls captureConversation with correct fields after a successful LLM response', async () => {
    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(captureConversation).toHaveBeenCalledTimes(1);
    const call = captureConversation.mock.calls[0][0];
    expect(call.userId).toBe(mockContext.userId);
    expect(call.channelId).toBe(mockMessage.channel);
    expect(call.entryPoint).toBe('assistant_message');
    expect(call.botResponse).toBe('Bot answer here.');
    expect(call.llmProvider).toBe('perplexity');
  });

  it('does not call captureConversation when callLLM throws', async () => {
    callLLM.mockRejectedValueOnce(new Error('LLM failure'));

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(captureConversation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the message tests to verify they fail**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest tests/listeners/assistant/message --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `captureConversation` is never called.

- [ ] **Step 7: Wire capture into `message.js`**

In `apps/fiona-slack/src/listeners/assistant/message.js`, add the imports:

```javascript
import { captureConversation } from '../../agent/conversation-capture-store.js';
import { LLM_MODEL } from '../../agent/llm-caller.js';
```

Inside the `else` branch (normal LLM path), after `finalizeMetadataEnvelope(metadata);`, add:

```javascript
        await captureConversation({
          userId,
          teamId,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          entryPoint: 'assistant_message',
          userMessage: text,
          botResponse: botText,
          threadHistory: prompts,
          llmProvider: metadata?.provider ?? 'perplexity',
          llmModel: LLM_MODEL,
          sources: metadata?.sources,
          logger,
        });
```

- [ ] **Step 8: Run the full test suite**

```bash
cd apps/fiona-slack && node --experimental-vm-modules node_modules/.bin/jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/fiona-slack/src/listeners/events/app_mention.js \
        apps/fiona-slack/src/listeners/assistant/message.js \
        apps/fiona-slack/tests/listeners/events/app-mention.test.js \
        apps/fiona-slack/tests/listeners/assistant/message.test.js
git commit -m "feat(ai-129): wire conversation capture into app_mention and assistant_message handlers"
```

---

## Task 4: Bicep — provision `conversations` container and env vars

This task adds the Cosmos DB `conversations` container (with 360-day TTL) and the application configuration env vars to the container app.

**Files:**
- Modify: `infra/fiona-slack-container/main.bicep`

> Note: Bicep changes cannot be unit-tested locally in the same way as JS code. Verify by reviewing the diff for structural correctness and running a deploy to the insiders environment after merging.

- [ ] **Step 1: Add `conversationsContainerName` and `captureAllConversations` parameters**

In `infra/fiona-slack-container/main.bicep`, add after the `interactionsContainerName` parameter:

```bicep
@description('Cosmos DB container name for full conversation capture')
param conversationsContainerName string = 'conversations'

@description('Enable capturing all conversations for human evaluation (default: false)')
param captureAllConversations bool = false
```

- [ ] **Step 2: Add the `conversations` Cosmos container resource**

Add after the `feedbackContainer` resource block (before the `// --- Container App` comment):

```bicep
// Conversations Container for human evaluation of full conversation history
resource conversationsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: conversationsContainerName
  parent: sqlDatabase
  properties: {
    resource: {
      id: conversationsContainerName
      partitionKey: {
        paths: [ '/deploymentType', '/userId' ]
        kind: 'MultiHash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/*' }
        ]
        excludedPaths: [
          { path: '/"_etag"/?' }
          // threadHistory and botResponse are large text blobs — exclude from index
          { path: '/threadHistory/*' }
          { path: '/botResponse/?' }
          { path: '/userMessage/?' }
        ]
        compositeIndexes: [
          [
            { path: '/userId', order: 'ascending' }
            { path: '/timestamp', order: 'descending' }
          ]
          [
            { path: '/entryPoint', order: 'ascending' }
            { path: '/timestamp', order: 'descending' }
          ]
        ]
      }
      // 360-day TTL — documents expire automatically; per-document ttl field overrides if needed
      defaultTtl: 31104000
    }
    options: {}
  }
}
```

- [ ] **Step 3: Add env vars to the container app**

In the `env` array inside the container app `template.containers[0]`, add after the `DEPLOYMENT_TYPE` env var entry:

```bicep
            {
              name: 'COSMOS_CONVERSATIONS_CONTAINER'
              value: conversationsContainerName
            }
            {
              name: 'CAPTURE_ALL_CONVERSATIONS'
              value: captureAllConversations ? 'true' : 'false'
            }
            {
              name: 'COSMOS_INTERACTIONS_CONTAINER'
              value: interactionsContainerName
            }
```

> Note: `COSMOS_INTERACTIONS_CONTAINER` is referenced in `interaction-store.js` but was not previously wired via Bicep — add it here for consistency while you're touching this section.

- [ ] **Step 4: Add `conversationsContainer` to the container app `dependsOn`**

Find the existing `dependsOn` at the bottom of the `slackContainerApp` resource:

```bicep
  dependsOn: [
    acrPullRoleAssignment
  ]
```

Replace with:

```bicep
  dependsOn: [
    acrPullRoleAssignment
    conversationsContainer
  ]
```

- [ ] **Step 5: Review the Bicep diff**

```bash
git diff infra/fiona-slack-container/main.bicep
```

Verify:
- Two new parameters (`conversationsContainerName`, `captureAllConversations`)
- One new resource (`conversationsContainer`) with `defaultTtl: 31104000`
- Two new env vars in the container app (`COSMOS_CONVERSATIONS_CONTAINER`, `CAPTURE_ALL_CONVERSATIONS`)
- `COSMOS_INTERACTIONS_CONTAINER` env var added

- [ ] **Step 6: Commit**

```bash
git add infra/fiona-slack-container/main.bicep
git commit -m "feat(ai-129): provision conversations Cosmos container with 360-day TTL"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|-------------|-----------|
| All conversations captured when `CAPTURE_ALL_CONVERSATIONS=true` | Task 2 (store), Task 3 (wiring) |
| Zero overhead when flag is false | Task 2 (early return before any I/O) |
| Graceful degradation if Cosmos unconfigured | Task 2 (`getContainer` no-op + warn) |
| 360-day TTL | Task 2 (`CONVERSATION_TTL_SECONDS = 31_104_000`), Task 4 (`defaultTtl: 31104000`) |
| Independent from feedback/interaction containers | Task 2 (separate singleton, separate env var, separate container) |
| User message + bot response + full thread history | Task 2 (schema), Task 3 (passed from listeners) |
| User/channel/workspace IDs | Task 2 (schema), Task 3 |
| Entry point | Task 2 (schema), Task 3 (`entryPoint: 'app_mention'` / `'assistant_message'`) |
| LLM provider + model | Task 1 (`LLM_MODEL` export), Task 3 (passed from listeners) |
| Citations/sources | Task 3 (`sources: metadata?.sources`) |
| Deployment type | Task 2 (`DEPLOYMENT_TYPE`) |
| Infrastructure provisioning | Task 4 |
| Bot response text available | Task 1 (`callLLM` returns `{ metadata, botText }`) |

**Slash command path (AI-119):** Slash commands do not invoke the LLM and are intentionally excluded — there is no bot response to capture. When AI-119 merges, no capture wiring is needed for `/fiona help`.

**Open item:** The Bicep `COSMOS_INTERACTIONS_CONTAINER` env var (Step 4.3) adds something not previously in Bicep. Verify that `interaction-store.js` reads `process.env.COSMOS_INTERACTIONS_CONTAINER` (it does, line 13 of that file) and that the existing deployed container name matches the default `'interactions'` before deploying, to avoid an unintended container name change.
