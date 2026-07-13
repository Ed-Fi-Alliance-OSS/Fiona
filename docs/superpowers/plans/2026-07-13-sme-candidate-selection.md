# SME Candidate Selection Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-script pipeline + agent wrapper that fetches Fiona conversations from Cosmos DB, classifies them by Ed-Fi topic via Claude, and exports a stratified 15–20 row CSV ready for Slack List import.

**Architecture:** Phase A (`fetch-candidates.js`) is pure IO — queries Cosmos, joins feedback, constructs Slack URLs, writes `candidates-raw.json`. Phase B classification happens either inline when invoked via the agent wrapper, or through `select-candidates.js` which calls the `claude` CLI via `spawnSync`. `format-candidates-csv.js` is a pure transformer that converts classified JSON to CSV and is shared by both paths.

**Tech Stack:** Node.js ESM, `@azure/cosmos`, `@azure/identity`, `@slack/bolt` (Slack API via raw fetch), `child_process.spawnSync` (claude CLI), Jest with `--experimental-vm-modules`.

## Global Constraints

- Every new `.js` file MUST start with the Apache 2.0 license header (see `CLAUDE.md`).
- All test files go in `apps/fiona-slack/tests/scripts/`.
- Run tests from `apps/fiona-slack/` with: `node --experimental-vm-modules node_modules/jest-cli/bin/jest.js`
- Run a single test file: `node --experimental-vm-modules node_modules/jest-cli/bin/jest.js tests/scripts/<file>.test.js`
- Use `jest.unstable_mockModule` for ESM module mocking — always define mocks BEFORE any `import()` of the module under test (see `tests/agent/feedback-store.test.js` for the pattern).
- All imports use ES module syntax (`import`/`export`). No CommonJS (`require`).
- Follow the `getArg()` / `loadDotenv()` helper pattern from `scripts/load-slack-users.js` for CLI argument parsing.
- Never add comments explaining what code does — only add comments for non-obvious WHY (hidden constraints, workarounds).
- Default `deploymentType` is always `production`. Never surface `local` or `insiders` records.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/fiona-slack/scripts/fetch-candidates.js` | Cosmos + Slack IO → `candidates-raw.json` |
| Create | `apps/fiona-slack/scripts/format-candidates-csv.js` | JSON → CSV (pure transformation) |
| Create | `apps/fiona-slack/scripts/select-candidates.js` | claude CLI classification + stratified selection |
| Create | `.github/agents/sme-candidate-selector.agent.md` | Agent wrapper for agentic invocation |
| Modify | `CLAUDE.md` | Add agent discoverability entry |
| Create | `apps/fiona-slack/tests/scripts/format-candidates-csv.test.js` | Tests for CSV formatter |
| Create | `apps/fiona-slack/tests/scripts/fetch-candidates.test.js` | Tests for Cosmos/Slack IO |
| Create | `apps/fiona-slack/tests/scripts/select-candidates.test.js` | Tests for classification + selection |

---

## Task 1: `format-candidates-csv.js`

Start here — no external dependencies, pure transformation, fastest feedback loop.

**Files:**
- Create: `apps/fiona-slack/scripts/format-candidates-csv.js`
- Create: `apps/fiona-slack/tests/scripts/format-candidates-csv.test.js`

**Interfaces:**
- Produces: `formatCsv(candidates: object[]) → string` — exported for tests
- Produces: `main() → Promise<void>` — CLI entry point

- [ ] **Step 1: Write the failing test**

Create `apps/fiona-slack/tests/scripts/format-candidates-csv.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { formatCsv } from '../../../scripts/format-candidates-csv.js';

const base = {
  id: 'U1_ts1_ts2',
  userMessage: 'How do descriptors work?',
  botResponse: 'Descriptors are controlled vocabularies.',
  slackUrl: 'https://ed-fi-alliance.slack.com/archives/C123/p17830000000000',
  sources: [{ url: 'https://docs.ed-fi.org/desc', title: 'Descriptors', hostname: 'docs.ed-fi.org' }],
  topic: 'Descriptors',
  hasBadFeedback: false,
  selected: true,
};

const HEADER = 'User question,Fiona response,Thread link,Sources,Topic,Bad feedback,Assigned SME,Accuracy score,Helpfulness score,Correction needed,Corrected response,Gap category,Notes,Status';

