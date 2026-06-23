# Escalation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-scope `/fiona escalate` so conversation context comes only from the user's Fiona thread, add an always-present "Get Live Help" thread button and an async LLM-suggested escalation, all feeding one shared `postEscalation` helper.

**Architecture:** Three entry points — slash command (no transcript), an always-present thread button, and a proactive LLM-suggested button — call a single `postEscalation` helper. Transcripts are built only from a real Slack thread via the existing `buildThreadHistory()`, never from channel history.

**Tech Stack:** Node.js ESM, Slack Bolt 4, Jest 29 (`jest.unstable_mockModule`), Perplexity via the OpenAI SDK, Azure Cosmos.

## Global Constraints

- Every new `.js` file starts with the Apache-2.0 license header (4 comment lines) used across the repo.
- ESM only (`"type": "module"`); import paths end in `.js`.
- Tests run from `apps/fiona-slack/` with `npm test -- <path>` (wrapper: `node --experimental-vm-modules`).
- Mock ESM dependencies with `jest.unstable_mockModule(...)` **before** `await import(...)` of the module under test.
- User-facing escalation label/CTA is exactly **"Get Live Help"**.
- Classifier signal first line is exactly `Get Live Help: yes` or `Get Live Help: no` (parsed case-insensitively; non-`yes` ⇒ no suggestion).
- Proactive suggestions are gated solely on `ESCALATION_CHANNEL` being set (no separate flag).
- `ESCALATION_CHANNEL` is a Slack channel **ID**; there is no name default.
- Escalation record values come from `escalation-constants.js`, never inline literals.

---

## File Structure

**New:**
- `src/agent/escalation-constants.js` — `ESCALATION_SOURCES`, `FEEDBACK_VALUE_ESCALATION`.
- `src/listeners/views/escalate_block.js` — `escalateButtonBlock`, `buildSuggestionBlocks(reason)`.
- `src/listeners/actions/escalate.js` — `escalateActionCallback`.
- Tests: `tests/agent/llm-caller.classify.test.js`, `tests/listeners/views/escalate-block.test.js`, `tests/listeners/actions/escalate.test.js`.

**Modified:**
- `src/agent/rate-limiter.js` — add `rateLimitMessage(retryAfterMs)`.
- `src/agent/rate-limited-handler.js` — use `rateLimitMessage`.
- `src/agent/thread-history.js` — add `neutralizeBroadcasts`, `renderTranscript`.
- `src/agent/llm-caller.js` — add `classifyForEscalation`.
- `src/agent/escalation.js` — refactor `postEscalation`; add `isEscalationConfigured`, `maybeSuggestEscalation`.
- `src/listeners/commands/fiona.js` — help text, shared rate-limit message, confirm wording.
- `src/listeners/actions/index.js` — register `escalate_conversation`.
- `src/listeners/events/app_mention.js`, `src/listeners/assistant/message.js` — attach button + fire-and-forget suggestion.
- `src/agent/interaction-store.js` — JSDoc interactionType list.
- Existing tests: `tests/agent/escalation.test.js`, `tests/listeners/commands/fiona.test.js`.

---

### Task 1: Shared `rateLimitMessage` helper

**Files:**
- Modify: `src/agent/rate-limiter.js`
- Modify: `src/agent/rate-limited-handler.js:55-58`
- Test: `tests/agent/rate-limiter.test.js`

**Interfaces:**
- Produces: `rateLimitMessage(retryAfterMs: number) => string`

- [ ] **Step 1: Write the failing test** — append to `tests/agent/rate-limiter.test.js`:

```javascript
import { rateLimitMessage } from '../../src/agent/rate-limiter.js';

describe('rateLimitMessage', () => {
  it('formats a single minute without pluralizing', () => {
    expect(rateLimitMessage(60000)).toBe(
      ":no_entry: You've reached the request limit. Please wait 1 minute before trying again.",
    );
  });

  it('pluralizes and rounds up partial minutes', () => {
    expect(rateLimitMessage(90000)).toContain('2 minutes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/rate-limiter.test.js`
Expected: FAIL — `rateLimitMessage is not a function`.

- [ ] **Step 3: Add the helper** — append to `src/agent/rate-limiter.js`:

```javascript
/**
 * Build the standard user-facing rate-limit message.
 *
 * @param {number} retryAfterMs - Milliseconds until the user may retry.
 * @returns {string}
 */
export function rateLimitMessage(retryAfterMs) {
  const minutes = Math.ceil(retryAfterMs / 60000);
  return `:no_entry: You've reached the request limit. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`;
}
```

- [ ] **Step 4: Refactor `rate-limited-handler.js`** to reuse it. Change the import on line 7 and the message block at lines 55-58:

```javascript
import { checkRateLimit, rateLimitMessage } from './rate-limiter.js';
```

Replace lines 55-58 (the `const minutes = ...` and `await say(...)`) with:

```javascript
    await say(rateLimitMessage(retryAfterMs));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/agent/rate-limiter.test.js tests/listeners/events/app-mention.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/rate-limiter.js src/agent/rate-limited-handler.js tests/agent/rate-limiter.test.js
git commit -m "refactor: extract shared rateLimitMessage helper [AI-122]"
```

---

### Task 2: Transcript rendering in `thread-history.js`

**Files:**
- Modify: `src/agent/thread-history.js`
- Test: `tests/agent/thread-history.test.js`

**Interfaces:**
- Consumes: `buildThreadHistory` output shape `Array<{role:'user'|'assistant', content:string}>`.
- Produces:
  - `neutralizeBroadcasts(text: string) => string`
  - `renderTranscript(messages: Array<{role,content}>) => string` — newline-joined `*User:*`/`*Fiona:*` lines, broadcasts neutralized; `''` for empty input.

- [ ] **Step 1: Write the failing test** — append to `tests/agent/thread-history.test.js`:

```javascript
import { neutralizeBroadcasts, renderTranscript } from '../../src/agent/thread-history.js';

describe('neutralizeBroadcasts', () => {
  it('defuses channel/here broadcasts and subteam pings', () => {
    expect(neutralizeBroadcasts('hey <!channel> and <!subteam^S1|oncall>')).toBe('hey channel and oncall');
  });
  it('passes through plain text unchanged', () => {
    expect(neutralizeBroadcasts('just text')).toBe('just text');
  });
});

