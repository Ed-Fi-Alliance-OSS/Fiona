# `/fiona escalate` (AI-122) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/fiona escalate` slash command that posts a summarized escalation (with transcript) to a configured Slack channel, pings an on-call user group, records the event to both Cosmos containers, and confirms to the user — extracting a reusable `postEscalation` helper for the downstream proactive-escalation story.

**Architecture:** A shared `postEscalation()` helper in `src/agent/escalation.js` performs the channel post + analytics. The slash sub-command in `src/listeners/commands/fiona.js` handles rate limiting, DM detection, and the ephemeral confirmation, delegating the post to `postEscalation`. A new non-streaming `summarizeForEscalation()` in `llm-caller.js` produces the summary; `recordFeedback()` gains an optional `interactionType` so the feedback container can carry `slash_escalate`.

**Tech Stack:** Node.js 22 (ESM), Slack Bolt 4, OpenAI SDK (Perplexity-compatible), Azure Cosmos SDK, Jest 29 with `jest.unstable_mockModule`, Biome.

## Global Constraints

- **Runtime:** Node.js 22+, ES modules (`"type": "module"`); use `import`/`export`, never `require`.
- **License header:** every **new** `.js` file starts with the 4-line Apache-2.0 header (see any existing `src/**/*.js`).
- **Tests:** Jest via `npm test` from `apps/fiona-slack`; ESM mocks use `jest.unstable_mockModule(path, factory)` **before** `await import(...)` of the module under test.
- **Lint:** `npm run lint` (Biome) must pass; `npm run lint:fix` to autofix.
- **Commits:** conventional-commit style; **every commit message ends with the trailer** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (shown in each commit step). Work is on branch `AI-122`.
- **Verbatim user-facing copy (AI-122):**
  - Channel confirmation: `✅ Your conversation has been escalated to #escalation. A team member will follow up shortly.`
  - DM confirmation: `✅ A team member will follow up shortly.`
- **Env var (AI-122):** `ESCALATION_CHANNEL` — the destination, **value is a channel ID** (e.g. `C0123456789`). Enhancement var: `ESCALATION_USERGROUP_ID` (e.g. `S0123456789`), optional; omit the ping when unset.
- **Cosmos:** record `interactionType: 'slash_escalate'` to **both** the `interactions` and `feedback` containers; all Cosmos writes are best-effort (never block or fail the user path).
- **No regressions:** the existing `tests/listeners/commands/fiona.test.js` guard (llm-caller must not be statically reachable) is preserved by mocking `escalation.js` in that test (Task 4).

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/agent/llm-caller.js` (modify) | add `summarizeForEscalation(transcriptText, logger)` — non-streaming summary | 1 |
| `src/agent/feedback-store.js` (modify) | add optional `interactionType` to `recordFeedback` doc | 2 |
| `src/agent/escalation.js` (create) | `postEscalation({...})` shared helper + internal transcript builder | 3 |
| `src/listeners/commands/fiona.js` (modify) | `escalate` sub-command: rate limit, DM detection, delegate, confirm | 4 |
| `tests/listeners/commands/fiona.test.js` (modify) | mock `escalation.js`; add escalate tests | 4 |
| `apps/fiona-slack/.env.sample`, `manifest.json`, `infra/fiona-slack-container/main.bicep`, `docs/fiona-skills-prd.md` (modify) | config + docs wiring | 5 |

Tasks are ordered so each only consumes interfaces produced by earlier tasks.

---

## Task 1: `summarizeForEscalation()` in llm-caller.js

**Files:**
- Modify: `src/agent/llm-caller.js`
- Test: `tests/agent/llm-caller.summarize.test.js` (create)

**Interfaces:**
- Produces: `summarizeForEscalation(transcriptText: string, logger?) => Promise<string | null>` — a 2–4 sentence summary, or `null` when the LLM is unconfigured, the input is empty, or the call fails.

- [ ] **Step 1: Write the failing test**

Create `tests/agent/llm-caller.summarize.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreate = jest.fn();
jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';
const { summarizeForEscalation } = await import('../../src/agent/llm-caller.js');