describe('formatCsv', () => {
  it('returns only header row for empty input', () => {
    expect(formatCsv([])).toBe(HEADER);
  });

  it('omits records where selected is false', () => {
    const lines = formatCsv([{ ...base, selected: false }]).split('\n');
    expect(lines).toHaveLength(1);
  });

  it('writes one data row per selected record', () => {
    const lines = formatCsv([base]).split('\n');
    expect(lines).toHaveLength(2);
  });

  it('places Status=Pending and empty SME/score columns', () => {
    const row = formatCsv([base]).split('\n')[1];
    expect(row).toContain('Pending');
    // 8 empty fields: Assigned SME, Accuracy, Helpfulness, Correction needed,
    // Corrected response, Gap category, Notes (all empty before Status)
    const fields = row.match(/,/g)?.length ?? 0;
    expect(fields).toBe(13); // 14 columns = 13 commas (unquoted row)
  });

  it('sets Bad feedback to Yes for hasBadFeedback true', () => {
    const row = formatCsv([{ ...base, hasBadFeedback: true }]).split('\n')[1];
    expect(row).toContain(',Yes,');
  });

  it('joins multiple sources with newline inside quoted field', () => {
    const candidate = {
      ...base,
      sources: [
        { url: 'https://docs.ed-fi.org/a', title: 'A', hostname: 'docs.ed-fi.org' },
        { url: 'https://docs.ed-fi.org/b', title: 'B', hostname: 'docs.ed-fi.org' },
      ],
    };
    const csv = formatCsv([candidate]);
    expect(csv).toContain('"https://docs.ed-fi.org/a\nhttps://docs.ed-fi.org/b"');
  });

  it('escapes double quotes in field values', () => {
    const csv = formatCsv([{ ...base, userMessage: 'What is "LEA"?' }]);
    expect(csv).toContain('"What is ""LEA""?"');
  });

  it('wraps fields containing commas in quotes', () => {
    const csv = formatCsv([{ ...base, topic: 'Student, Assessment' }]);
    expect(csv).toContain('"Student, Assessment"');
  });

  it('handles null/undefined sources gracefully', () => {
    expect(() => formatCsv([{ ...base, sources: null }])).not.toThrow();
    expect(() => formatCsv([{ ...base, sources: undefined }])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd apps/fiona-slack
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js tests/scripts/format-candidates-csv.test.js
```

Expected: `Cannot find module '../../../scripts/format-candidates-csv.js'`

- [ ] **Step 3: Implement `format-candidates-csv.js`**

Create `apps/fiona-slack/scripts/format-candidates-csv.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COLUMNS = [
  'User question',
  'Fiona response',
  'Thread link',
  'Sources',
  'Topic',
  'Bad feedback',
  'Assigned SME',
  'Accuracy score',
  'Helpfulness score',
  'Correction needed',
  'Corrected response',
  'Gap category',
  'Notes',
  'Status',
];

function escapeCsvField(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatCsv(candidates) {
  const rows = [COLUMNS.join(',')];
  for (const c of candidates.filter((c) => c.selected)) {
    const sources = (c.sources ?? []).map((s) => s.url).join('\n');
    rows.push(
      [
        c.userMessage ?? '',
        c.botResponse ?? '',
        c.slackUrl ?? '',
        sources,
        c.topic ?? '',
        c.hasBadFeedback ? 'Yes' : 'No',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Pending',
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return rows.join('\n');
}

function getArg(name, fallback = undefined) {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  const token = process.argv[idx];
  if (token.includes('=')) return token.split('=').slice(1).join('=');
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

export async function main() {
  const inputPath = getArg('input');
  const outputPath = getArg('output');
  if (!inputPath) throw new Error('--input is required');
  if (!outputPath) throw new Error('--output is required');

  const candidates = JSON.parse(readFileSync(path.resolve(inputPath), 'utf8'));
  const csv = formatCsv(candidates);
  writeFileSync(path.resolve(outputPath), csv, 'utf8');

  const count = candidates.filter((c) => c.selected).length;
  console.log(`Written ${count} rows to ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js tests/scripts/format-candidates-csv.test.js
```

Expected: `Tests: 9 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/fiona-slack/scripts/format-candidates-csv.js apps/fiona-slack/tests/scripts/format-candidates-csv.test.js
git commit -m "feat(ai-152): add format-candidates-csv.js with tests"
```

---

## Task 2: `fetch-candidates.js`

**Files:**
- Create: `apps/fiona-slack/scripts/fetch-candidates.js`
- Create: `apps/fiona-slack/tests/scripts/fetch-candidates.test.js`

**Interfaces:**
- Consumes: Cosmos containers passed as parameters (for testability)
- Produces: `buildSlackUrl(channelId: string, messageTs: string) → string`
- Produces: `fetchConversations(container, { deploymentType: string, since: string }) → Promise<object[]>`
- Produces: `joinFeedback(conversations: object[], feedbackContainer, { deploymentType: string }) → Promise<object[]>`
- Produces: `main() → Promise<void>`

**Key implementation note:** The Cosmos `conversations` container rejects SQL queries with `AND c.timestamp >= "..."` filters (400 BadRequest — known issue with the multi-hash partition key on this account). Fetch all production records ordered by timestamp DESC and filter client-side. Stop fetching early when the oldest record in a batch predates `since`.

- [ ] **Step 1: Write failing tests for `buildSlackUrl` and `fetchConversations`**

Create `apps/fiona-slack/tests/scripts/fetch-candidates.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: jest.fn(),
}));
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

let buildSlackUrl, fetchConversations, joinFeedback;

beforeEach(async () => {
  jest.resetModules();
  ({ buildSlackUrl, fetchConversations, joinFeedback } = await import('../../../scripts/fetch-candidates.js'));
});

describe('buildSlackUrl', () => {
  it('constructs URL stripping the dot from messageTs', () => {
    expect(buildSlackUrl('C123ABC', '1783737161.950319')).toBe(
      'https://ed-fi-alliance.slack.com/archives/C123ABC/p1783737161950319',
    );
  });

  it('pads the numeric portion to 16 characters after removing dot', () => {
    expect(buildSlackUrl('C123', '1234.56')).toBe(
      'https://ed-fi-alliance.slack.com/archives/C123/p1234560000000000',
    );
  });

  it('handles messageTs with no dot', () => {
    expect(buildSlackUrl('C123', '1783737161950319')).toBe(
      'https://ed-fi-alliance.slack.com/archives/C123/p1783737161950319',
    );
  });
});

describe('fetchConversations', () => {
  it('returns conversations mapped with threadTurns and without threadHistory', async () => {
    const mockFetchAll = jest.fn().mockResolvedValue({
      resources: [
        {
          id: 'U1_ts1_ts2',
          userId: 'U1',
          channelId: 'D123',
          threadTs: 'ts1',
          messageTs: 'ts2',
          userMessage: 'Q?',
          botResponse: 'A.',
          sources: [],
          threadHistory: ['a', 'b', 'c'],
          timestamp: '2026-07-01T00:00:00Z',
          entryPoint: 'assistant_message',
          deploymentType: 'production',
        },
      ],
    });
    const mockContainer = {
      items: { query: jest.fn().mockReturnValue({ fetchAll: mockFetchAll }) },
    };

    const results = await fetchConversations(mockContainer, {
      deploymentType: 'production',
      since: '2026-06-01T00:00:00Z',
    });

    expect(results).toHaveLength(1);
    expect(results[0].threadTurns).toBe(3);
    expect(results[0]).not.toHaveProperty('threadHistory');
    expect(results[0].source).toBe('cosmos');
  });

  it('filters out records older than since', async () => {
    const mockFetchAll = jest.fn().mockResolvedValue({
      resources: [
        { id: 'new', timestamp: '2026-07-01T00:00:00Z', threadHistory: [], sources: [] },
        { id: 'old', timestamp: '2026-05-01T00:00:00Z', threadHistory: [], sources: [] },
      ],
    });
    const mockContainer = {
      items: { query: jest.fn().mockReturnValue({ fetchAll: mockFetchAll }) },
    };

    const results = await fetchConversations(mockContainer, {
      deploymentType: 'production',
      since: '2026-06-01T00:00:00Z',
    });

    expect(results.map((r) => r.id)).toEqual(['new']);
  });

  it('returns empty array when container returns no resources', async () => {
    const mockFetchAll = jest.fn().mockResolvedValue({ resources: [] });
    const mockContainer = {
      items: { query: jest.fn().mockReturnValue({ fetchAll: mockFetchAll }) },
    };

    const results = await fetchConversations(mockContainer, {
      deploymentType: 'production',
      since: '2026-06-01T00:00:00Z',
    });

    expect(results).toEqual([]);
  });
});

describe('joinFeedback', () => {
  it('sets hasBadFeedback true and reason when matching bad-feedback record exists', async () => {
    const mockRead = jest.fn().mockResolvedValue({
      resource: { value: 'bad-feedback', reason: 'wrong answer' },
    });
    const mockFeedbackContainer = {
      item: jest.fn().mockReturnValue({ read: mockRead }),
    };

    const conversations = [
      { userId: 'U1', messageTs: '1234.56', deploymentType: 'production' },
    ];
    const result = await joinFeedback(conversations, mockFeedbackContainer, {
      deploymentType: 'production',
    });

    expect(result[0].hasBadFeedback).toBe(true);
    expect(result[0].badFeedbackReason).toBe('wrong answer');
  });

  it('sets hasBadFeedback false when feedback record is good-feedback', async () => {
    const mockRead = jest.fn().mockResolvedValue({
      resource: { value: 'good-feedback', reason: null },
    });
    const mockFeedbackContainer = {
      item: jest.fn().mockReturnValue({ read: mockRead }),
    };

    const conversations = [{ userId: 'U1', messageTs: '1234.56', deploymentType: 'production' }];
    const result = await joinFeedback(conversations, mockFeedbackContainer, {
      deploymentType: 'production',
    });

    expect(result[0].hasBadFeedback).toBe(false);
    expect(result[0].badFeedbackReason).toBeNull();
  });

  it('sets hasBadFeedback false when no feedback record exists (404)', async () => {
    const mockRead = jest.fn().mockResolvedValue({ resource: undefined });
    const mockFeedbackContainer = {
      item: jest.fn().mockReturnValue({ read: mockRead }),
    };

    const conversations = [{ userId: 'U1', messageTs: '1234.56', deploymentType: 'production' }];
    const result = await joinFeedback(conversations, mockFeedbackContainer, {
      deploymentType: 'production',
    });

    expect(result[0].hasBadFeedback).toBe(false);
    expect(result[0].badFeedbackReason).toBeNull();
  });

  it('constructs feedback item id as {userId}_{messageTs}', async () => {
    const mockRead = jest.fn().mockResolvedValue({ resource: undefined });
    const mockItem = jest.fn().mockReturnValue({ read: mockRead });
    const mockFeedbackContainer = { item: mockItem };

    await joinFeedback(
      [{ userId: 'UA7S95MU2', messageTs: '1783737161.950319', deploymentType: 'production' }],
      mockFeedbackContainer,
      { deploymentType: 'production' },
    );

    expect(mockItem).toHaveBeenCalledWith(
      'UA7S95MU2_1783737161.950319',
      ['production', 'UA7S95MU2_1783737161.950319'],
    );
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js tests/scripts/fetch-candidates.test.js
```

Expected: `Cannot find module '../../../scripts/fetch-candidates.js'`

- [ ] **Step 3: Implement `fetch-candidates.js`**

Create `apps/fiona-slack/scripts/fetch-candidates.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { config as loadDotenvConfig } from 'dotenv';

export function buildSlackUrl(channelId, messageTs) {
  const numeric = messageTs.replace('.', '').padEnd(16, '0');
  return `https://ed-fi-alliance.slack.com/archives/${channelId}/p${numeric}`;
}

export async function fetchConversations(container, { deploymentType, since }) {
  const results = [];
  let offset = 0;

  while (true) {
    const { resources } = await container.items
      .query(
        `SELECT c.id, c.userId, c.channelId, c.threadTs, c.messageTs, c.userMessage, c.botResponse, c.sources, c.timestamp, c.entryPoint, c.threadHistory FROM c WHERE c.deploymentType = "${deploymentType}" ORDER BY c.timestamp DESC OFFSET ${offset} LIMIT 100`,
      )
      .fetchAll();

    if (!resources.length) break;

    for (const r of resources) {
      if (r.timestamp >= since) {
        const { threadHistory, ...rest } = r;
        results.push({
          ...rest,
          threadTurns: Array.isArray(threadHistory) ? threadHistory.length : 0,
          source: 'cosmos',
        });
      }
    }

    // All remaining records are older than our window — stop fetching
    if (resources.at(-1).timestamp < since) break;

    offset += 100;
  }

  return results;
}

export async function joinFeedback(conversations, feedbackContainer, { deploymentType }) {
  return Promise.all(
    conversations.map(async (conv) => {
      const feedbackId = `${conv.userId}_${conv.messageTs}`;
      try {
        const { resource } = await feedbackContainer
          .item(feedbackId, [deploymentType, feedbackId])
          .read();
        const hasBadFeedback = resource?.value === 'bad-feedback';
        return {
          ...conv,
          hasBadFeedback,
          badFeedbackReason: hasBadFeedback ? (resource?.reason ?? null) : null,
        };
      } catch {
        return { ...conv, hasBadFeedback: false, badFeedbackReason: null };
      }
    }),
  );
}

async function fetchSlackBackfill(token, { convSince, slackSince, existingIds }) {
  const headers = { Authorization: `Bearer ${token}` };

  const listRes = await fetch('https://slack.com/api/conversations.list?types=im&limit=200', {
    headers,
  });
  const listData = await listRes.json();
  if (!listData.ok) throw new Error(`conversations.list failed: ${listData.error}`);

  const records = [];
  for (const channel of listData.channels ?? []) {
    const repliesRes = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel.id}&ts=${channel.latest ?? ''}&limit=100`,
      { headers },
    );
    const repliesData = await repliesRes.json();
    if (!repliesData.ok) continue;

    const messages = repliesData.messages ?? [];
    for (let i = 0; i < messages.length - 1; i++) {
      const userMsg = messages[i];
      const botMsg = messages[i + 1];
      if (userMsg.bot_id || !botMsg.bot_id) continue;
      if (userMsg.ts < slackSince || userMsg.ts >= convSince) continue;

      const msgKey = `${channel.id}_${userMsg.ts}`;
      if (existingIds.has(msgKey)) continue;

      const slackUrl = buildSlackUrl(channel.id, botMsg.ts);
      records.push({
        id: `slack_${channel.id}_${userMsg.ts}`,
        userId: userMsg.user ?? 'unknown',
        channelId: channel.id,
        threadTs: messages[0].ts,
        messageTs: botMsg.ts,
        timestamp: new Date(parseFloat(botMsg.ts) * 1000).toISOString(),
        entryPoint: 'assistant_message',
        userMessage: userMsg.text?.replace(/<@[^>]+>\s*/g, '').trim() ?? '',
        botResponse: botMsg.text ?? '',
        sources: [],
        threadTurns: messages.length,
        hasBadFeedback: false,
        badFeedbackReason: null,
        slackUrl,
        source: 'slack',
      });
    }
  }
  return records;
}

function getArg(name, fallback = undefined) {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  const token = process.argv[idx];
  if (token.includes('=')) return token.split('=').slice(1).join('=');
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

function loadDotenv() {
  const envFile = getArg('env-file');
  if (envFile) {
    loadDotenvConfig({ path: path.resolve(process.cwd(), envFile) });
    return;
  }
  loadDotenvConfig();
  loadDotenvConfig({ path: path.resolve(import.meta.dirname, '..', '.env') });
}

function getCosmosClient() {
  const connStr = process.env.COSMOS_CONNECTION_STRING;
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (connStr) return new CosmosClient(connStr);
  if (endpoint) {
    return new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }
  throw new Error(
    'Cosmos DB not configured. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
  );
}

export async function main() {
  loadDotenv();

  const days = Number(getArg('days', 30));
  const deploymentType = getArg('deployment-type', process.env.DEPLOYMENT_TYPE || 'production');
  const outputPath = getArg('output', 'candidates-raw.json');
  const slackLookbackDays = getArg('slack-lookback-days')
    ? Number(getArg('slack-lookback-days'))
    : null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = process.env.COSMOS_DATABASE || 'chatbot';
  const convContainerName = process.env.COSMOS_CONVERSATIONS_CONTAINER || 'conversations';
  const fbContainerName = process.env.COSMOS_CONTAINER || 'feedback';

  const client = getCosmosClient();
  const convContainer = client.database(db).container(convContainerName);
  const fbContainer = client.database(db).container(fbContainerName);

  console.log(`Fetching conversations (last ${days} days, ${deploymentType})...`);
  let conversations = await fetchConversations(convContainer, { deploymentType, since });
  conversations = await joinFeedback(conversations, fbContainer, { deploymentType });
  conversations = conversations.map((c) => ({
    ...c,
    slackUrl: buildSlackUrl(c.channelId, c.messageTs),
  }));

  if (slackLookbackDays) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error('SLACK_BOT_TOKEN required for --slack-lookback-days');
    const slackSince = new Date(
      Date.now() - slackLookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const existingIds = new Set(conversations.map((c) => `${c.channelId}_${c.messageTs}`));
    const backfill = await fetchSlackBackfill(token, { convSince: since, slackSince, existingIds });
    console.log(`Slack backfill: ${backfill.length} additional records`);
    conversations.push(...backfill);
  }

  const badFeedbackCount = conversations.filter((c) => c.hasBadFeedback).length;
  writeFileSync(path.resolve(outputPath), JSON.stringify(conversations, null, 2), 'utf8');

  console.log(`Total candidates: ${conversations.length}`);
  console.log(`Bad-feedback flagged: ${badFeedbackCount}`);
  console.log(`Output: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js tests/scripts/fetch-candidates.test.js
```

Expected: `Tests: 8 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/fiona-slack/scripts/fetch-candidates.js apps/fiona-slack/tests/scripts/fetch-candidates.test.js
git commit -m "feat(ai-152): add fetch-candidates.js with tests"
```

---

## Task 3: `select-candidates.js`

**Files:**
- Create: `apps/fiona-slack/scripts/select-candidates.js`
- Create: `apps/fiona-slack/tests/scripts/select-candidates.test.js`

**Interfaces:**
- Consumes: `formatCsv` from `format-candidates-csv.js` (Task 1)
- Consumes: `candidates-raw.json` produced by `fetch-candidates.js` (Task 2)
- Produces: `buildClassificationPrompt(candidates: object[]) → string`
- Produces: `classifyViaCli(prompt: string, opts?: { model?: string }) → object[]` — calls `claude` CLI via `spawnSync`, returns `[{ id, topic, clarity, isStandalone }]`
- Produces: `selectCandidates(classified: object[], rawMap: Map, count: number) → object[]`
- Produces: `main() → Promise<void>`

- [ ] **Step 1: Write failing tests**

Create `apps/fiona-slack/tests/scripts/select-candidates.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('node:child_process', () => ({
  spawnSync: jest.fn(),
}));

let spawnSync, buildClassificationPrompt, classifyViaCli, selectCandidates;

beforeEach(async () => {
  jest.resetModules();
  ({ spawnSync } = await import('node:child_process'));
  ({ buildClassificationPrompt, classifyViaCli, selectCandidates } = await import(
    '../../../scripts/select-candidates.js'
  ));
});

describe('buildClassificationPrompt', () => {
  it('includes all candidate IDs and userMessages', () => {
    const candidates = [
      { id: 'id1', userMessage: 'How do descriptors work?' },
      { id: 'id2', userMessage: 'What is OAuth?' },
    ];
    const prompt = buildClassificationPrompt(candidates);
    expect(prompt).toContain('id1');
    expect(prompt).toContain('How do descriptors work?');
    expect(prompt).toContain('id2');
    expect(prompt).toContain('What is OAuth?');
  });
});

describe('classifyViaCli', () => {
  it('returns structured_output from claude CLI JSON envelope', () => {
    const mockOutput = [{ id: 'id1', topic: 'Descriptors', clarity: 5, isStandalone: true }];
    spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ structured_output: mockOutput }),
      stderr: '',
      error: null,
    });

    const result = classifyViaCli('some prompt');
    expect(result).toEqual(mockOutput);
  });

  it('throws when claude CLI exits with non-zero status', () => {
    spawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'error: not authenticated',
      error: null,
    });

    expect(() => classifyViaCli('prompt')).toThrow('claude CLI failed');
  });

  it('throws when spawnSync returns an error (CLI not found)', () => {
    spawnSync.mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn claude ENOENT'),
    });

    expect(() => classifyViaCli('prompt')).toThrow();
  });

  it('passes --model flag to the claude CLI', () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ structured_output: [] }),
      stderr: '',
      error: null,
    });

    classifyViaCli('prompt', { model: 'sonnet' });
    const args = spawnSync.mock.calls[0][1];
    expect(args).toContain('sonnet');
  });
});