describe('renderTranscript', () => {
  it('labels roles and joins lines', () => {
    const out = renderTranscript([
      { role: 'user', content: 'I need ODS help' },
      { role: 'assistant', content: 'Here is info' },
    ]);
    expect(out).toBe('*User:* I need ODS help\n*Fiona:* Here is info');
  });
  it('neutralizes broadcasts inside content', () => {
    expect(renderTranscript([{ role: 'user', content: 'ping <!here>' }])).toBe('*User:* ping here');
  });
  it('returns empty string for empty input', () => {
    expect(renderTranscript([])).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/thread-history.test.js`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Add the helpers** — append to `src/agent/thread-history.js`:

```javascript
/**
 * Defuse Slack broadcast/subteam tokens so transcript content cannot mass-ping
 * or spoof when re-posted into the escalation channel. `<!channel>` -> `channel`,
 * `<!subteam^S1|oncall>` -> `oncall`.
 *
 * @param {string} text
 * @returns {string}
 */
export function neutralizeBroadcasts(text) {
  return (text ?? '').replace(/<!([^>|]+)(?:\|([^>]+))?>/g, (_match, trigger, label) => label || trigger);
}

/**
 * Render a buildThreadHistory message array into a plain-text transcript.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string} Newline-joined "*Who:* text" lines, or '' when empty.
 */
export function renderTranscript(messages) {
  return (messages ?? [])
    .map((m) => {
      const who = m.role === 'assistant' ? 'Fiona' : 'User';
      const text = neutralizeBroadcasts(m.content).trim();
      return text ? `*${who}:* ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/thread-history.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/thread-history.js tests/agent/thread-history.test.js
git commit -m "feat: add transcript renderer and broadcast neutralizer [AI-122]"
```

---

### Task 3: Shared escalation constants

**Files:**
- Create: `src/agent/escalation-constants.js`

**Interfaces:**
- Produces:
  - `ESCALATION_SOURCES = { SLASH: 'slash_escalate', BUTTON: 'button_escalate', SUGGESTED: 'suggested_escalate' }`
  - `FEEDBACK_VALUE_ESCALATION = 'escalation'`

- [ ] **Step 1: Create the module** (no dedicated test — covered by consumers):

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Canonical escalation interaction-type sources, recorded to Cosmos.
 * @readonly
 */
export const ESCALATION_SOURCES = {
  SLASH: 'slash_escalate',
  BUTTON: 'button_escalate',
  SUGGESTED: 'suggested_escalate',
};

/** Feedback-container `value` written for escalation rows. */
export const FEEDBACK_VALUE_ESCALATION = 'escalation';
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/escalation-constants.js
git commit -m "feat: add shared escalation constants [AI-122]"
```

---

### Task 4: Escalation block builders

**Files:**
- Create: `src/listeners/views/escalate_block.js`
- Test: `tests/listeners/views/escalate-block.test.js`

**Interfaces:**
- Consumes: `ESCALATION_SOURCES` from `src/agent/escalation-constants.js`.
- Produces:
  - `escalateButtonBlock` — an `actions` block; single button, `action_id: 'escalate_conversation'`, `value: 'button_escalate'`.
  - `buildSuggestionBlocks(reason?: string) => Array<Block>` — section (explanatory text incl. reason) + actions block; button `action_id: 'escalate_conversation'`, `value: 'suggested_escalate'`.

- [ ] **Step 1: Write the failing test** — create `tests/listeners/views/escalate-block.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { escalateButtonBlock, buildSuggestionBlocks } from '../../../src/listeners/views/escalate_block.js';

describe('escalateButtonBlock', () => {
  it('is an actions block with a Get Live Help button carrying the button source', () => {
    expect(escalateButtonBlock.type).toBe('actions');
    const btn = escalateButtonBlock.elements[0];
    expect(btn.action_id).toBe('escalate_conversation');
    expect(btn.text.text).toBe('Get Live Help');
    expect(btn.value).toBe('button_escalate');
  });
});

describe('buildSuggestionBlocks', () => {
  it('includes the reason and a suggested-source button', () => {
    const blocks = buildSuggestionBlocks('You seem stuck on ODS setup.');
    const json = JSON.stringify(blocks);
    expect(json).toContain('You seem stuck on ODS setup.');
    expect(json).toContain('Get Live Help');
    const actions = blocks.find((b) => b.type === 'actions');
    expect(actions.elements[0].value).toBe('suggested_escalate');
    expect(actions.elements[0].action_id).toBe('escalate_conversation');
  });

  it('omits a reason sentence when none is given but still renders the button', () => {
    const blocks = buildSuggestionBlocks(null);
    expect(blocks.find((b) => b.type === 'actions').elements[0].value).toBe('suggested_escalate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/listeners/views/escalate-block.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module** `src/listeners/views/escalate_block.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { ESCALATION_SOURCES } from '../../agent/escalation-constants.js';

const ESCALATE_ACTION_ID = 'escalate_conversation';

/**
 * Always-present "Get Live Help" button attached to every Fiona response.
 * @type {import("@slack/types").ActionsBlock}
 */
export const escalateButtonBlock = {
  type: 'actions',
  elements: [
    {
      type: 'button',
      action_id: ESCALATE_ACTION_ID,
      text: { type: 'plain_text', text: 'Get Live Help', emoji: true },
      value: ESCALATION_SOURCES.BUTTON,
    },
  ],
};

/**
 * Build the proactive suggestion message: explanatory text plus a prominent
 * "Get Live Help" button that records `suggested_escalate` when clicked.
 *
 * @param {string|null} [reason] - Short classifier reason, shown to the user.
 * @returns {Array<object>} Slack blocks.
 */
export function buildSuggestionBlocks(reason) {
  const lead = reason
    ? `It looks like I may not have fully solved this — ${reason}`
    : 'It looks like I may not have fully solved this.';
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `${lead}\nWant me to connect you with a human?` } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: ESCALATE_ACTION_ID,
          text: { type: 'plain_text', text: 'Get Live Help', emoji: true },
          value: ESCALATION_SOURCES.SUGGESTED,
          style: 'primary',
        },
      ],
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/listeners/views/escalate-block.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/listeners/views/escalate_block.js tests/listeners/views/escalate-block.test.js
git commit -m "feat: add Get Live Help button and suggestion blocks [AI-122]"
```

---

### Task 5: `classifyForEscalation` in `llm-caller.js`

**Files:**
- Modify: `src/agent/llm-caller.js` (append after `summarizeForEscalation`)
- Test: `tests/agent/llm-caller.classify.test.js`

**Interfaces:**
- Consumes: module-level `perplexityClient`, `PERPLEXITY_API_MODEL`.
- Produces: `classifyForEscalation(transcriptText: string, logger?) => Promise<{ suggest: boolean, reason: string|null }>`

- [ ] **Step 1: Write the failing test** — create `tests/agent/llm-caller.classify.test.js`:

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
const { classifyForEscalation } = await import('../../src/agent/llm-caller.js');

describe('classifyForEscalation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns suggest:true and the reason when the first line says yes', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Get Live Help: yes\nUser is blocked on ODS install.' } }],
    });
    const result = await classifyForEscalation('*User:* help');
    expect(result).toEqual({ suggest: true, reason: 'User is blocked on ODS install.' });
  });

  it('returns suggest:false when the first line says no', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Get Live Help: no' } }] });
    expect(await classifyForEscalation('*User:* thanks!')).toEqual({ suggest: false, reason: null });
  });

  it('treats anything that is not an explicit yes as no (case-insensitive)', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'maybe later' } }] });
    expect((await classifyForEscalation('*User:* hmm')).suggest).toBe(false);
  });

  it('returns false for empty transcript without calling the LLM', async () => {
    const result = await classifyForEscalation('   ');
    expect(result).toEqual({ suggest: false, reason: null });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns false and warns when the LLM throws', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const logger = { warn: jest.fn() };
    expect(await classifyForEscalation('*User:* hi', logger)).toEqual({ suggest: false, reason: null });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('escalation classification'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/llm-caller.classify.test.js`
Expected: FAIL — `classifyForEscalation is not a function`.

- [ ] **Step 3: Append the helper** to `src/agent/llm-caller.js`:

```javascript
// ─── Escalation Suggestion Classifier ───────────────────────────────────────
const ESCALATION_CLASSIFIER_SYSTEM_PROMPT =
  'You decide whether a user in a Slack conversation with Fiona (an Ed-Fi AI assistant) ' +
  'should be offered live help from a human. Consider whether the user appears stuck, ' +
  'unresolved, repeating themselves, or frustrated. ' +
  'Respond with a first line that is EXACTLY "Get Live Help: yes" or "Get Live Help: no". ' +
  'If yes, add a second line with a brief (max 20 words) reason. No other text.';

/**
 * Classify whether Fiona should proactively offer live help. Non-streaming.
 * Returns { suggest:false } when the LLM is unconfigured, the transcript is
 * empty, the call fails, or the response is not an explicit yes.
 *
 * @param {string} transcriptText
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<{ suggest: boolean, reason: string|null }>}
 */
export async function classifyForEscalation(transcriptText, logger) {
  if (!perplexityClient) return { suggest: false, reason: null };
  if (!transcriptText || !transcriptText.trim()) return { suggest: false, reason: null };

  try {
    const response = await perplexityClient.chat.completions.create({
      model: PERPLEXITY_API_MODEL,
      messages: [
        { role: 'system', content: ESCALATION_CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: transcriptText },
      ],
      stream: false,
    });
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { suggest: false, reason: null };

    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] ?? '';
    const match = firstLine.match(/get live help:\s*(yes|no)/i);
    const suggest = Boolean(match) && match[1].toLowerCase() === 'yes';
    const reason = suggest && lines[1] ? lines[1] : null;
    return { suggest, reason };
  } catch (error) {
    logger?.warn?.(`Failed to generate escalation classification: ${error.message}`);
    return { suggest: false, reason: null };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/llm-caller.classify.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/llm-caller.js tests/agent/llm-caller.classify.test.js
git commit -m "feat: add classifyForEscalation LLM self-signal [AI-122]"
```

---

### Task 6: Refactor `postEscalation` + add `isEscalationConfigured`

**Files:**
- Modify (rewrite): `src/agent/escalation.js`
- Test (rewrite): `tests/agent/escalation.test.js`

**Interfaces:**
- Consumes: `buildThreadHistory`, `renderTranscript`, `neutralizeBroadcasts` (`thread-history.js`); `summarizeForEscalation` (`llm-caller.js`); `getUser` (`slack-users-store.js`); `recordInteraction`, `recordFeedback`; `ESCALATION_SOURCES`, `FEEDBACK_VALUE_ESCALATION`.
- Produces:
  - `isEscalationConfigured() => boolean`
  - `postEscalation({ client, userId, teamId, channelId, threadTs=null, messageTs, source, isDm=false, logger }) => Promise<{ ok, errorType }>` — transcript built only when `threadTs` matches `^\d+\.\d+$`; permalink only for real ts + non-DM; slash path posts a nudge line, no transcript.

- [ ] **Step 1: Rewrite the test** — replace the contents of `tests/agent/escalation.test.js` with:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockGetUser = jest.fn();
const mockRecordInteraction = jest.fn().mockResolvedValue(undefined);
const mockRecordFeedback = jest.fn().mockResolvedValue(undefined);
const mockSummarize = jest.fn();
const mockBuildThreadHistory = jest.fn();

jest.unstable_mockModule('../../src/agent/slack-users-store.js', () => ({ getUser: mockGetUser }));
jest.unstable_mockModule('../../src/agent/interaction-store.js', () => ({ recordInteraction: mockRecordInteraction }));
jest.unstable_mockModule('../../src/agent/feedback-store.js', () => ({ recordFeedback: mockRecordFeedback }));
jest.unstable_mockModule('../../src/agent/llm-caller.js', () => ({
  summarizeForEscalation: mockSummarize,
  classifyForEscalation: jest.fn(),
}));
jest.unstable_mockModule('../../src/agent/thread-history.js', () => ({
  buildThreadHistory: mockBuildThreadHistory,
  renderTranscript: (msgs) => (msgs ?? []).map((m) => `*${m.role === 'assistant' ? 'Fiona' : 'User'}:* ${m.content}`).join('\n'),
  neutralizeBroadcasts: (t) => t,
}));

const { postEscalation, isEscalationConfigured } = await import('../../src/agent/escalation.js');

function makeClient() {
  return {
    chat: {
      postMessage: jest.fn().mockResolvedValue({ ts: '111.222' }),
      getPermalink: jest.fn().mockResolvedValue({ permalink: 'https://slack.test/p1' }),
    },
  };
}

const REAL_TS = '1700000000.000100';

const threadArgs = () => ({
  client: makeClient(),
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: REAL_TS,
  messageTs: REAL_TS,
  source: 'button_escalate',
  logger: { warn: jest.fn(), error: jest.fn() },
});

const slashArgs = () => ({
  client: makeClient(),
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: null,
  messageTs: 'trigger-abc',
  source: 'slash_escalate',
  logger: { warn: jest.fn(), error: jest.fn() },
});

describe('escalation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ESCALATION_CHANNEL = 'C_ESCALATE';
    delete process.env.ESCALATION_USERGROUP_ID;
    mockGetUser.mockResolvedValue({ displayName: 'Ada Lovelace' });
    mockSummarize.mockResolvedValue('User is stuck configuring the ODS.');
    mockBuildThreadHistory.mockResolvedValue([
      { role: 'user', content: 'I need help with the ODS' },
      { role: 'assistant', content: 'Here is some info' },
    ]);
  });
  afterEach(() => {
    delete process.env.ESCALATION_CHANNEL;
    delete process.env.ESCALATION_USERGROUP_ID;
  });

  describe('isEscalationConfigured', () => {
    it('reflects whether ESCALATION_CHANNEL is set', () => {
      expect(isEscalationConfigured()).toBe(true);
      delete process.env.ESCALATION_CHANNEL;
      expect(isEscalationConfigured()).toBe(false);
    });
  });

  it('returns channel_not_configured when ESCALATION_CHANNEL is unset', async () => {
    delete process.env.ESCALATION_CHANNEL;
    expect(await postEscalation(threadArgs())).toEqual({ ok: false, errorType: 'channel_not_configured' });
  });

  describe('thread path (real threadTs)', () => {
    it('builds a transcript via buildThreadHistory and posts summary + permalink', async () => {
      const args = threadArgs();
      const result = await postEscalation(args);
      expect(result.ok).toBe(true);
      expect(mockBuildThreadHistory).toHaveBeenCalledWith(args.client, 'C1', REAL_TS, expect.any(Object));
      expect(args.client.chat.getPermalink).toHaveBeenCalledWith({ channel: 'C1', message_ts: REAL_TS });
      const header = JSON.stringify(args.client.chat.postMessage.mock.calls[0][0].blocks);
      expect(header).toContain('Ada Lovelace');
      expect(header).toContain('https://slack.test/p1');
      expect(header).toContain('User is stuck configuring the ODS.');
    });

    it('posts the transcript as a threaded reply to the escalation message', async () => {
      const args = threadArgs();
      await postEscalation(args);
      const reply = args.client.chat.postMessage.mock.calls.find((c) => c[0].thread_ts === '111.222');
      expect(reply).toBeDefined();
      expect(JSON.stringify(reply[0].blocks)).toContain('I need help with the ODS');
    });

    it('pings the user group when ESCALATION_USERGROUP_ID is set', async () => {
      process.env.ESCALATION_USERGROUP_ID = 'S123';
      const args = threadArgs();
      await postEscalation(args);
      expect(JSON.stringify(args.client.chat.postMessage.mock.calls[0][0].blocks)).toContain('<!subteam^S123>');
    });

    it('still posts (transcript-only) when the summary fails', async () => {
      mockSummarize.mockResolvedValue(null);
      const args = threadArgs();
      expect((await postEscalation(args)).ok).toBe(true);
      expect(JSON.stringify(args.client.chat.postMessage.mock.calls[0][0].blocks)).not.toContain('*Summary:*');
    });

    it('records to both containers with the given source and escalation value', async () => {
      await postEscalation(threadArgs());
      await new Promise((r) => setImmediate(r));
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'button_escalate', status: 'success' }),
      );
      expect(mockRecordFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'button_escalate', value: 'escalation' }),
      );
    });
  });

  describe('slash path (threadTs null)', () => {
    it('does not build a transcript, fetch a permalink, or post a summary', async () => {
      const args = slashArgs();
      const result = await postEscalation(args);
      expect(result.ok).toBe(true);
      expect(mockBuildThreadHistory).not.toHaveBeenCalled();
      expect(args.client.chat.getPermalink).not.toHaveBeenCalled();
      const blocks = JSON.stringify(args.client.chat.postMessage.mock.calls[0][0].blocks);
      expect(blocks).not.toContain('*Summary:*');
      expect(blocks).toContain('Get Live Help');
      expect(blocks).toContain('<#C1>');
    });

    it('does not post a transcript reply when there is no transcript', async () => {
      const args = slashArgs();
      await postEscalation(args);
      expect(args.client.chat.postMessage).toHaveBeenCalledTimes(1);
    });
  });

  it('uses a DM placeholder and skips permalink for DM escalations', async () => {
    const args = { ...slashArgs(), isDm: true };
    expect((await postEscalation(args)).ok).toBe(true);
    expect(args.client.chat.getPermalink).not.toHaveBeenCalled();
    expect(JSON.stringify(args.client.chat.postMessage.mock.calls[0][0].blocks)).toContain('Direct message');
  });

  it('returns post_failed when chat.postMessage throws', async () => {
    const args = threadArgs();
    args.client.chat.postMessage.mockRejectedValueOnce(new Error('not_in_channel'));
    expect(await postEscalation(args)).toEqual({ ok: false, errorType: 'post_failed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/escalation.test.js`
Expected: FAIL — current `postEscalation` calls `conversations.replies`/`history` and `getUser` is real; new exports/behavior absent.

- [ ] **Step 3: Rewrite `src/agent/escalation.js`** entirely:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { FEEDBACK_VALUE_ESCALATION } from './escalation-constants.js';
import { recordFeedback } from './feedback-store.js';
import { recordInteraction } from './interaction-store.js';
import { summarizeForEscalation } from './llm-caller.js';
import { getUser } from './slack-users-store.js';
import { buildThreadHistory, neutralizeBroadcasts, renderTranscript } from './thread-history.js';

const SLACK_BLOCK_TEXT_LIMIT = 2900; // headroom under Slack's 3000-char section limit
const SLASH_NUDGE =
  '_No conversation context — requested via `/fiona escalate`. ' +
  'For full context, use the *Get Live Help* button in your conversation with Fiona._';

/** A real Slack message timestamp looks like "1700000000.000100". */
const isRealTs = (ts) => typeof ts === 'string' && /^\d+\.\d+$/.test(ts);

/** @returns {boolean} Whether an escalation destination channel is configured. */
export function isEscalationConfigured() {
  return Boolean(process.env.ESCALATION_CHANNEL);
}

/**
 * Post an escalation to the configured channel and record it. Shared by the
 * /fiona escalate slash command, the always-present button, and proactive
 * suggestions. A transcript is built only when a real thread timestamp exists.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.userId
 * @param {string} [params.teamId]
 * @param {string} params.channelId
 * @param {string|null} [params.threadTs]
 * @param {string} params.messageTs
 * @param {'slash_escalate'|'button_escalate'|'suggested_escalate'} params.source
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
  const rawName = user?.displayName || user?.realName || user?.name || `<@${userId}>`;
  const displayName = neutralizeBroadcasts(rawName);

  // Transcript + summary only when a genuine thread exists.
  let transcript = '';
  let summary = null;
  if (isRealTs(threadTs)) {
    const history = await buildThreadHistory(client, channelId, threadTs, { logger });
    transcript = renderTranscript(history);
    summary = transcript ? await summarizeForEscalation(transcript, logger) : null;
  }

  // Permalink only when a real thread ts exists in a non-DM context.
  let permalink = null;
  if (!isDm && isRealTs(threadTs)) {
    try {
      const res = await client.chat.getPermalink({ channel: channelId, message_ts: threadTs });
      permalink = res?.permalink ?? null;
    } catch (err) {
      logger?.warn?.(`Failed to get permalink for escalation: ${err.message}`);
    }
  }

  const usergroupId = process.env.ESCALATION_USERGROUP_ID;
  const mention = usergroupId ? `<!subteam^${usergroupId}> ` : '';
  let locationLink;
  if (permalink) locationLink = `<${permalink}|View conversation>`;
  else if (isDm) locationLink = 'Direct message (transcript below)';
  else locationLink = `<#${channelId}>`;

  const unixSeconds = Math.floor(Date.now() / 1000);
  const iso = new Date().toISOString();
  const headerLines = [
    `${mention}:rotating_light: *Escalation requested* by *${displayName}*`,
    `*Where:* ${locationLink}`,
    `*When:* <!date^${unixSeconds}^{date_short_pretty} {time}|${iso}>`,
  ];
  if (summary) headerLines.push(`*Summary:* ${summary}`);
  else if (!transcript) headerLines.push(SLASH_NUDGE);

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
    value: FEEDBACK_VALUE_ESCALATION,
    interactionType: source,
    reason: null,
    userMessage: transcript || null,
    botResponse: summary || null,
    logger,
  }).catch((e) => logger?.warn?.(`Failed to record escalation feedback: ${e.message}`));

  return { ok: true, errorType: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/escalation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/escalation.js tests/agent/escalation.test.js
git commit -m "refactor: build escalation transcript only from real threads [AI-122]"
```

---

### Task 7: `maybeSuggestEscalation` (proactive flow)

**Files:**
- Modify: `src/agent/escalation.js` (add export + imports)
- Test: `tests/agent/escalation.test.js` (add a describe block)

**Interfaces:**
- Consumes: `classifyForEscalation` (`llm-caller.js`), `renderTranscript` (`thread-history.js`), `buildSuggestionBlocks` (`escalate_block.js`), `isEscalationConfigured`.
- Produces: `maybeSuggestEscalation({ client, channelId, threadTs, history, botText, logger }) => Promise<boolean>` — returns true when a suggestion was posted. No-op (false) when not configured, classifier says no, or on error.

- [ ] **Step 1: Add the failing test** — append a new describe block to `tests/agent/escalation.test.js`. Also extend the `llm-caller.js` mock at the top of that file so `classifyForEscalation` is controllable; replace the existing `llm-caller.js` mock line with:

```javascript
const mockClassify = jest.fn();
jest.unstable_mockModule('../../src/agent/llm-caller.js', () => ({
  summarizeForEscalation: mockSummarize,
  classifyForEscalation: mockClassify,
}));
```

Update the import line to also pull in the new export:

```javascript
const { postEscalation, isEscalationConfigured, maybeSuggestEscalation } = await import('../../src/agent/escalation.js');
```

Then append:

```javascript
describe('maybeSuggestEscalation', () => {
  const baseArgs = () => ({
    client: makeClient(),
    channelId: 'C1',
    threadTs: REAL_TS,
    history: [{ role: 'user', content: 'still broken' }],
    botText: 'Sorry, I am not sure.',
    logger: { warn: jest.fn() },
  });

  beforeEach(() => {
    process.env.ESCALATION_CHANNEL = 'C_ESCALATE';
    mockClassify.mockReset();
  });

  it('posts a suggestion in-thread when the classifier says yes', async () => {
    mockClassify.mockResolvedValue({ suggest: true, reason: 'User still blocked.' });
    const args = baseArgs();
    const posted = await maybeSuggestEscalation(args);
    expect(posted).toBe(true);
    const call = args.client.chat.postMessage.mock.calls[0][0];
    expect(call.channel).toBe('C1');
    expect(call.thread_ts).toBe(REAL_TS);
    expect(JSON.stringify(call.blocks)).toContain('Get Live Help');
    expect(JSON.stringify(call.blocks)).toContain('User still blocked.');
  });

  it('does nothing when the classifier says no', async () => {
    mockClassify.mockResolvedValue({ suggest: false, reason: null });
    const args = baseArgs();
    expect(await maybeSuggestEscalation(args)).toBe(false);
    expect(args.client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('does nothing when ESCALATION_CHANNEL is unset (without calling the classifier)', async () => {
    delete process.env.ESCALATION_CHANNEL;
    const args = baseArgs();
    expect(await maybeSuggestEscalation(args)).toBe(false);
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('swallows post errors and returns false', async () => {
    mockClassify.mockResolvedValue({ suggest: true, reason: null });
    const args = baseArgs();
    args.client.chat.postMessage.mockRejectedValueOnce(new Error('down'));
    expect(await maybeSuggestEscalation(args)).toBe(false);
    expect(args.logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent/escalation.test.js`
Expected: FAIL — `maybeSuggestEscalation is not a function`.

- [ ] **Step 3: Implement** — in `src/agent/escalation.js`, add to the imports:

```javascript
import { classifyForEscalation, summarizeForEscalation } from './llm-caller.js';
import { buildSuggestionBlocks } from '../listeners/views/escalate_block.js';
```

(Replace the existing single `summarizeForEscalation` import with the combined line above.) Then append the function:

```javascript
/**
 * After a Fiona answer, ask the classifier whether to proactively offer live
 * help; if so, post a suggestion (with a Get Live Help button) in the thread.
 * Fire-and-forget friendly: never throws, returns whether a suggestion posted.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.channelId
 * @param {string} params.threadTs
 * @param {Array<{role:string, content:string}>} params.history - buildThreadHistory output for the turn.
 * @param {string} params.botText - The answer Fiona just sent.
 * @param {import("@slack/logger").Logger} [params.logger]
 * @returns {Promise<boolean>}
 */
export async function maybeSuggestEscalation({ client, channelId, threadTs, history, botText, logger }) {
  if (!isEscalationConfigured()) return false;

  const transcript = [renderTranscript(history), botText ? `*Fiona:* ${neutralizeBroadcasts(botText)}` : '']
    .filter(Boolean)
    .join('\n');

  const { suggest, reason } = await classifyForEscalation(transcript, logger);
  if (!suggest) return false;

  try {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Want me to connect you with a human?',
      blocks: buildSuggestionBlocks(reason),
    });
    return true;
  } catch (err) {
    logger?.warn?.(`Failed to post escalation suggestion: ${err.message}`);
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent/escalation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/escalation.js tests/agent/escalation.test.js
git commit -m "feat: add proactive maybeSuggestEscalation flow [AI-122]"
```

---

### Task 8: Escalate button action handler + registration

**Files:**
- Create: `src/listeners/actions/escalate.js`
- Modify: `src/listeners/actions/index.js`
- Test: `tests/listeners/actions/escalate.test.js`

**Interfaces:**
- Consumes: `postEscalation` (`escalation.js`), `checkRateLimit` + `rateLimitMessage` (`rate-limiter.js`), `recordInteraction`, `ESCALATION_SOURCES`.
- Produces: `escalateActionCallback({ ack, body, client, respond, logger })`; registered on `action('escalate_conversation', ...)`.

- [ ] **Step 1: Write the failing test** — create `tests/listeners/actions/escalate.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPostEscalation = jest.fn();
const mockCheckRateLimit = jest.fn();
const mockRecordInteraction = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({ postEscalation: mockPostEscalation }));
jest.unstable_mockModule('../../../src/agent/rate-limiter.js', () => ({
  checkRateLimit: mockCheckRateLimit,
  rateLimitMessage: (ms) => `wait ${Math.ceil(ms / 60000)}`,
}));
jest.unstable_mockModule('../../../src/agent/interaction-store.js', () => ({ recordInteraction: mockRecordInteraction }));

const { escalateActionCallback } = await import('../../../src/listeners/actions/escalate.js');

const baseBody = (over = {}) => ({
  type: 'block_actions',
  user: { id: 'U1' },
  team: { id: 'T1' },
  channel: { id: 'C1', type: 'channel' },
  message: { ts: '111.000', thread_ts: '100.000' },
  actions: [{ action_id: 'escalate_conversation', value: 'button_escalate' }],
  ...over,
});

describe('escalateActionCallback', () => {
  let ack;
  let respond;
  let client;
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    ack = jest.fn().mockResolvedValue(undefined);
    respond = jest.fn().mockResolvedValue(undefined);
    client = {};
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    mockPostEscalation.mockResolvedValue({ ok: true, errorType: null });
  });

  it('acks and delegates with the real thread_ts and button source', async () => {
    await escalateActionCallback({ ack, body: baseBody(), client, respond, logger });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockPostEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ threadTs: '100.000', messageTs: '111.000', source: 'button_escalate', channelId: 'C1' }),
    );
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ response_type: 'ephemeral' }));
  });

  it('passes source suggested_escalate when the button value says so', async () => {
    const body = baseBody({ actions: [{ action_id: 'escalate_conversation', value: 'suggested_escalate' }] });
    await escalateActionCallback({ ack, body, client, respond, logger });
    expect(mockPostEscalation).toHaveBeenCalledWith(expect.objectContaining({ source: 'suggested_escalate' }));
  });

  it('marks isDm and skips when in an im channel', async () => {
    const body = baseBody({ channel: { id: 'D9', type: 'im' } });
    await escalateActionCallback({ ack, body, client, respond, logger });
    expect(mockPostEscalation).toHaveBeenCalledWith(expect.objectContaining({ isDm: true }));
  });

  it('responds with the rate-limit message and does not escalate when limited', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 120000 });
    await escalateActionCallback({ ack, body: baseBody(), client, respond, logger });
    expect(mockPostEscalation).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('wait 2') }));
  });

  it('surfaces an error response when postEscalation fails', async () => {
    mockPostEscalation.mockResolvedValue({ ok: false, errorType: 'post_failed' });
    await escalateActionCallback({ ack, body: baseBody(), client, respond, logger });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('could not') }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/listeners/actions/escalate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/listeners/actions/escalate.js`:**

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { ESCALATION_SOURCES } from '../../agent/escalation-constants.js';
import { postEscalation } from '../../agent/escalation.js';
import { recordInteraction } from '../../agent/interaction-store.js';
import { checkRateLimit, rateLimitMessage } from '../../agent/rate-limiter.js';

const CONFIRM_TEXT = '✅ Your conversation has been escalated. A team member will follow up shortly.';
const DM_CONFIRM_TEXT = '✅ A team member will follow up shortly.';
const ERROR_TEXT =
  ':warning: Sorry, I could not escalate your conversation right now. Please reach out to the team directly.';

/**
 * Handles the "Get Live Help" button on Fiona responses and proactive
 * suggestions. Escalates the thread the button lives in (real thread_ts).
 *
 * @param {import("@slack/bolt").SlackActionMiddlewareArgs & { client: import("@slack/web-api").WebClient, logger: import("@slack/logger").Logger }} args
 */
export const escalateActionCallback = async ({ ack, body, client, respond, logger }) => {
  await ack();

  const action = Array.isArray(body.actions) ? body.actions[0] : null;
  const source = action?.value === ESCALATION_SOURCES.SUGGESTED ? ESCALATION_SOURCES.SUGGESTED : ESCALATION_SOURCES.BUTTON;
  const userId = body.user?.id;
  const teamId = body.team?.id;
  const channelId = body.channel?.id;
  const messageTs = body.message?.ts;
  const threadTs = body.message?.thread_ts ?? body.message?.ts;
  const isDm = body.channel?.type === 'im' || (channelId || '').startsWith('D');

  if (!userId || !channelId || !messageTs) {
    logger?.warn?.('Missing fields on escalate action; skipping');
    return;
  }

  const { allowed, retryAfterMs } = checkRateLimit(userId);
  if (!allowed) {
    await respond({ response_type: 'ephemeral', replace_original: false, text: rateLimitMessage(retryAfterMs) });
    recordInteraction({
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
      interactionType: source,
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record ${source} interaction: ${err.name}`));
    return;
  }

  const result = await postEscalation({ client, userId, teamId, channelId, threadTs, messageTs, source, isDm, logger });

  if (result.ok) {
    await respond({ response_type: 'ephemeral', replace_original: false, text: isDm ? DM_CONFIRM_TEXT : CONFIRM_TEXT });
  } else {
    await respond({ response_type: 'ephemeral', replace_original: false, text: ERROR_TEXT });
    recordInteraction({
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
      interactionType: source,
      status: 'error',
      errorType: result.errorType,
      rateLimited: false,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record ${source} interaction: ${err.name}`));
  }
};
```

- [ ] **Step 4: Register the action** — edit `src/listeners/actions/index.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { escalateActionCallback } from './escalate.js';
import { feedbackActionCallback } from './feedback.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  app.action('feedback', feedbackActionCallback);
  app.action('escalate_conversation', escalateActionCallback);
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/listeners/actions/escalate.test.js tests/listeners/index.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/listeners/actions/escalate.js src/listeners/actions/index.js tests/listeners/actions/escalate.test.js
git commit -m "feat: add Get Live Help button action handler [AI-122]"
```

---

### Task 9: Slash command polish (`fiona.js`)

**Files:**
- Modify: `src/listeners/commands/fiona.js`
- Test: `tests/listeners/commands/fiona.test.js`

**Interfaces:**
- Consumes: `rateLimitMessage` (`rate-limiter.js`), `ESCALATION_SOURCES` (`escalation-constants.js`).
- Produces: unchanged exports; `HELP_TEXT` lists escalate; confirmation no longer hardcodes `#escalation`; rate-limit text shared.

- [ ] **Step 1: Update the existing escalate tests** in `tests/listeners/commands/fiona.test.js`. Change the success-confirmation assertion so it no longer expects `#escalation`:

```javascript
    it('sends the channel confirmation on success in a channel', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('escalated') }),
      );
      expect(mockRespond.mock.calls[0][0].text).not.toContain('#escalation');
    });
```

Add a help-text discoverability test inside the existing `describe('fionaCommandCallback', ...)`:

```javascript
  it('lists escalate in the help text', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    await fionaCommandCallback({ command: { user_id: 'U1', channel_id: 'C1', trigger_id: 't', text: 'help' }, ack, logger: mockLogger });
    expect(ack).toHaveBeenCalledWith(expect.stringContaining('/fiona escalate'));
  });
```

- [ ] **Step 2: Run tests to verify the new expectations fail**

Run: `npm test -- tests/listeners/commands/fiona.test.js`
Expected: FAIL — help text lacks `escalate`; confirmation still contains `#escalation`.

- [ ] **Step 3: Edit `src/listeners/commands/fiona.js`:**

Update the imports (lines 6-8):

```javascript
import { postEscalation } from '../../agent/escalation.js';
import { ESCALATION_SOURCES } from '../../agent/escalation-constants.js';
import { recordInteraction } from '../../agent/interaction-store.js';
import { checkRateLimit, rateLimitMessage } from '../../agent/rate-limiter.js';
```

Add an escalate line to `HELP_TEXT` (inside the code-fence block, after the search line):

```
/fiona escalate          Get live help from a human
```

Change `ESCALATE_CONFIRM_TEXT` (line 29-30) to drop the channel name:

```javascript
const ESCALATE_CONFIRM_TEXT = '✅ Your conversation has been escalated. A team member will follow up shortly.';
```

In `handleEscalate`, replace the inline rate-limit message block with the shared helper:

```javascript
  const { allowed, retryAfterMs } = checkRateLimit(command.user_id);
  if (!allowed) {
    await respond({ response_type: 'ephemeral', text: rateLimitMessage(retryAfterMs) });
    recordInteraction({
      ...slashInteractionRecord(command, ESCALATION_SOURCES.SLASH),
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_escalate interaction: ${err.name}`));
    return;
  }
