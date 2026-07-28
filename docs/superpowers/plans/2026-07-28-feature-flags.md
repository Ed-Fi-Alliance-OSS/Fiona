# Feature Flags (Cosmos-backed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cosmos-backed feature-flag layer supporting per-user beta gating and global kill-switches, behind a single `isFeatureEnabled()` call, and retrofit the two existing informal toggles onto it.

**Architecture:** Two new modules under `apps/fiona-slack/src/agent/`. `feature-flags-store.js` does raw Cosmos reads (mirroring `slack-users-store.js`), scoping every document id by `DEPLOYMENT_TYPE`. `feature-flags.js` owns a flag registry, resolution precedence (per-user → global → registry default), and an in-memory TTL cache, exposing `isFeatureEnabled()`. Existing call sites (`conversation-capture-store.js`, `/fiona escalate`) are migrated to call it.

**Tech Stack:** Node.js 22 (ES modules), `@azure/cosmos`, `@azure/identity`, Jest 29 (ESM via `--experimental-vm-modules`, `jest.unstable_mockModule`).

## Global Constraints

- **License header:** Every new `.js` file MUST start with the Apache-2.0 header block used across the repo (see any existing file under `src/agent/`).
- **Node:** 22+, ES modules only (`import`/`export`, `.js` extensions in imports).
- **Test command (run from `apps/fiona-slack/`):** `npm test -- <path>` for one file; `npm test` for all.
- **Cosmos config env vars** are shared and already read elsewhere: `COSMOS_CONNECTION_STRING`, `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE` (default `chatbot`), `DEPLOYMENT_TYPE` (default `local`).
- **Soft-fail contract:** the flag system must never throw into a request path; on any Cosmos failure or missing config it degrades to registry defaults.
- **Commit style:** Conventional Commits; end message body with the repo's `Co-Authored-By` trailer if used by prior commits.

---

## File Structure

- **Create** `apps/fiona-slack/src/agent/feature-flags-store.js` — raw Cosmos reads: `getGlobalFlags`, `getUserFlags`. Owns client/container caching, retry, `DEPLOYMENT_TYPE` id-scoping, graceful no-op.
- **Create** `apps/fiona-slack/src/agent/feature-flags.js` — `isFeatureEnabled`, `FLAG_REGISTRY`, TTL cache, resolution precedence.
- **Create** `apps/fiona-slack/tests/agent/feature-flags-store.test.js` — store unit tests (Cosmos mocked).
- **Create** `apps/fiona-slack/tests/agent/feature-flags.test.js` — evaluation unit tests (store mocked).
- **Modify** `apps/fiona-slack/src/agent/conversation-capture-store.js` — replace the import-time `CAPTURE_ALL_CONVERSATIONS` guard with a runtime `isFeatureEnabled('conversationCapture')` call.
- **Modify** `apps/fiona-slack/src/listeners/commands/command-handler.js` — add `ESCALATE_UNAVAILABLE_TEXT`.
- **Modify** `apps/fiona-slack/src/listeners/commands/fiona.js` — gate the slash `escalate` sub-command.
- **Modify** `apps/fiona-slack/src/agent/escalation.js` — gate the keyword/mention escalate path (`escalateViaSay`).
- **Modify** `apps/fiona-slack/.env.sample` — document the two new env vars.

---

## Task 1: Feature-flags store (Cosmos reads, DEPLOYMENT_TYPE-scoped)

**Files:**
- Create: `apps/fiona-slack/src/agent/feature-flags-store.js`
- Test: `apps/fiona-slack/tests/agent/feature-flags-store.test.js`
- Modify: `apps/fiona-slack/.env.sample`

**Interfaces:**
- Consumes: `isEmulatorTarget` from `./cosmos-utils.js` (existing).
- Produces:
  - `getGlobalFlags(logger?) → Promise<Record<string, boolean> | null>` — reads doc id `${scope}:global`; returns its `flags` object, or `null` if Cosmos is unconfigured, the doc is absent (404), or the read fails after retries.
  - `getUserFlags(userId, logger?) → Promise<Record<string, boolean> | null>` — reads doc id `${scope}:${userId}`; same return contract.
  - `scope` = `process.env.DEPLOYMENT_TYPE || 'local'`, computed per call.