describe('summarizeForEscalation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the trimmed model summary on success', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '  User wants SIS help.  ' } }] });
    const result = await summarizeForEscalation('*<@U1>:* help with SIS');
    expect(result).toBe('User wants SIS help.');
  });

  it('returns null for empty transcript without calling the LLM', async () => {
    const result = await summarizeForEscalation('   ');
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null and warns when the LLM call throws', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const logger = { warn: jest.fn() };
    const result = await summarizeForEscalation('*<@U1>:* hi', logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('escalation summary'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/fiona-slack && npm test -- llm-caller.summarize`
Expected: FAIL — `summarizeForEscalation is not a function`.

- [ ] **Step 3: Add the implementation**

In `src/agent/llm-caller.js`, after the `callLLM` export, add:

```javascript
// ─── Escalation Summary ─────────────────────────────────────────────────────
const ESCALATION_SUMMARY_SYSTEM_PROMPT =
  'You summarize a Slack conversation between a user and Fiona (an Ed-Fi AI assistant) for a human support team. ' +
  'In 2-4 sentences, state what the user is trying to do and where they got stuck. ' +
  'Be factual and concise. Do not add greetings or sign-offs.';

/**
 * Produce a short human-readable summary of a conversation transcript for an
 * escalation post. Non-streaming. Returns null when the LLM is unconfigured,
 * the transcript is empty, or the call fails — callers degrade to transcript-only.
 *
 * @param {string} transcriptText
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<string | null>}
 */
export async function summarizeForEscalation(transcriptText, logger) {
  if (!perplexityClient) return null;
  if (!transcriptText || !transcriptText.trim()) return null;

  try {
    const response = await perplexityClient.chat.completions.create({
      model: PERPLEXITY_API_MODEL,
      messages: [
        { role: 'system', content: ESCALATION_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: transcriptText },
      ],
      stream: false,
    });
    const summary = response?.choices?.[0]?.message?.content;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
  } catch (error) {
    logger?.warn?.(`Failed to generate escalation summary: ${error.message}`);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/fiona-slack && npm test -- llm-caller.summarize`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint and commit**

```bash
cd apps/fiona-slack && npm run lint
git add apps/fiona-slack/src/agent/llm-caller.js apps/fiona-slack/tests/agent/llm-caller.summarize.test.js
git commit -m "$(cat <<'EOF'
feat(AI-122): add summarizeForEscalation helper

Non-streaming Perplexity call that summarizes a conversation transcript
for escalation posts. Returns null on empty input, missing client, or
error so callers can degrade to transcript-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: optional `interactionType` on `recordFeedback`

So the `feedback` container row for an escalation can carry `interactionType: 'slash_escalate'` (AI-122 AC #7), without affecting normal thumbs feedback rows.

**Files:**
- Modify: `src/agent/feedback-store.js:140-167`
- Test: `tests/agent/feedback-store-cosmos.test.js` (add cases)

**Interfaces:**
- Produces: `recordFeedback({ ..., interactionType?: string })` — when `interactionType` is a non-empty string it is included on the persisted doc; otherwise the doc shape is unchanged.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('recordFeedback - with connection string', ...)` block in `tests/agent/feedback-store-cosmos.test.js`:

```javascript
  it('includes interactionType on the doc when provided', async () => {
    await recordFeedback({
      userId: 'U900',
      channelId: 'C900',
      messageTs: 'trigger-xyz',
      value: 'escalation',
      interactionType: 'slash_escalate',
      userMessage: 'transcript here',
      botResponse: 'summary here',
    });
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.interactionType).toBe('slash_escalate');
    expect(doc.value).toBe('escalation');
  });

  it('omits interactionType from the doc when not provided', async () => {
    await recordFeedback({
      userId: 'U901',
      channelId: 'C901',
      messageTs: '1234567890.000099',
      value: 'good-feedback',
      userMessage: null,
      botResponse: null,
    });
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc).not.toHaveProperty('interactionType');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/fiona-slack && npm test -- feedback-store-cosmos`
Expected: FAIL — first new test sees `doc.interactionType` is `undefined`.

- [ ] **Step 3: Add the parameter and conditional field**

In `src/agent/feedback-store.js`, add `interactionType` to the destructured params of `recordFeedback`:

```javascript
export async function recordFeedback({
  userId,
  channelId,
  messageTs,
  value,
  reason,
  userMessage,
  botResponse,
  interactionType,
  logger,
}) {
```

Then in the `doc` object, add the conditional field immediately after `botResponse,`:

```javascript
    userMessage,
    botResponse,
    ...(interactionType ? { interactionType } : {}),
    deploymentType: process.env.DEPLOYMENT_TYPE || 'local',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/fiona-slack && npm test -- feedback-store-cosmos`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Lint and commit**

```bash
cd apps/fiona-slack && npm run lint
git add apps/fiona-slack/src/agent/feedback-store.js apps/fiona-slack/tests/agent/feedback-store-cosmos.test.js
git commit -m "$(cat <<'EOF'
feat(AI-122): allow optional interactionType on feedback records

Lets escalation events be recorded to the feedback container tagged with
interactionType (e.g. slash_escalate) without changing normal feedback rows.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `postEscalation()` shared helper — `src/agent/escalation.js`

**Files:**
- Create: `src/agent/escalation.js`
- Test: `tests/agent/escalation.test.js` (create)

**Interfaces:**
- Consumes: `getUser` (Task pre-existing), `recordInteraction`, `recordFeedback` (Task 2), `summarizeForEscalation` (Task 1).
- Produces:
  `postEscalation({ client, userId, teamId, channelId, threadTs?, messageTs, source, isDm?, logger }) => Promise<{ ok: boolean, errorType: string | null }>`
  - `source`: `'slash_escalate'` | `'auto_escalation'`. `errorType`: `'channel_not_configured'` | `'post_failed'` | `null`.
  - Posts to `process.env.ESCALATION_CHANNEL`; pings `process.env.ESCALATION_USERGROUP_ID` when set; posts the transcript as a threaded reply; records to both Cosmos containers (best-effort).

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/escalation.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetUser = jest.fn();
const mockRecordInteraction = jest.fn().mockResolvedValue(undefined);
const mockRecordFeedback = jest.fn().mockResolvedValue(undefined);
const mockSummarize = jest.fn();

jest.unstable_mockModule('../../src/agent/slack-users-store.js', () => ({ getUser: mockGetUser }));
jest.unstable_mockModule('../../src/agent/interaction-store.js', () => ({ recordInteraction: mockRecordInteraction }));
jest.unstable_mockModule('../../src/agent/feedback-store.js', () => ({ recordFeedback: mockRecordFeedback }));
jest.unstable_mockModule('../../src/agent/llm-caller.js', () => ({ summarizeForEscalation: mockSummarize }));

const { postEscalation } = await import('../../src/agent/escalation.js');

function makeClient() {
  return {
    conversations: {
      replies: jest.fn().mockResolvedValue({ messages: [
        { user: 'U1', text: 'I need help with the ODS' },
        { bot_id: 'B1', text: 'Here is some info' },
      ] }),
      history: jest.fn().mockResolvedValue({ messages: [
        { bot_id: 'B1', text: 'reply two' },
        { user: 'U1', text: 'message one' },
      ] }),
    },
    chat: {
      postMessage: jest.fn().mockResolvedValue({ ts: '111.222' }),
      getPermalink: jest.fn().mockResolvedValue({ permalink: 'https://slack.test/p1' }),
    },
  };
}

const baseArgs = () => ({
  client: makeClient(),
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '999.000',
  messageTs: '999.000',
  source: 'slash_escalate',
  logger: { warn: jest.fn(), error: jest.fn() },
});

describe('postEscalation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ESCALATION_CHANNEL = 'C_ESCALATE';
    delete process.env.ESCALATION_USERGROUP_ID;
    mockGetUser.mockResolvedValue({ displayName: 'Ada Lovelace' });
    mockSummarize.mockResolvedValue('User is stuck configuring the ODS.');
  });

  it('returns channel_not_configured when ESCALATION_CHANNEL is unset', async () => {
    delete process.env.ESCALATION_CHANNEL;
    const result = await postEscalation(baseArgs());
    expect(result).toEqual({ ok: false, errorType: 'channel_not_configured' });
  });

  it('posts to the configured channel with the display name and a thread link', async () => {
    const args = baseArgs();
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    const post = args.client.chat.postMessage.mock.calls[0][0];
    expect(post.channel).toBe('C_ESCALATE');
    const text = JSON.stringify(post.blocks);
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('https://slack.test/p1');
  });

  it('pings the user group when ESCALATION_USERGROUP_ID is set', async () => {
    process.env.ESCALATION_USERGROUP_ID = 'S123';
    const args = baseArgs();
    await postEscalation(args);
    const post = args.client.chat.postMessage.mock.calls[0][0];
    expect(JSON.stringify(post.blocks)).toContain('<!subteam^S123>');
  });

  it('records to both the interactions and feedback containers', async () => {
    await postEscalation(baseArgs());
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'slash_escalate', status: 'success' }),
    );
    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'slash_escalate', value: 'escalation' }),
    );
  });

  it('posts the transcript as a threaded reply to the escalation message', async () => {
    const args = baseArgs();
    await postEscalation(args);
    const replyCall = args.client.chat.postMessage.mock.calls.find((c) => c[0].thread_ts === '111.222');
    expect(replyCall).toBeDefined();
  });

  it('still posts (transcript-only) when the summary fails', async () => {
    mockSummarize.mockResolvedValue(null);
    const args = baseArgs();
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    expect(args.client.chat.postMessage).toHaveBeenCalled();
  });

  it('returns post_failed when chat.postMessage throws', async () => {
    const args = baseArgs();
    args.client.chat.postMessage.mockRejectedValueOnce(new Error('not_in_channel'));
    const result = await postEscalation(args);
    expect(result).toEqual({ ok: false, errorType: 'post_failed' });
  });

  it('skips the permalink lookup for DM escalations', async () => {
    const args = { ...baseArgs(), isDm: true, threadTs: null };
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    expect(args.client.chat.getPermalink).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/fiona-slack && npm test -- escalation.test`
Expected: FAIL — cannot resolve `../../src/agent/escalation.js`.

- [ ] **Step 3: Create the implementation**

Create `src/agent/escalation.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordFeedback } from './feedback-store.js';
import { recordInteraction } from './interaction-store.js';
import { summarizeForEscalation } from './llm-caller.js';
import { getUser } from './slack-users-store.js';

const HISTORY_LIMIT = 20;
const SLACK_BLOCK_TEXT_LIMIT = 2900; // leave headroom under Slack's 3000-char section limit

/**
 * Build a plain-text transcript of the recent conversation. Uses thread replies
 * when a threadTs is available, otherwise the channel's recent history.
 *
 * @returns {Promise<string>} Newline-joined "*Who:* text" lines, or '' on failure.
 */
async function fetchTranscript(client, { channelId, threadTs, logger }) {
  try {
    let messages;
    if (threadTs) {
      const res = await client.conversations.replies({ channel: channelId, ts: threadTs, limit: 50 });
      messages = res.messages ?? [];
    } else {
      const res = await client.conversations.history({ channel: channelId, limit: HISTORY_LIMIT });
      messages = (res.messages ?? []).reverse(); // history returns newest-first
    }
    return messages
      .filter((m) => m.text)
      .map((m) => {
        const who = m.bot_id ? 'Fiona' : m.user ? `<@${m.user}>` : 'User';
        const text = (m.text ?? '').replace(/^(<@[A-Z0-9]+>\s*)+/, '').trim();
        return text ? `*${who}:* ${text}` : null;
      })
      .filter(Boolean)
      .join('\n');
  } catch (err) {
    logger?.warn?.(`Failed to fetch transcript for escalation: ${err.message}`);
    return '';
  }
}

/**
 * Post an escalation to the configured channel and record it. Shared by the
 * /fiona escalate slash command and the proactive escalation flow.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.userId
 * @param {string} [params.teamId]
 * @param {string} params.channelId
 * @param {string|null} [params.threadTs]
 * @param {string} params.messageTs
 * @param {'slash_escalate'|'auto_escalation'} params.source
 * @param {boolean} [params.isDm]
 * @param {import("@slack/logger").Logger} [params.logger]
 * @returns {Promise<{ ok: boolean, errorType: string|null }>}
 */
export async function postEscalation({
  client,
  userId,
  teamId,
  channelId,
  threadTs = null,
  messageTs,
  source,
  isDm = false,
  logger,
}) {
  const targetChannel = process.env.ESCALATION_CHANNEL;
  if (!targetChannel) {
    logger?.warn?.('ESCALATION_CHANNEL is not configured; cannot post escalation.');
    return { ok: false, errorType: 'channel_not_configured' };
  }

  const user = await getUser(userId, logger);
  const displayName = user?.displayName || user?.realName || user?.name || `<@${userId}>`;

  const transcript = await fetchTranscript(client, { channelId, threadTs, logger });
  const summary = await summarizeForEscalation(transcript, logger);

  let permalink = null;
  if (!isDm) {
    try {
      const res = await client.chat.getPermalink({ channel: channelId, message_ts: threadTs ?? messageTs });
      permalink = res?.permalink ?? null;
    } catch (err) {
      logger?.warn?.(`Failed to get permalink for escalation: ${err.message}`);
    }
  }

  const usergroupId = process.env.ESCALATION_USERGROUP_ID;
  const mention = usergroupId ? `<!subteam^${usergroupId}> ` : '';
  const locationLink = permalink ? `<${permalink}|View conversation>` : `<#${channelId}>`;

  const headerLines = [
    `${mention}:rotating_light: *Escalation requested* by *${displayName}*`,
    `*Where:* ${locationLink}`,
    `*When:* ${new Date().toISOString()}`,
  ];
  if (summary) headerLines.push(`*Summary:* ${summary}`);

  let postedTs = null;
  try {
    const res = await client.chat.postMessage({
      channel: targetChannel,
      text: `Escalation requested by ${displayName}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: headerLines.join('\n') } }],
    });
    postedTs = res?.ts ?? null;
  } catch (err) {
    logger?.error?.(`Failed to post escalation to ${targetChannel}: ${err.message}`);
    return { ok: false, errorType: 'post_failed' };
  }

  if (transcript && postedTs) {
    try {
      await client.chat.postMessage({
        channel: targetChannel,
        thread_ts: postedTs,
        text: 'Conversation transcript',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Transcript:*\n${transcript}`.slice(0, SLACK_BLOCK_TEXT_LIMIT) },
          },
        ],
      });
    } catch (err) {
      logger?.warn?.(`Failed to post escalation transcript: ${err.message}`);
    }
  }

  recordInteraction({
    userId,
    teamId,
    channelId,
    threadTs: threadTs ?? messageTs,
    messageTs,
    interactionType: source,
    status: 'success',
    errorType: null,
    rateLimited: false,
    logger,
  }).catch((e) => logger?.warn?.(`Failed to record escalation interaction: ${e.message}`));

  recordFeedback({
    userId,
    channelId,
    messageTs,
    value: 'escalation',
    interactionType: source,
    reason: null,
    userMessage: transcript || null,
    botResponse: summary || null,
    logger,
  }).catch((e) => logger?.warn?.(`Failed to record escalation feedback: ${e.message}`));

  return { ok: true, errorType: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/fiona-slack && npm test -- escalation.test`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and commit**

```bash
cd apps/fiona-slack && npm run lint
git add apps/fiona-slack/src/agent/escalation.js apps/fiona-slack/tests/agent/escalation.test.js
git commit -m "$(cat <<'EOF'
feat(AI-122): add shared postEscalation helper

Builds a summarized escalation message with transcript, posts it to the
configured channel (pinging an optional user group), and records the event
to both the interactions and feedback containers. Reused by the proactive
escalation story.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `/fiona escalate` sub-command — `src/listeners/commands/fiona.js`

**Files:**
- Modify: `src/listeners/commands/fiona.js`
- Test: `tests/listeners/commands/fiona.test.js` (add escalation mock + escalate suite)

**Interfaces:**
- Consumes: `postEscalation` (Task 3), `checkRateLimit` (pre-existing), `recordInteraction` (pre-existing).
- Produces: a new `case 'escalate'` in the dispatcher that calls `handleEscalate({ command, ack, respond, client, logger })`.

> **Why the test changes:** `fiona.js` now statically imports `escalation.js`, which imports `llm-caller.js`. The existing test mocks `llm-caller` to throw on import. Mocking `escalation.js` in the test prevents the real (llm-caller-importing) module from loading, so that guard never fires and existing tests stay green.

- [ ] **Step 1: Update the dispatcher and add the handler**

In `src/listeners/commands/fiona.js`, add imports near the top (after the existing `recordInteraction` import):

```javascript
import { checkRateLimit } from '../../agent/rate-limiter.js';
import { postEscalation } from '../../agent/escalation.js';
```

Add the copy constants near the other `*_TEXT` constants:

```javascript
const ESCALATE_CONFIRM_TEXT =
  '✅ Your conversation has been escalated to #escalation. A team member will follow up shortly.';
const ESCALATE_DM_TEXT = '✅ A team member will follow up shortly.';
const ESCALATE_ERROR_TEXT =
  ':warning: Sorry, I could not escalate your conversation right now. Please reach out to the team directly.';
```

Change the dispatcher signature and add the `escalate` case:

```javascript
export const fionaCommandCallback = async ({ command, ack, respond, client, logger }) => {
  logger?.info?.(`/fiona slash command invoked: ${command.text ?? '(empty)'}`);
  const subCommand = (command.text ?? '').trim().split(/\s+/)[0].toLowerCase();

  switch (subCommand) {
    case 'help':
    case '':
      await handleHelp({ command, ack, logger });
      break;
    case 'ask':
      await handleComingSoon({ command, ack, logger, subCommand: 'ask', text: ASK_NOT_YET_TEXT });
      break;
    case 'search':
      await handleComingSoon({ command, ack, logger, subCommand: 'search', text: SEARCH_NOT_YET_TEXT });
      break;
    case 'escalate':
      await handleEscalate({ command, ack, respond, client, logger });
      break;
    default:
      await handleUnknown({ command, ack, logger, subCommand });
      break;
  }
};
```

Add the handler and a DM helper at the end of the file:

```javascript
function isDmChannel(command) {
  return command.channel_name === 'directmessage' || (command.channel_id || '').startsWith('D');
}

async function handleEscalate({ command, ack, respond, client, logger }) {
  try {
    await ack();
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona escalate: ${err.name}`);
    return;
  }

  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping escalate');
    return;
  }

  const { allowed, retryAfterMs } = checkRateLimit(command.user_id);
  if (!allowed) {
    const minutes = Math.ceil(retryAfterMs / 60000);
    await respond({
      response_type: 'ephemeral',
      text: `:no_entry: You've reached the request limit. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`,
    });
    recordInteraction({
      ...slashInteractionRecord(command, 'slash_escalate'),
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_escalate interaction: ${err.name}`));
    return;
  }

  const dm = isDmChannel(command);
  const result = await postEscalation({
    client,
    userId: command.user_id,
    teamId: command.team_id,
    channelId: command.channel_id,
    threadTs: null,
    messageTs: command.trigger_id,
    source: 'slash_escalate',
    isDm: dm,
    logger,
  });

  if (result.ok) {
    await respond({ response_type: 'ephemeral', text: dm ? ESCALATE_DM_TEXT : ESCALATE_CONFIRM_TEXT });
  } else {
    await respond({ response_type: 'ephemeral', text: ESCALATE_ERROR_TEXT });
    recordInteraction({
      ...slashInteractionRecord(command, 'slash_escalate'),
      status: 'error',
      errorType: result.errorType,
      rateLimited: false,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_escalate interaction: ${err.name}`));
  }
}
```

> Note: `slashInteractionRecord(command, type)` already returns `status: 'success'`; the spread is overridden by the explicit `status`/`errorType`/`rateLimited` that follow it. On success, `postEscalation` itself records the interaction, so `handleEscalate` does not re-record.

Also update the JSDoc `interactionType` enum in `src/agent/interaction-store.js:139` to include the new values (documentation only):

```javascript
 * @param {string} interaction.interactionType - 'app_mention', 'assistant_message', 'slash_help', 'slash_ask', 'slash_search', 'slash_escalate', 'auto_escalation', or 'slash_unknown'