```

Replace the two remaining literal `'slash_escalate'` occurrences (the `postEscalation({ ... source: 'slash_escalate' ... })` call and the error-path `slashInteractionRecord(command, 'slash_escalate')`) with `ESCALATION_SOURCES.SLASH`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/listeners/commands/fiona.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/listeners/commands/fiona.js tests/listeners/commands/fiona.test.js
git commit -m "feat: list escalate in help, share rate-limit text, drop channel name [AI-122]"
```

---

### Task 10: Wire the button + proactive suggestion into the response handlers

**Files:**
- Modify: `src/listeners/events/app_mention.js`
- Modify: `src/listeners/assistant/message.js`
- Test: `tests/listeners/events/app-mention.test.js`, `tests/listeners/assistant/message.test.js`

**Interfaces:**
- Consumes: `isEscalationConfigured`, `maybeSuggestEscalation` (`escalation.js`); `escalateButtonBlock` (`escalate_block.js`).
- Produces: response `stop()` blocks include the escalate button when configured; a fire-and-forget `maybeSuggestEscalation` runs after each answer.

- [ ] **Step 1: Add failing tests.** In `tests/listeners/events/app-mention.test.js`, find where the test file mocks agent modules and add a mock for `escalation.js` (or extend the existing one) exposing `isEscalationConfigured` and `maybeSuggestEscalation`:

```javascript
const mockIsEscalationConfigured = jest.fn().mockReturnValue(true);
const mockMaybeSuggest = jest.fn().mockResolvedValue(false);
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({
  isEscalationConfigured: mockIsEscalationConfigured,
  maybeSuggestEscalation: mockMaybeSuggest,
}));
```

Add assertions to an existing successful-response test (after `streamer.stop` is asserted):

```javascript
    // escalate button is attached when escalation is configured
    const stopArg = mockStreamer.stop.mock.calls.at(-1)[0];
    expect(JSON.stringify(stopArg.blocks)).toContain('Get Live Help');
    // proactive suggestion runs after the answer
    await new Promise((r) => setImmediate(r));
    expect(mockMaybeSuggest).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: expect.any(String), threadTs: expect.any(String) }),
    );
```

> Mirror the same mock + assertions in `tests/listeners/assistant/message.test.js` against its streamer/stop mock.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/listeners/events/app-mention.test.js tests/listeners/assistant/message.test.js`
Expected: FAIL — blocks lack the button; `maybeSuggestEscalation` not called.

- [ ] **Step 3: Edit `src/listeners/events/app_mention.js`.** Add imports near the existing ones:

```javascript
import { isEscalationConfigured, maybeSuggestEscalation } from '../../agent/escalation.js';
import { escalateButtonBlock } from '../views/escalate_block.js';
```

Replace the finalize line `await streamer.stop({ blocks: [feedbackBlock] });` with:

```javascript
      const responseBlocks = isEscalationConfigured() ? [feedbackBlock, escalateButtonBlock] : [feedbackBlock];
      await streamer.stop({ blocks: responseBlocks });