- [ ] **Step 1: Write the failing test (no-config no-op)**

Create `apps/fiona-slack/tests/agent/feature-flags-store.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockRead = jest.fn();
const mockItem = jest.fn(() => ({ read: mockRead }));
const mockContainerObj = { item: mockItem };
const mockDatabase = { container: jest.fn().mockReturnValue(mockContainerObj) };
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
}));

jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

async function loadFresh() {
  jest.resetModules();
  return import('../../src/agent/feature-flags-store.js');
}

beforeEach(() => {
  mockRead.mockReset();
  mockItem.mockClear();
  MockCosmosClient.mockClear();
  delete process.env.COSMOS_CONNECTION_STRING;
  delete process.env.COSMOS_ENDPOINT;
  delete process.env.COSMOS_KEY;
  delete process.env.DEPLOYMENT_TYPE;
});

describe('no Cosmos config', () => {
  it('getGlobalFlags returns null and does not instantiate a client', async () => {
    const store = await loadFresh();
    expect(await store.getGlobalFlags(null)).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });

  it('getUserFlags returns null and does not instantiate a client', async () => {
    const store = await loadFresh();
    expect(await store.getUserFlags('U123', null)).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/feature-flags-store.test.js`
Expected: FAIL — cannot resolve `../../src/agent/feature-flags-store.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation (client + config + no-op)**

Create `apps/fiona-slack/src/agent/feature-flags-store.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { isEmulatorTarget } from './cosmos-utils.js';

let warnedMissingConfig = false;
/** @type {import('@azure/cosmos').CosmosClient | null} */
let cosmosClient = null;
/** @type {Promise<import('@azure/cosmos').Container | null> | null} */
let containerPromise = null;

function getConfig() {
  return {
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    connectionString: process.env.COSMOS_CONNECTION_STRING,
    database: process.env.COSMOS_DATABASE || 'chatbot',
    container: process.env.COSMOS_FEATURE_FLAGS_CONTAINER || 'feature-flags',
  };
}

function scopePrefix() {
  return process.env.DEPLOYMENT_TYPE || 'local';
}

function resetContainerCache() {
  containerPromise = null;
  cosmosClient = null;
}

async function _buildContainer(logger) {
  const config = getConfig();
  if (!cosmosClient) {
    if (config.connectionString) {
      cosmosClient = new CosmosClient(config.connectionString);
    } else if (config.endpoint && config.key) {
      cosmosClient = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    } else if (config.endpoint) {
      cosmosClient = new CosmosClient({ endpoint: config.endpoint, aadCredentials: new DefaultAzureCredential() });
    } else {
      if (!warnedMissingConfig) {
        warnedMissingConfig = true;
        logger?.warn?.(
          'CosmosDB not configured — feature-flags store unavailable. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
        );
      }
      return null;
    }
  }
  return cosmosClient.database(config.database).container(config.container);
}

function getContainer(logger, options = {}) {
  if (options.forceRefresh) resetContainerCache();
  if (!containerPromise) {
    containerPromise = _buildContainer(logger).catch((err) => {
      containerPromise = null;
      throw err;
    });
  }
  return containerPromise;
}

const RETRYABLE_CODES = new Set([410, 429, 449, 503]);
const RECONNECT_CODES = new Set([410, 503]);

function toNumericCode(error) {
  const raw = error?.code ?? error?.statusCode;
  const code = Number(raw);
  return Number.isFinite(code) ? code : null;
}

function getRetryPolicy() {
  const config = getConfig();
  if (process.env.NODE_ENV === 'test') return { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 };
  if (isEmulatorTarget(config.connectionString, config.endpoint)) {
    return { maxAttempts: 8, baseDelayMs: 400, maxDelayMs: 5000 };
  }
  return { maxAttempts: 3, baseDelayMs: 150, maxDelayMs: 1200 };
}