describe('selectCandidates', () => {
  const makeRaw = (id, overrides = {}) => ({
    id,
    hasBadFeedback: false,
    timestamp: '2026-07-01T00:00:00Z',
    ...overrides,
  });

  const makeClassified = (id, overrides = {}) => ({
    id,
    topic: 'Descriptors',
    clarity: 4,
    isStandalone: true,
    ...overrides,
  });

  it('fills up to floor(count * 0.3) slots from bad-feedback pool', () => {
    const ids = ['bf1', 'bf2', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];
    const rawMap = new Map(
      ids.map((id, i) => [id, makeRaw(id, { hasBadFeedback: i < 2, timestamp: `2026-07-0${i + 1}T00:00:00Z` })]),
    );
    const classified = ids.map((id, i) =>
      makeClassified(id, { topic: `Topic${i}`, ...(i < 2 ? {} : {}) }),
    );

    const selected = selectCandidates(classified, rawMap, 10);
    const badSelected = selected.filter((c) => rawMap.get(c.id)?.hasBadFeedback);
    expect(badSelected.length).toBe(Math.floor(10 * 0.3));
    expect(selected.length).toBe(10);
  });

  it('excludes bad-feedback candidates with clarity < 3 from Pool A', () => {
    const rawMap = new Map([
      ['bf_low', makeRaw('bf_low', { hasBadFeedback: true })],
      ...['r1', 'r2', 'r3', 'r4'].map((id) => [id, makeRaw(id)]),
    ]);
    const classified = [
      makeClassified('bf_low', { clarity: 2 }),
      ...['r1', 'r2', 'r3', 'r4'].map((id, i) => makeClassified(id, { topic: `T${i}` })),
    ];

    const selected = selectCandidates(classified, rawMap, 4);
    expect(selected.every((c) => c.id !== 'bf_low')).toBe(true);
  });

  it('distributes Pool B across different topics', () => {
    const rawMap = new Map(
      ['a1', 'b1', 'c1'].map((id) => [id, makeRaw(id)]),
    );
    const classified = [
      makeClassified('a1', { topic: 'Authorization Strategies' }),
      makeClassified('b1', { topic: 'Descriptors' }),
      makeClassified('c1', { topic: 'ODS/API Setup' }),
    ];

    const selected = selectCandidates(classified, rawMap, 3);
    const topics = new Set(selected.map((c) => c.topic));
    expect(topics.size).toBe(3);
  });

  it('prefers isStandalone:true over isStandalone:false at equal clarity', () => {
    const rawMap = new Map([
      ['ctx', makeRaw('ctx')],
      ['standalone', makeRaw('standalone')],
    ]);
    const classified = [
      makeClassified('ctx', { topic: 'Descriptors', clarity: 5, isStandalone: false }),
      makeClassified('standalone', { topic: 'Descriptors', clarity: 5, isStandalone: true }),
    ];

    const selected = selectCandidates(classified, rawMap, 1);
    expect(selected[0].id).toBe('standalone');
  });

  it('breaks ties by recency (more recent wins)', () => {
    const rawMap = new Map([
      ['old', makeRaw('old', { timestamp: '2026-06-01T00:00:00Z' })],
      ['new', makeRaw('new', { timestamp: '2026-07-01T00:00:00Z' })],
    ]);
    const classified = [
      makeClassified('old', { topic: 'Descriptors', clarity: 4 }),
      makeClassified('new', { topic: 'Descriptors', clarity: 4 }),
    ];

    const selected = selectCandidates(classified, rawMap, 1);
    expect(selected[0].id).toBe('new');
  });

  it('returns fewer than count when not enough candidates exist', () => {
    const rawMap = new Map([['only', makeRaw('only')]]);
    const classified = [makeClassified('only')];

    const selected = selectCandidates(classified, rawMap, 10);
    expect(selected.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js tests/scripts/select-candidates.test.js
```

Expected: `Cannot find module '../../../scripts/select-candidates.js'`

- [ ] **Step 3: Implement `select-candidates.js`**

Create `apps/fiona-slack/scripts/select-candidates.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadDotenvConfig } from 'dotenv';

const EDFI_CONCEPTS = [
  'Authorization Strategies', 'Descriptors', 'ODS/API Setup', 'Data Standard',
  'Student Data', 'Assessment Data', 'Finance Data', 'HR Data', 'Enrollment',
  'Calendars and Sessions', 'Grades and Transcripts', 'Interventions', 'Programs',
  'Staff and Personnel', 'LEA and School Administration', 'Ed-Fi Extensions',
  'API Security', 'Rate Limiting', 'Versioning', 'Performance', 'Data Migration',
  'Bulk Data Operations', 'Swagger/OpenAPI', 'Ed-Fi Alliance Standards',
  'ODS Platform Architecture', 'Reporting and Analytics', 'SIS Integration',
  'Vendor API Clients', 'Certification', 'State Reporting', 'Federal Reporting',
  'Ed-Fi Suite Deployment', 'Ed-Fi Cloud Deployment', 'Local Education Agencies',
  'Sample Data', 'Education Organizations', 'Learning Standards', 'Other',
];

const CLASSIFICATION_SYSTEM_PROMPT =
  `You classify Ed-Fi support questions. For each question return:\n` +
  `- id: echo unchanged\n` +
  `- topic: one of: ${EDFI_CONCEPTS.join(', ')}\n` +
  `- clarity: integer 1-5 (1=requires prior context to understand, 5=clear standalone question)\n` +
  `- isStandalone: false only if the question cannot be understood without reading prior messages\n` +
  `Return a JSON array with one object per input.`;

const CLASSIFICATION_SCHEMA = JSON.stringify({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      topic: { type: 'string' },
      clarity: { type: 'integer', minimum: 1, maximum: 5 },
      isStandalone: { type: 'boolean' },
    },
    required: ['id', 'topic', 'clarity', 'isStandalone'],
  },
});

export function buildClassificationPrompt(candidates) {
  const items = candidates.map((c) => ({ id: c.id, question: c.userMessage }));
  return `Classify each of these ${items.length} questions:\n\n${JSON.stringify(items, null, 2)}`;
}

export function classifyViaCli(prompt, { model = 'haiku' } = {}) {
  const result = spawnSync(
    'claude',
    ['-p', '--output-format', 'json', '--json-schema', CLASSIFICATION_SCHEMA,
      '--system-prompt', CLASSIFICATION_SYSTEM_PROMPT, '--model', model, prompt],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`claude CLI failed: ${result.stderr}`);

  return JSON.parse(result.stdout).structured_output;
}

async function classifyViaApi(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set and claude CLI not available');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: CLASSIFICATION_SYSTEM_PROMPT + '\n\nRespond with ONLY a valid JSON array, no markdown.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return JSON.parse(data.content[0].text);
}

export function selectCandidates(classified, rawMap, count) {
  const badFeedbackSlots = Math.floor(count * 0.3);

  const poolA = classified
    .filter((c) => rawMap.get(c.id)?.hasBadFeedback && c.clarity >= 3)
    .sort((a, b) => b.clarity - a.clarity)
    .slice(0, badFeedbackSlots);

  const poolAIds = new Set(poolA.map((c) => c.id));
  const remaining = classified.filter((c) => !poolAIds.has(c.id));

  const byTopic = new Map();
  for (const c of remaining) {
    const key = c.topic || 'Other';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(c);
  }

  for (const arr of byTopic.values()) {
    arr.sort((a, b) => {
      if (a.isStandalone !== b.isStandalone) return a.isStandalone ? -1 : 1;
      if (b.clarity !== a.clarity) return b.clarity - a.clarity;
      const tsA = rawMap.get(a.id)?.timestamp ?? '';
      const tsB = rawMap.get(b.id)?.timestamp ?? '';
      return tsB.localeCompare(tsA);
    });
  }

  const sortedTopics = [...byTopic.keys()].sort();
  const poolB = [];
  const needed = count - poolA.length;
  let round = 0;

  while (poolB.length < needed) {
    let added = false;
    for (const topic of sortedTopics) {
      const arr = byTopic.get(topic);
      if (round < arr.length) {
        poolB.push(arr[round]);
        added = true;
        if (poolB.length >= needed) break;
      }
    }
    round++;
    if (!added) break;
  }

  return [...poolA, ...poolB];
}

function getArg(name, fallback = undefined) {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  const token = process.argv[idx];
  if (token.includes('=')) return token.split('=').slice(1).join('=');
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

function loadDotenv() {
  const envFile = getArg('env-file');
  if (envFile) {
    loadDotenvConfig({ path: path.resolve(process.cwd(), envFile) });
    return;
  }
  loadDotenvConfig();
  loadDotenvConfig({ path: path.resolve(import.meta.dirname, '..', '.env') });
}

export async function main() {
  loadDotenv();

  const inputPath = getArg('input', 'candidates-raw.json');
  const count = Number(getArg('count', 20));
  const outputPath = getArg('output', 'cycle-candidates.csv');
  const model = getArg('model', 'haiku');
  const classifiedPath = outputPath.replace(/\.csv$/, '-classified.json');

  const raw = JSON.parse(readFileSync(path.resolve(inputPath), 'utf8'));
  console.log(`Loaded ${raw.length} raw candidates`);

  const prompt = buildClassificationPrompt(raw);

  let classifications;
  try {
    classifications = classifyViaCli(prompt, { model });
    console.log(`Classified ${classifications.length} candidates via claude CLI`);
  } catch (cliErr) {
    console.warn(`claude CLI unavailable (${cliErr.message}), falling back to API`);
    classifications = await classifyViaApi(prompt);
    console.log(`Classified ${classifications.length} candidates via Anthropic API`);
  }

  const rawMap = new Map(raw.map((c) => [c.id, c]));

  // Merge classification results back onto raw records
  const classifiedMap = new Map(classifications.map((c) => [c.id, c]));
  const merged = raw.map((r) => ({ ...r, ...classifiedMap.get(r.id) }));

  const selected = selectCandidates(merged, rawMap, count);
  const selectedIds = new Set(selected.map((c) => c.id));

  const output = merged.map((c) => ({ ...c, selected: selectedIds.has(c.id) }));
  writeFileSync(path.resolve(classifiedPath), JSON.stringify(output, null, 2), 'utf8');

  // Write CSV via format-candidates-csv
  const { formatCsv } = await import('./format-candidates-csv.js');
  const { writeFileSync: wf } = await import('node:fs');
  wf(path.resolve(outputPath), formatCsv(output), 'utf8');

  const badFeedbackSelected = selected.filter((c) => rawMap.get(c.id)?.hasBadFeedback).length;
  const topicCounts = selected.reduce((acc, c) => {
    acc[c.topic ?? 'Other'] = (acc[c.topic ?? 'Other'] || 0) + 1;
    return acc;
  }, {});

  console.log(`\nSelected ${selected.length} / ${count} requested`);
  console.log(`Bad-feedback slots: ${badFeedbackSelected}`);
  console.log('Topics:', Object.entries(topicCounts).map(([t, n]) => `${t} (${n})`).join(', '));
  console.log(`Classified JSON: ${classifiedPath}`);
  console.log(`CSV: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js tests/scripts/select-candidates.test.js
```

Expected: `Tests: 10 passed`

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js
```

Expected: all existing tests plus the new 27 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/fiona-slack/scripts/select-candidates.js apps/fiona-slack/tests/scripts/select-candidates.test.js
git commit -m "feat(ai-152): add select-candidates.js with classification and stratified selection"
```

---

## Task 4: Agent Wrapper and CLAUDE.md Entry

**Files:**
- Create: `.github/agents/sme-candidate-selector.agent.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create the agent file**

Create `.github/agents/sme-candidate-selector.agent.md`:

```markdown
---
name: sme-candidate-selector
description: "Use when selecting SME review candidates for Fiona evaluation cycles.
  Fetches conversations from Cosmos DB and Slack, classifies topics via Claude,
  and produces a stratified CSV ready for Slack List import."
argument-hint: "Describe the cycle request, e.g. 'Select 20 candidates for cycle 1
  from the last 30 days' or 'Refresh with Slack backfill going back 90 days'"
tools: [execute, read, search]
---

You are the SME candidate selector for Fiona evaluation cycles.

## Scope

Select 15–20 representative Fiona conversations from Cosmos DB to populate a Slack List for SME quality review. You fetch raw candidates deterministically, classify topics inline (you are Claude — no subprocess needed), apply stratified selection, and produce a CSV ready for Slack List import.

## Ground Rules

1. Always use `--deployment-type=production`. Never include `local` or `insiders` records.
2. Default to `--days=30` unless the user specifies otherwise.
3. Re-run `fetch-candidates.js` fresh each invocation. Do not reuse a stale `candidates-raw.json` unless `--skip-fetch` is explicitly requested by the operator.
4. Never post to Slack or import to the Slack List — output is a local CSV file only.
5. If Cosmos credentials are missing, report exactly which env vars are needed before attempting any queries.
6. After fetching, pause and report: total raw candidates, bad-feedback count, date range. If raw count < (requested count × 1.5), warn before proceeding.

## Execution Pattern

### Step 1 — Parse the request

Extract:
- `days` (default: 30)
- `count` (default: 20)
- `outputFile` (default: `cycle-candidates.csv`)
- Any topic preferences, bad-feedback-only filters, or Slack backfill request (`--slack-lookback-days`)

### Step 2 — Fetch raw candidates

Run from `apps/fiona-slack/`:
```
node scripts/fetch-candidates.js --days=<days> --deployment-type=production --output=candidates-raw.json
```

Read `candidates-raw.json`. Report: total count, bad-feedback count, date range, source breakdown (cosmos vs slack).

Pause if total < count × 1.5 and ask whether to proceed or adjust parameters.

### Step 3 — Classify candidates inline

For each candidate in `candidates-raw.json`, determine:
- `topic`: one of the 38 canonical Ed-Fi concepts below, or "Other"
- `clarity`: 1–5 (1 = requires prior context to understand, 5 = clear standalone question)
- `isStandalone`: false only if the question cannot be understood without reading prior messages

**38 canonical Ed-Fi concepts:**
Authorization Strategies, Descriptors, ODS/API Setup, Data Standard, Student Data, Assessment Data, Finance Data, HR Data, Enrollment, Calendars and Sessions, Grades and Transcripts, Interventions, Programs, Staff and Personnel, LEA and School Administration, Ed-Fi Extensions, API Security, Rate Limiting, Versioning, Performance, Data Migration, Bulk Data Operations, Swagger/OpenAPI, Ed-Fi Alliance Standards, ODS Platform Architecture, Reporting and Analytics, SIS Integration, Vendor API Clients, Certification, State Reporting, Federal Reporting, Ed-Fi Suite Deployment, Ed-Fi Cloud Deployment, Local Education Agencies, Sample Data, Education Organizations, Learning Standards, Other

### Step 4 — Apply stratified selection

1. **Pool A (bad-feedback priority):** `hasBadFeedback: true` AND `clarity >= 3`, sorted by clarity descending. Fill up to `floor(count × 0.3)` slots.
2. **Pool B (topic distribution):** fill remaining slots by cycling through topics alphabetically, picking the highest-clarity record per topic per round. Within equal clarity, prefer `isStandalone: true`, then most recent `timestamp`.
3. Mark selected records `"selected": true`.

### Step 5 — Write output

Write `candidates-classified.json` with all candidates + classification fields + `selected` flag.

Run:
```
node scripts/format-candidates-csv.js --input=candidates-classified.json --output=<outputFile>
```

### Step 6 — Report results

Print:
- Selected count vs requested
- Bad-feedback slots filled
- Topic distribution table
- Any topics with zero coverage (warn)
- Output file path

## CSV Output Columns

User question, Fiona response, Thread link, Sources (newline-joined URLs), Topic, Bad feedback, Assigned SME (empty), Accuracy score (empty), Helpfulness score (empty), Correction needed (empty), Corrected response (empty), Gap category (empty), Notes (empty), Status (Pending).
```

- [ ] **Step 2: Add CLAUDE.md entry**

Append to `CLAUDE.md`:

```markdown

## SME Candidate Selection

To select conversation candidates for SME evaluation cycles, use the `sme-candidate-selector` agent:

```
/agent sme-candidate-selector "Select 20 candidates for cycle 1, last 30 days"
```

See `.github/agents/sme-candidate-selector.agent.md` for full options and ground rules.
```

- [ ] **Step 3: Smoke test — verify agent file is discoverable**

From the `ai-152-sme-review` worktree root:

```bash
claude --agent sme-candidate-selector --print "How many candidates would you fetch with default settings?" 2>&1 | head -5
```

Expected: agent responds describing 20 candidates from last 30 days of production data (no errors about missing agent file).

- [ ] **Step 4: Commit**

```bash
git add .github/agents/sme-candidate-selector.agent.md CLAUDE.md
git commit -m "feat(ai-152): add sme-candidate-selector agent and CLAUDE.md entry"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| `fetch-candidates.js` — Cosmos conversations query | Task 2 `fetchConversations` |
| `fetch-candidates.js` — feedback join | Task 2 `joinFeedback` |
| `fetch-candidates.js` — Slack URL construction | Task 2 `buildSlackUrl` |
| `fetch-candidates.js` — Slack backfill (optional) | Task 2 `fetchSlackBackfill` |
| `fetch-candidates.js` — `candidates-raw.json` schema | Task 2 output shape |
| `format-candidates-csv.js` — all 14 CSV columns | Task 1 `COLUMNS` array |
| `format-candidates-csv.js` — Sources added vs Slack List | Task 1 (Sources column) |
| `format-candidates-csv.js` — Topic added vs Slack List | Task 1 (Topic column) |
| `format-candidates-csv.js` — Bad feedback added vs Slack List | Task 1 (Bad feedback column) |
| `select-candidates.js` — `claude` CLI via `spawnSync` | Task 3 `classifyViaCli` |
| `select-candidates.js` — `ANTHROPIC_API_KEY` fallback | Task 3 `classifyViaApi` |
| `select-candidates.js` — batched classification prompt | Task 3 `buildClassificationPrompt` |
| `select-candidates.js` — Pool A bad-feedback 30% | Task 3 `selectCandidates` |
| `select-candidates.js` — Pool B topic cycling | Task 3 `selectCandidates` |
| `select-candidates.js` — isStandalone tie-breaking | Task 3 `selectCandidates` |
| `select-candidates.js` — recency tie-breaking | Task 3 `selectCandidates` |
| Agent wrapper — `.github/agents/` file | Task 4 |
| Agent wrapper — CLAUDE.md discoverability entry | Task 4 |
| Agent wrapper — inline classification (no subprocess) | Task 4 agent body |
| Agent wrapper — ground rules (production only, no Slack post) | Task 4 agent body |