```

After the `await captureConversation({ ... })` call, add the fire-and-forget suggestion:

```javascript
      // Proactively offer live help if Fiona judges it did not resolve the ask.
      // Fire-and-forget: never blocks or fails the response.
      void maybeSuggestEscalation({
        client,
        channelId: channel,
        threadTs: thread_ts,
        history: prompts,
        botText,
        logger,
      });
```

- [ ] **Step 4: Edit `src/listeners/assistant/message.js`** identically: add the same two imports; in the **text-response branch** (the `else` branch, around line 234) replace `await streamer.stop({ blocks: [feedbackBlock] });` with the same `responseBlocks` construction; after its `captureConversation` call add the same `void maybeSuggestEscalation({ client, channelId: channel, threadTs: thread_ts, history: prompts, botText, logger });` block. (Leave the demo `'Wonder a few deep thoughts.'` branch unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/listeners/events/app-mention.test.js tests/listeners/assistant/message.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/listeners/events/app_mention.js src/listeners/assistant/message.js tests/listeners/events/app-mention.test.js tests/listeners/assistant/message.test.js
git commit -m "feat: attach Get Live Help button and run proactive suggestion [AI-122]"
```

---

### Task 11: Docs/JSDoc cleanup and cross-app verification

**Files:**
- Modify: `src/agent/interaction-store.js:139`
- Modify: `src/agent/feedback-store.js` (JSDoc for `value`)
- Verify: `apps/usage-report-function/lib/cosmos-queries.js:150`