function getDelayMs(policy, attempt) {
  const base = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(base * 0.2)));
  return base + jitter;
}

/**
 * Read a flags document by id with retry. Returns the document's `flags` object,
 * or null when Cosmos is unconfigured, the document is absent, or reads fail.
 * @param {string} id
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<Record<string, boolean> | null>}
 */
async function readFlagsDoc(id, logger) {
  const policy = getRetryPolicy();
  let forceRefresh = false;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const c = await getContainer(logger, { forceRefresh });
      if (!c) return null;
      const { resource } = await c.item(id, id).read();
      return resource?.flags ?? null;
    } catch (error) {
      const code = toNumericCode(error);
      if (code === 404) return null;
      if (!RETRYABLE_CODES.has(code) || attempt === policy.maxAttempts) {
        logger?.warn?.(`Failed to read feature-flags doc ${id}: ${error.message}`);
        return null;
      }
      forceRefresh = RECONNECT_CODES.has(code);
      if (forceRefresh) resetContainerCache();
      await new Promise((resolve) => setTimeout(resolve, getDelayMs(policy, attempt)));
    }
  }
  return null;
}

/**
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<Record<string, boolean> | null>}
 */
export function getGlobalFlags(logger) {
  return readFlagsDoc(`${scopePrefix()}:global`, logger);
}

/**
 * @param {string} userId
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<Record<string, boolean> | null>}
 */