```

- [ ] **Step 2: Update the test file's mocks**

In `tests/listeners/commands/fiona.test.js`, add an `escalation.js` mock alongside the existing mocks (after the `llm-caller` mock, before the `await import`):

```javascript
const mockPostEscalation = jest.fn().mockResolvedValue({ ok: true, errorType: null });
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({
  postEscalation: mockPostEscalation,
}));
```

- [ ] **Step 3: Run the existing suite to confirm no regression**

Run: `cd apps/fiona-slack && npm test -- listeners/commands/fiona`
Expected: PASS — all existing tests still green (the `escalation.js` mock keeps `llm-caller` from loading).

- [ ] **Step 4: Write the failing escalate tests**

Append a new `describe` block in `tests/listeners/commands/fiona.test.js`:

```javascript
describe('escalate sub-command', () => {
  let mockRespond;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRespond = jest.fn().mockResolvedValue(undefined);
    mockClient = {};
    mockPostEscalation.mockResolvedValue({ ok: true, errorType: null });
  });

  const cmd = (over = {}) => ({
    user_id: 'U1', team_id: 'T1', channel_id: 'C1', trigger_id: 'trig-1', text: 'escalate', ...over,
  });

  it('acks and delegates to postEscalation with source slash_escalate', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient, logger: mockLogger });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockPostEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'slash_escalate', userId: 'U1', channelId: 'C1' }),
    );
  });

  it('sends the channel confirmation on success in a channel', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient, logger: mockLogger });
    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('escalated to #escalation') }),
    );
  });

  it('sends the DM confirmation and marks isDm when invoked in a DM', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    await fionaCommandCallback({
      command: cmd({ channel_id: 'D9', channel_name: 'directmessage' }),
      ack, respond: mockRespond, client: mockClient, logger: mockLogger,
    });
    expect(mockPostEscalation).toHaveBeenCalledWith(expect.objectContaining({ isDm: true }));
    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({ text: '✅ A team member will follow up shortly.' }),
    );
  });

  it('sends an ephemeral error when postEscalation fails', async () => {
    mockPostEscalation.mockResolvedValue({ ok: false, errorType: 'post_failed' });
    const ack = jest.fn().mockResolvedValue(undefined);
    await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient, logger: mockLogger });
    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('could not escalate') }),
    );
  });

  it('does not call postEscalation and warns the user when rate limited', async () => {
    // Exhaust the limiter for this user (default RATE_LIMIT_MAX_REQUESTS=20).
    const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
    for (let i = 0; i < 25; i++) checkRateLimit('U_RL');
    const ack = jest.fn().mockResolvedValue(undefined);
    await fionaCommandCallback({
      command: cmd({ user_id: 'U_RL' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
    });
    expect(mockPostEscalation).not.toHaveBeenCalled();
    expect(mockRespond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('request limit') }),
    );
  });
});
```

> The rate-limit test imports the **real** `rate-limiter.js` (it is not mocked) and exhausts the window for a dedicated user id so it does not affect other tests.

- [ ] **Step 5: Run the escalate tests to verify pass**

Run: `cd apps/fiona-slack && npm test -- listeners/commands/fiona`
Expected: PASS (existing + 5 new).

- [ ] **Step 6: Lint and commit**

```bash
cd apps/fiona-slack && npm run lint
git add apps/fiona-slack/src/listeners/commands/fiona.js apps/fiona-slack/src/agent/interaction-store.js apps/fiona-slack/tests/listeners/commands/fiona.test.js
git commit -m "$(cat <<'EOF'
feat(AI-122): add /fiona escalate sub-command