- [ ] **Step 1: Update `interaction-store.js` JSDoc** (line 139) to the final taxonomy (drop `auto_escalation`, add button/suggested):

```javascript
 * @param {string} interaction.interactionType - 'app_mention', 'assistant_message', 'slash_help', 'slash_ask', 'slash_search', 'slash_escalate', 'button_escalate', 'suggested_escalate', or 'slash_unknown'
```

- [ ] **Step 2: Update `feedback-store.js` JSDoc** for the `value` param so future query code knows escalation rows exist. Find the `@param {string} feedback.value` line and change it to:

```javascript
 * @param {string} feedback.value - 'good-feedback', 'bad-feedback', or 'escalation'
```

- [ ] **Step 3: Verify the usage-report allow-list still excludes escalation.** Confirm `apps/usage-report-function/lib/cosmos-queries.js:150` reads `f["value"] IN ('good-feedback', 'bad-feedback')` (so `'escalation'` rows are excluded from the feedback response-rate). Add a clarifying comment above that query line:

```javascript
       // Response-rate counts only thumbs feedback; 'escalation' rows are excluded by design.
```

> Scope note: the usage-report function is a separate npm package. Rather than couple it to fiona-slack's `escalation-constants.js`, the allow-list keeps its literal with this comment. No behavior change — `'escalation'` is already excluded.