export function getUserFlags(userId, logger) {
  return readFlagsDoc(`${scopePrefix()}:${userId}`, logger);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/feature-flags-store.test.js`
Expected: PASS (both no-config cases).

- [ ] **Step 5: Add the found/404/scoping tests**

Append to the test file:

```javascript
describe('reads with Cosmos configured', () => {
  beforeEach(() => {
    process.env.COSMOS_ENDPOINT = 'https://acct.documents.azure.com:443/';
    process.env.COSMOS_KEY = 'k';
    process.env.NODE_ENV = 'test';
  });

  it('getGlobalFlags reads the DEPLOYMENT_TYPE-scoped global id and returns its flags', async () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    mockRead.mockResolvedValue({ resource: { id: 'production:global', flags: { escalate: false } } });
    const store = await loadFresh();
    const flags = await store.getGlobalFlags(null);
    expect(mockItem).toHaveBeenCalledWith('production:global', 'production:global');
    expect(flags).toEqual({ escalate: false });
  });

  it('getUserFlags reads the scoped per-user id', async () => {
    process.env.DEPLOYMENT_TYPE = 'insiders';
    mockRead.mockResolvedValue({ resource: { id: 'insiders:U123', flags: { newCommand: true } } });
    const store = await loadFresh();
    const flags = await store.getUserFlags('U123', null);
    expect(mockItem).toHaveBeenCalledWith('insiders:U123', 'insiders:U123');
    expect(flags).toEqual({ newCommand: true });
  });

  it('defaults the scope to "local" when DEPLOYMENT_TYPE is unset', async () => {
    mockRead.mockResolvedValue({ resource: { flags: {} } });
    const store = await loadFresh();
    await store.getGlobalFlags(null);
    expect(mockItem).toHaveBeenCalledWith('local:global', 'local:global');
  });

  it('returns null on a 404 (document absent)', async () => {
    mockRead.mockRejectedValue({ code: 404 });
    const store = await loadFresh();
    expect(await store.getGlobalFlags(null)).toBeNull();
  });

  it('returns null and warns when a read fails non-retryably', async () => {
    mockRead.mockRejectedValue({ code: 400, message: 'bad request' });
    const store = await loadFresh();
    const logger = { warn: jest.fn() };
    expect(await store.getUserFlags('U123', logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to read feature-flags doc'));
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/agent/feature-flags-store.test.js`
Expected: PASS (all cases). If the 404 case fails, confirm `toNumericCode` returns 404 and `readFlagsDoc` returns before the retryable branch.

- [ ] **Step 7: Document the new env var in `.env.sample`**

In `apps/fiona-slack/.env.sample`, under the Cosmos block (after the `COSMOS_CONVERSATIONS_CONTAINER` line), add:

```shell
# Optional, Cosmos container holding feature-flag documents. Defaults to feature-flags.
# COSMOS_FEATURE_FLAGS_CONTAINER=feature-flags
```

- [ ] **Step 8: Commit**

```bash
git add apps/fiona-slack/src/agent/feature-flags-store.js apps/fiona-slack/tests/agent/feature-flags-store.test.js apps/fiona-slack/.env.sample
git commit -m "feat: add DEPLOYMENT_TYPE-scoped feature-flags Cosmos store"
```

---

## Task 2: Evaluation layer (`isFeatureEnabled`, registry, TTL cache)

**Files:**
- Create: `apps/fiona-slack/src/agent/feature-flags.js`
- Test: `apps/fiona-slack/tests/agent/feature-flags.test.js`
- Modify: `apps/fiona-slack/.env.sample`

**Interfaces:**
- Consumes: `getGlobalFlags(logger)`, `getUserFlags(userId, logger)` from `./feature-flags-store.js` (Task 1).
- Produces:
  - `isFeatureEnabled(flagName, { userId } = {}, logger?) → Promise<boolean>`
  - `FLAG_REGISTRY` — exported object of `{ [flagName]: { default: boolean } }`.
  - `__clearFeatureFlagCache()` — test helper that empties the in-memory cache.

- [ ] **Step 1: Write the failing test (registry precedence + unknown flag)**

Create `apps/fiona-slack/tests/agent/feature-flags.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockGetGlobalFlags = jest.fn();
const mockGetUserFlags = jest.fn();

jest.unstable_mockModule('../../src/agent/feature-flags-store.js', () => ({
  getGlobalFlags: mockGetGlobalFlags,
  getUserFlags: mockGetUserFlags,
}));

let isFeatureEnabled, __clearFeatureFlagCache;

beforeEach(async () => {
  jest.resetModules();
  mockGetGlobalFlags.mockReset().mockResolvedValue(null);
  mockGetUserFlags.mockReset().mockResolvedValue(null);
  delete process.env.FEATURE_FLAGS_CACHE_TTL_MS;
  ({ isFeatureEnabled, __clearFeatureFlagCache } = await import('../../src/agent/feature-flags.js'));
  __clearFeatureFlagCache();
});

describe('resolution precedence', () => {
  it('unknown flag returns false, warns, and does not query Cosmos', async () => {
    const logger = { warn: jest.fn() };
    expect(await isFeatureEnabled('nope', { userId: 'U1' }, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
    expect(mockGetGlobalFlags).not.toHaveBeenCalled();
    expect(mockGetUserFlags).not.toHaveBeenCalled();
  });

  it('falls back to the registry default when no documents exist', async () => {
    // escalate default is true; conversationCapture default is false
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(true);
    expect(await isFeatureEnabled('conversationCapture')).toBe(false);
  });

  it('global value overrides the registry default', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(false);
  });

  it('per-user value overrides the global value', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    mockGetUserFlags.mockResolvedValue({ escalate: true });
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(true);
  });

  it('ignores the per-user layer when no userId is supplied', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    expect(await isFeatureEnabled('escalate')).toBe(false);
    expect(mockGetUserFlags).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/feature-flags.test.js`
Expected: FAIL — cannot resolve `../../src/agent/feature-flags.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/fiona-slack/src/agent/feature-flags.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getGlobalFlags, getUserFlags } from './feature-flags-store.js';

/**
 * Known flags and their safe defaults. A flag not listed here is unknown:
 * isFeatureEnabled logs a warning and returns false without touching Cosmos.
 * @type {Record<string, { default: boolean }>}
 */
export const FLAG_REGISTRY = {
  conversationCapture: { default: false },
  escalate: { default: true },
};

const GLOBAL_CACHE_KEY = '__global__';

/** @type {Map<string, { value: Record<string, boolean> | null, expiresAt: number }>} */
const cache = new Map();

function cacheTtlMs() {
  const raw = Number(process.env.FEATURE_FLAGS_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

/**
 * Return the cached value for `key`, or fetch it via `loader` and cache it.
 * A zero TTL disables caching (always reloads).
 */
async function cached(key, loader) {
  const ttl = cacheTtlMs();
  const now = Date.now();
  const hit = cache.get(key);
  if (ttl > 0 && hit && hit.expiresAt > now) return hit.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: now + ttl });
  return value;
}

/** Empty the in-memory cache. Exported for tests only. */
export function __clearFeatureFlagCache() {
  cache.clear();
}

/**
 * Resolve a feature flag: per-user override → global → registry default.
 * Never throws; degrades to the registry default on any Cosmos failure.
 *
 * @param {string} flagName
 * @param {{ userId?: string }} [opts]
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(flagName, opts = {}, logger) {
  const entry = FLAG_REGISTRY[flagName];
  if (!entry) {
    logger?.warn?.(`Unknown feature flag "${flagName}"; returning false.`);
    return false;
  }

  const { userId } = opts;
  if (userId) {
    const userFlags = await cached(userId, () => getUserFlags(userId, logger));
    if (userFlags && flagName in userFlags) return Boolean(userFlags[flagName]);
  }

  const globalFlags = await cached(GLOBAL_CACHE_KEY, () => getGlobalFlags(logger));
  if (globalFlags && flagName in globalFlags) return Boolean(globalFlags[flagName]);

  return entry.default;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/feature-flags.test.js`
Expected: PASS (all precedence cases).

- [ ] **Step 5: Add caching + degradation tests**

Append to the test file:

```javascript
describe('caching', () => {
  it('serves a second call within the TTL from cache (one store read)', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    await isFeatureEnabled('escalate');
    await isFeatureEnabled('escalate');
    expect(mockGetGlobalFlags).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the TTL expires', async () => {
    jest.useFakeTimers();
    try {
      process.env.FEATURE_FLAGS_CACHE_TTL_MS = '30000';
      mockGetGlobalFlags.mockResolvedValue({ escalate: false });
      await isFeatureEnabled('escalate');
      jest.advanceTimersByTime(30_001);
      await isFeatureEnabled('escalate');
      expect(mockGetGlobalFlags).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('degradation', () => {
  it('returns the registry default when the store returns null', async () => {
    mockGetGlobalFlags.mockResolvedValue(null);
    mockGetUserFlags.mockResolvedValue(null);
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(true);
  });
});
```

> Note: `cached()` reads `Date.now()`, which Jest fake timers control, so `advanceTimersByTime` expires the entry without real waiting.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/agent/feature-flags.test.js`
Expected: PASS (all cases).

- [ ] **Step 7: Document the new env var in `.env.sample`**

In `apps/fiona-slack/.env.sample`, after the `COSMOS_FEATURE_FLAGS_CONTAINER` line added in Task 1, add:

```shell
# Optional, in-memory feature-flag cache TTL in milliseconds. Defaults to 30000.
# FEATURE_FLAGS_CACHE_TTL_MS=30000
```

- [ ] **Step 8: Commit**

```bash
git add apps/fiona-slack/src/agent/feature-flags.js apps/fiona-slack/tests/agent/feature-flags.test.js apps/fiona-slack/.env.sample
git commit -m "feat: add isFeatureEnabled evaluation layer with registry and TTL cache"
```

---

## Task 3: Retrofit `conversationCapture` (global kill-switch)

**Files:**
- Modify: `apps/fiona-slack/src/agent/conversation-capture-store.js:9` and the `captureConversation` guard (currently `if (!CAPTURE_ALL_CONVERSATIONS) return;`)
- Test: `apps/fiona-slack/tests/agent/conversation-capture-store.test.js` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: `isFeatureEnabled` from `./feature-flags.js` (Task 2).
- Produces: no new exports; behavior change only.

**Behavior:** The guard becomes `if (!(await isFeatureEnabled('conversationCapture', {}, logger))) return;`. With no `feature-flags` container, `conversationCapture` resolves to its registry default `false` — identical to today's default-off behavior. The module-level `CAPTURE_ALL_CONVERSATIONS` constant is removed.

- [ ] **Step 1: Write the failing test**

Create/extend `apps/fiona-slack/tests/agent/conversation-capture-store.test.js`. Mock the feature-flags module and the Cosmos client; assert the capture write only happens when the flag is on:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockIsFeatureEnabled = jest.fn();
const mockUpsert = jest.fn().mockResolvedValue({});
const mockContainerObj = { items: { upsert: mockUpsert } };
const mockDatabase = { container: jest.fn().mockReturnValue(mockContainerObj) };
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
}));

jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.unstable_mockModule('../../src/agent/feature-flags.js', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

async function loadFresh() {
  jest.resetModules();
  return import('../../src/agent/conversation-capture-store.js');
}

const capture = {
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '1.1',
  messageTs: '1.2',
  userMessage: 'q',
  botResponse: 'a',
};

beforeEach(() => {
  mockUpsert.mockClear();
  MockCosmosClient.mockClear();
  process.env.COSMOS_ENDPOINT = 'https://acct.documents.azure.com:443/';
  process.env.COSMOS_KEY = 'k';
  process.env.NODE_ENV = 'test';
});

describe('captureConversation flag gating', () => {
  it('does not write when conversationCapture is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const mod = await loadFresh();
    await mod.captureConversation({ ...capture, logger: null });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('writes when conversationCapture is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const mod = await loadFresh();
    await mod.captureConversation({ ...capture, logger: null });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
```

> Before writing, open `conversation-capture-store.js` and confirm the exact exported function name and its parameter object shape; adjust the `capture` fixture keys to match the real required fields so the write path is reached.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/conversation-capture-store.test.js`
Expected: FAIL — the "does not write when disabled" test fails because the current guard reads the removed/legacy env constant, not the mock (write may fire or the mock is never consulted).

- [ ] **Step 3: Implement — replace the guard**

In `apps/fiona-slack/src/agent/conversation-capture-store.js`:
1. Delete line 9: `const CAPTURE_ALL_CONVERSATIONS = process.env.CAPTURE_ALL_CONVERSATIONS === 'true';`
2. Add the import near the other imports at the top:

```javascript
import { isFeatureEnabled } from './feature-flags.js';
```

3. Replace the guard inside `captureConversation` (currently `if (!CAPTURE_ALL_CONVERSATIONS) return;`) with:

```javascript
if (!(await isFeatureEnabled('conversationCapture', {}, logger))) return;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/agent/conversation-capture-store.test.js`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `npm test`
Expected: PASS. If any pre-existing capture test set `CAPTURE_ALL_CONVERSATIONS=true`, update it to mock `isFeatureEnabled` instead.

- [ ] **Step 6: Commit**

```bash
git add apps/fiona-slack/src/agent/conversation-capture-store.js apps/fiona-slack/tests/agent/conversation-capture-store.test.js
git commit -m "refactor: gate conversation capture behind isFeatureEnabled"
```

---

## Task 4: Gate `escalate` at both entry points (per-user beta gating)

**Files:**
- Modify: `apps/fiona-slack/src/listeners/commands/command-handler.js` (add copy constant)
- Modify: `apps/fiona-slack/src/listeners/commands/fiona.js:117-129` (slash `handleEscalate`)
- Modify: `apps/fiona-slack/src/agent/escalation.js` (`escalateViaSay`, ~line 237)
- Test: `apps/fiona-slack/tests/listeners/commands/fiona.test.js` (create/extend)

**Interfaces:**
- Consumes: `isFeatureEnabled` from `../../agent/feature-flags.js` (Task 2); `ESCALATE_UNAVAILABLE_TEXT` from `./command-handler.js` (added below).
- Produces: `ESCALATE_UNAVAILABLE_TEXT` export.

**Rationale:** `escalate` reaches users through two paths — the slash command (`fiona.js`) and the keyword/@-mention path (`escalation.js` `escalateViaSay`). Gating only the slash command would let a blocked user still escalate via @-mention. Both are gated with `{ userId }` so beta targeting is consistent.

- [ ] **Step 1: Add the shared copy constant**

In `apps/fiona-slack/src/listeners/commands/command-handler.js`, after the `ESCALATE_ERROR_TEXT` declaration (line ~37), add:

```javascript
export const ESCALATE_UNAVAILABLE_TEXT =
  ':information_source: Escalation isn’t available for your account right now.';
```

- [ ] **Step 2: Write the failing test (slash path)**

Create/extend `apps/fiona-slack/tests/listeners/commands/fiona.test.js`. Mock `feature-flags`, `escalation`, `rate-limiter`, and `interaction-store`; assert a disabled flag short-circuits before `postEscalation`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockIsFeatureEnabled = jest.fn();
const mockPostEscalation = jest.fn().mockResolvedValue({ ok: true, errorType: null });
const mockCheckRateLimit = jest.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 });

jest.unstable_mockModule('../../../src/agent/feature-flags.js', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({
  postEscalation: mockPostEscalation,
}));
jest.unstable_mockModule('../../../src/agent/rate-limiter.js', () => ({
  checkRateLimit: mockCheckRateLimit,
  rateLimitMessage: () => 'slow down',
}));
jest.unstable_mockModule('../../../src/agent/interaction-store.js', () => ({
  recordInteraction: jest.fn().mockResolvedValue(undefined),
}));

let fionaCommandCallback, ESCALATE_UNAVAILABLE_TEXT;

beforeEach(async () => {
  jest.resetModules();
  mockIsFeatureEnabled.mockReset();
  mockPostEscalation.mockClear();
  ({ fionaCommandCallback } = await import('../../../src/listeners/commands/fiona.js'));
  ({ ESCALATE_UNAVAILABLE_TEXT } = await import('../../../src/listeners/commands/command-handler.js'));
});

function makeArgs() {
  return {
    command: { text: 'escalate', user_id: 'U1', team_id: 'T1', channel_id: 'C1', trigger_id: 'trg1' },
    ack: jest.fn().mockResolvedValue(undefined),
    respond: jest.fn().mockResolvedValue(undefined),
    client: {},
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('/fiona escalate gating', () => {
  it('short-circuits with the unavailable message when escalate is disabled for the user', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const args = makeArgs();
    await fionaCommandCallback(args);
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('escalate', { userId: 'U1' }, args.logger);
    expect(mockPostEscalation).not.toHaveBeenCalled();
    expect(args.respond).toHaveBeenCalledWith({ response_type: 'ephemeral', text: ESCALATE_UNAVAILABLE_TEXT });
  });

  it('proceeds to postEscalation when escalate is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const args = makeArgs();
    await fionaCommandCallback(args);
    expect(mockPostEscalation).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/listeners/commands/fiona.test.js`
Expected: FAIL — `postEscalation` is still called when disabled (no gate yet) and/or `ESCALATE_UNAVAILABLE_TEXT` is undefined.

- [ ] **Step 4: Implement the slash gate**

In `apps/fiona-slack/src/listeners/commands/fiona.js`:
1. Add `isFeatureEnabled` import at the top:

```javascript
import { isFeatureEnabled } from '../../agent/feature-flags.js';
```

2. Add `ESCALATE_UNAVAILABLE_TEXT` to the existing import from `./command-handler.js`.
3. In `handleEscalate`, immediately after the `hasRequiredFields` guard (line ~129) and before the rate-limit check, insert:

```javascript
if (!(await isFeatureEnabled('escalate', { userId: command.user_id }, logger))) {
  await respond({ response_type: 'ephemeral', text: ESCALATE_UNAVAILABLE_TEXT });
  return;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/listeners/commands/fiona.test.js`
Expected: PASS (both cases).

- [ ] **Step 6: Gate the keyword/@-mention path**

In `apps/fiona-slack/src/agent/escalation.js`:
1. Add imports at the top:

```javascript
import { isFeatureEnabled } from './feature-flags.js';
import { ESCALATE_UNAVAILABLE_TEXT } from '../listeners/commands/command-handler.js';
```

2. At the start of `escalateViaSay` (before it calls `postEscalation`, ~line 249), insert:

```javascript
if (!(await isFeatureEnabled('escalate', { userId }, logger))) {
  await say({ text: ESCALATE_UNAVAILABLE_TEXT, thread_ts: threadTs }).catch((err) =>
    logger?.warn?.(`Failed to send escalation-unavailable notice: ${err.message}`),
  );
  return;
}
```

> Check for an import cycle: `escalation.js` now imports from `command-handler.js`, which already imports nothing from `escalation.js` (verified — `command-handler.js` has no such import). If a cycle is later introduced, move `ESCALATE_UNAVAILABLE_TEXT` alongside the other `ESCALATE_*` constants, which already live in `command-handler.js`.

- [ ] **Step 7: Add the keyword-path test**

Create/extend `apps/fiona-slack/tests/agent/escalation.test.js` with a case asserting `escalateViaSay` calls `say` with `ESCALATE_UNAVAILABLE_TEXT` and does not call `postEscalation` when the flag is off. Mock `./feature-flags.js` (as in Task 3) and the `postEscalation` dependency. Mirror the structure of the Task 4 Step 2 test.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. Watch for existing escalate tests that assumed the feature was always on — update them to mock `isFeatureEnabled` returning `true`.

- [ ] **Step 9: Commit**

```bash
git add apps/fiona-slack/src/listeners/commands/command-handler.js apps/fiona-slack/src/listeners/commands/fiona.js apps/fiona-slack/src/agent/escalation.js apps/fiona-slack/tests/listeners/commands/fiona.test.js apps/fiona-slack/tests/agent/escalation.test.js
git commit -m "feat: gate escalate (slash + keyword) behind per-user feature flag"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run the full test suite**

Run (from `apps/fiona-slack/`): `npm test`
Expected: all suites PASS, including the four new/extended files.

- [ ] **Step 2: Run lint/format if the repo enforces it**

Run whatever the repo uses (check `package.json` scripts, e.g. `npm run lint`). Fix any issues. If no lint script exists, skip.

- [ ] **Step 3: Confirm `.env.sample` documents both new vars**

Verify `COSMOS_FEATURE_FLAGS_CONTAINER` and `FEATURE_FLAGS_CACHE_TTL_MS` are present and commented in `apps/fiona-slack/.env.sample`.

- [ ] **Step 4: Manual smoke checklist (no code changes)**

Document (in the PR description) the manual verification an operator should run post-deploy:
1. With no `feature-flags` container: `conversationCapture` off, `escalate` on (registry defaults) — app behaves as today.
2. Insert `{ "id": "<deploymentType>:global", "flags": { "escalate": false } }` — escalate returns the unavailable message for all users within ~30s.
3. Insert `{ "id": "<deploymentType>:<yourUserId>", "flags": { "escalate": true } }` — escalate works for you only.

---

## Self-Review Notes

- **Spec coverage:** Store (Task 1), evaluation + registry + cache + degradation (Task 2), `conversationCapture` retrofit (Task 3), `escalate` retrofit incl. both entry points (Task 4), env-var docs (Tasks 1–2), environment scoping (Task 1 tests), testing matrix (Tasks 1–4). Azure App Configuration is a documented non-goal; no task.
- **Deviation from spec:** the spec's Integration Points mention only `/fiona escalate`; this plan also gates the @-mention/keyword path (`escalateViaSay`) so beta targeting is consistent across entry points. Called out in Task 4 rationale.
- **Interface consistency:** `getGlobalFlags`/`getUserFlags` (Task 1) are the exact names consumed in Task 2; `isFeatureEnabled(flagName, { userId }, logger)` signature is identical across Tasks 2–4; `ESCALATE_UNAVAILABLE_TEXT` defined in Task 4 Step 1 and consumed in Steps 4/6.