Routes /fiona escalate through rate limiting and DM detection, delegates
the channel post to postEscalation, and returns the AC-mandated ephemeral
confirmations and error message.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Configuration & docs

No new behavior — wires up env vars, the slash usage hint, deployment config, and docs. Verified by lint + the full test suite + JSON validity.

**Files:**
- Modify: `apps/fiona-slack/.env.sample`
- Modify: `apps/fiona-slack/manifest.json`
- Modify: `infra/fiona-slack-container/main.bicep`
- Modify: `docs/fiona-skills-prd.md:271-276`

- [ ] **Step 1: Add env vars to `.env.sample`**

Append to `apps/fiona-slack/.env.sample`:

```bash

# Escalation (/fiona escalate). ESCALATION_CHANNEL is the destination channel ID
# (e.g. C0123456789) — the bot must be a member of that channel to post.
# ESCALATION_CHANNEL=C0123456789
# Optional: a Slack user group ID (e.g. S0123456789) to @-mention on escalation.
# ESCALATION_USERGROUP_ID=S0123456789
```

- [ ] **Step 2: Update the slash command usage hint**

In `apps/fiona-slack/manifest.json`, change the `/fiona` `usage_hint`:

```json
                "usage_hint": "[help | ask <question> | search <query> | escalate]",
```