- [ ] **Step 4: Run the affected suites**

Run (from `apps/fiona-slack/`): `npm test -- tests/agent/interaction-store.test.js tests/agent/feedback-store-cosmos.test.js`
Run (from `apps/usage-report-function/`): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/fiona-slack/src/agent/interaction-store.js apps/fiona-slack/src/agent/feedback-store.js apps/usage-report-function/lib/cosmos-queries.js
git commit -m "docs: align interaction/feedback taxonomy with escalation sources [AI-122]"
```

---

### Task 12: Full suite + lint gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole fiona-slack suite**

Run (from `apps/fiona-slack/`): `npm test`
Expected: PASS (all suites).

- [ ] **Step 2: Lint**

Run (from `apps/fiona-slack/`): `npm run lint`
Expected: no errors. Fix any with `npm run lint:fix`, then re-run tests.

- [ ] **Step 3: Confirm no stale references remain**

Run: `git grep -n "fetchTranscript\|auto_escalation\|conversations.history" apps/fiona-slack/src`
Expected: no matches (the channel-history path and the removed source are gone).

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint and cleanup for escalation redesign [AI-122]"
```

---

## Self-Review

**Spec coverage:**
- Shared `postEscalation`, optional transcript, no channel scraping → Tasks 6.
- `buildThreadHistory` reuse + transcript renderer → Tasks 2, 6.
- Slash command (no transcript, nudge, channel link, DM placeholder, drop `#escalation`, rate-limit share, help text) → Tasks 1, 9, 6.
- Always-present "Get Live Help" button → Tasks 4, 10.
- Proactive async classifier + suggestion → Tasks 5, 7, 10.
- Working permalink guard (`^\d+\.\d+$`) → Task 6.
- Shared constants + taxonomy → Tasks 3, 8, 9, 11.
- Injection hardening (broadcast neutralization, display name) → Tasks 2, 6.
- Slack `<!date^...>` timestamp → Task 6.
- Config gated solely on `ESCALATION_CHANNEL` → Tasks 6, 7, 10.
- Usage-report exclusion preserved → Task 11.
- Process-artifact docs from PR #63 (move out): handled separately at PR cleanup — noted below.

**Placeholder scan:** No TBD/TODO; every code step shows full code.

**Type consistency:** `postEscalation` params, `ESCALATION_SOURCES.*` values, `classifyForEscalation` return shape, and `maybeSuggestEscalation` params are consistent across Tasks 5–10.

**Open follow-up (not a code task):** remove the two large `docs/superpowers/plans/2026-06-22-*.md` PR-#63 artifacts (or move to the PR description) before merge, per the review.