- [ ] **Step 3: Wire env vars into the container Bicep**

In `infra/fiona-slack-container/main.bicep`, add two params after the `captureAllConversations` param (line ~80):

```bicep
@description('Slack channel ID where /fiona escalate posts (bot must be a member)')
param escalationChannel string = ''

@description('Optional Slack user group ID to @-mention on escalation')
param escalationUsergroupId string = ''
```

Then add two entries to the container `env` array (after the `COSMOS_INTERACTIONS_CONTAINER` entry, ~line 388):

```bicep
            {
              name: 'ESCALATION_CHANNEL'
              value: escalationChannel
            }
            {
              name: 'ESCALATION_USERGROUP_ID'
              value: escalationUsergroupId
            }
```

- [ ] **Step 4: Update the PRD env table**

In `docs/fiona-skills-prd.md`, replace the §5 Environment Variables table with:

```markdown
| Variable                  | Default | Purpose                                                          |
| ------------------------- | ------- | ---------------------------------------------------------------- |
| `ESCALATION_CHANNEL`      | (unset) | Channel **ID** where escalation posts are created (bot must join) |
| `ESCALATION_USERGROUP_ID` | (unset) | Optional Slack user group ID to @-mention on escalation          |
```

- [ ] **Step 5: Verify and commit**

```bash
cd apps/fiona-slack && npm run lint && npm test
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"
git add apps/fiona-slack/.env.sample apps/fiona-slack/manifest.json infra/fiona-slack-container/main.bicep docs/fiona-skills-prd.md
git commit -m "$(cat <<'EOF'
chore(AI-122): wire escalation config and docs

Adds ESCALATION_CHANNEL / ESCALATION_USERGROUP_ID to .env.sample and the
container Bicep, updates the /fiona usage hint, and documents the vars.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: lint clean, full suite PASS, `manifest OK`.

---

## Self-Review

**1. Spec coverage (AI-122 ACs → tasks):**

| AC | Covered by |
| --- | --- |
| Post with display name + thread link + summary of recent history | Task 3 (post + transcript + summary), Task 1 (summary) |
| Ephemeral channel confirmation (exact copy) | Task 4 (`ESCALATE_CONFIRM_TEXT`) |
| DM ephemeral (exact copy) | Task 4 (`isDmChannel` → `ESCALATE_DM_TEXT`) |
| Channel-not-found/no-permission → ephemeral error + log | Task 3 (`post_failed`, `error` log) + Task 4 (`ESCALATE_ERROR_TEXT`) |
| `ESCALATION_CHANNEL` env var | Tasks 3, 5 |
| Rate limiting | Task 4 (`checkRateLimit`) |
| Record `slash_escalate` to both containers | Task 3 (interactions + feedback), Task 2 (feedback `interactionType`) |
| Shared `postEscalation` helper | Task 3 |
| Unit tests (name+link, confirmation, DM, permission error, both containers, env respected) | Tasks 3 & 4 test suites |

No gaps.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N"; every code step shows full code. ✅

**3. Type consistency:** `postEscalation(...) => { ok, errorType }` is produced in Task 3 and consumed identically in Task 4. `summarizeForEscalation(transcriptText, logger) => string|null` produced in Task 1, called in Task 3. `recordFeedback({ ..., interactionType })` extended in Task 2, called in Task 3. `source: 'slash_escalate'` consistent across Tasks 3–4. ✅

**4. Known assumptions to verify during execution:**
- Bolt provides `respond` and `client` to slash-command listeners (used in Task 4).
- The bot has `im:history` (DM transcript) and `channels:history`/`groups:history` (channel transcript) — already present in `manifest.json`.
- A user-group mention `<!subteam^ID>` needs no extra scope (it is message text).

