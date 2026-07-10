# Usage Report Feedback Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Representative Feedback" section to the bottom of the weekly usage report showing up to 5 real feedback examples (question, response, thumb-derived sentiment, restated reason) for the reporting window.

**Architecture:** A new Cosmos query function selects and tiers feedback documents (reason-present first, then reason-less fallback); a new formatter function renders them as plain text in the existing report style; the weekly trigger wires the query into its existing `Promise.all` and passes results to the formatter. The ad-hoc agent skill doc is updated to reference the same functions.

**Tech Stack:** Node.js (ESM), `@azure/cosmos`, Jest (`--experimental-vm-modules`) with `@jest/globals`, Biome lint.

## Global Constraints

- All new JS files must start with the Apache-2.0 SPDX header block (per repo `CLAUDE.md`):
  ```javascript
  // SPDX-License-Identifier: Apache-2.0
  // Licensed to the Ed-Fi Alliance under one or more agreements.
  // The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
  // See the LICENSE and NOTICES files in the project root for more information.
  ```
  (Not needed here — this plan only modifies existing files that already have the header.)
- Truncate `userMessage`, `botResponse`, and `reason` independently to 150 characters each, with `…` appended when truncated.
- Sentiment is derived only from the `value` field (`good-feedback` → `👍 Positive`, `bad-feedback` → `👎 Negative`) — no LLM/NLP classification.
- Selection: reason-present feedback first (most recent first), then reason-less feedback (most recent first), capped at 5 total.
- Fallback (reason-less) items must show `Reason: (no reason provided)` explicitly, not omit the line.
- Zero feedback in window → single line `No feedback recorded for this period.` instead of a numbered list.
- Run tests with: `cd apps/usage-report-function && npm test`

---

### Task 1: Add `getRepresentativeFeedback` query function

**Files:**
- Modify: `apps/usage-report-function/lib/cosmos-queries.js`
- Test: `apps/usage-report-function/test/unit/cosmos-queries.test.js`

**Interfaces:**
- Produces: `getRepresentativeFeedback(container, deploymentType, oneWeekAgoISO, limit = 5)` → `Promise<Array<{ userMessage: string|null, botResponse: string|null, value: string, reason: string|null, timestamp: string, hasReason: boolean }>>`. Consumed by Task 3 (`WeeklyReportTrigger/index.js`).

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `apps/usage-report-function/test/unit/cosmos-queries.test.js`, inside the outer `describe('cosmos-queries', ...)` (add `getRepresentativeFeedback` to the existing import list at the top of the file first):

```javascript
// Add to the existing import from '../../lib/cosmos-queries.js':
//   getRepresentativeFeedback,

describe('getRepresentativeFeedback', () => {
  it('prioritizes entries with a reason over reason-less entries', async () => {
    mockFeedbackContainer.items.query.mockReturnValue({
      fetchAll: jest.fn().mockResolvedValue({
        resources: [
          {
            userMessage: 'no reason newest',
            botResponse: 'resp1',
            value: 'good-feedback',
            reason: null,
            timestamp: '2026-03-16T00:00:00.000Z',
          },
          {
            userMessage: 'has reason',
            botResponse: 'resp2',
            value: 'bad-feedback',
            reason: 'confusing answer',
            timestamp: '2026-03-15T00:00:00.000Z',
          },
        ],
      }),
    });

    const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ userMessage: 'has reason', hasReason: true });
    expect(result[1]).toMatchObject({ userMessage: 'no reason newest', hasReason: false });
  });

  it('fills remaining slots with reason-less entries when fewer than limit have reasons', async () => {
    mockFeedbackContainer.items.query.mockReturnValue({
      fetchAll: jest.fn().mockResolvedValue({
        resources: [
          {
            userMessage: 'reason A',
            botResponse: 'respA',
            value: 'good-feedback',
            reason: 'great',
            timestamp: '2026-03-16T00:00:00.000Z',
          },
          {
            userMessage: 'no reason B',
            botResponse: 'respB',
            value: 'good-feedback',
            reason: null,
            timestamp: '2026-03-15T00:00:00.000Z',
          },
          {
            userMessage: 'no reason C',
            botResponse: 'respC',
            value: 'bad-feedback',
            reason: null,
            timestamp: '2026-03-14T00:00:00.000Z',
          },
        ],
      }),
    });

    const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO, 5);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.userMessage)).toEqual(['reason A', 'no reason B', 'no reason C']);
  });

  it('caps results at the given limit', async () => {
    const resources = Array.from({ length: 8 }, (_, i) => ({
      userMessage: `msg-${i}`,
      botResponse: `resp-${i}`,
      value: 'good-feedback',
      reason: `reason-${i}`,
      timestamp: `2026-03-${10 + i}T00:00:00.000Z`,
    }));
    mockFeedbackContainer.items.query.mockReturnValue({
      fetchAll: jest.fn().mockResolvedValue({ resources }),
    });

    const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO, 5);

    expect(result).toHaveLength(5);
  });

  it('returns an empty array when there is no feedback in the window', async () => {
    mockFeedbackContainer.items.query.mockReturnValue({
      fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
    });

    const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO);

    expect(result).toEqual([]);
  });

  it('passes correct query parameters', async () => {
    mockFeedbackContainer.items.query.mockReturnValue({
      fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
    });

    await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO);

    const [querySpec] = mockFeedbackContainer.items.query.mock.calls[0];
    expect(querySpec.parameters).toContainEqual({ name: '@deploymentType', value: 'production' });
    expect(querySpec.parameters).toContainEqual({ name: '@oneWeekAgoISO', value: oneWeekAgoISO });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/usage-report-function && npm test -- cosmos-queries`
Expected: FAIL — `getRepresentativeFeedback is not a function` (or import error).

- [ ] **Step 3: Implement `getRepresentativeFeedback`**

Add to the end of `apps/usage-report-function/lib/cosmos-queries.js`:

```javascript
/**
 * Returns up to `limit` representative feedback entries for the period,
 * prioritizing entries that have a free-text reason (most recent first),
 * then filling remaining slots with reason-less entries (most recent first).
 */
export async function getRepresentativeFeedback(container, deploymentType, oneWeekAgoISO, limit = 5) {
  const { resources } = await container.items
    .query({
      query: `SELECT f.userMessage, f.botResponse, f["value"], f.reason, f.timestamp
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp > @oneWeekAgoISO
       ORDER BY f.timestamp DESC`,
      parameters: BASE_PARAMS(deploymentType, oneWeekAgoISO),
    })
    .fetchAll();

  const withReason = resources.filter((f) => f.reason);
  const withoutReason = resources.filter((f) => !f.reason);

  return [...withReason, ...withoutReason].slice(0, limit).map((f) => ({
    userMessage: f.userMessage,
    botResponse: f.botResponse,
    value: f.value,
    reason: f.reason ?? null,
    timestamp: f.timestamp,
    hasReason: Boolean(f.reason),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/usage-report-function && npm test -- cosmos-queries`
Expected: PASS (all `getRepresentativeFeedback` tests plus existing tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/usage-report-function/lib/cosmos-queries.js apps/usage-report-function/test/unit/cosmos-queries.test.js
git commit -m "feat: add getRepresentativeFeedback query for usage report"
```

---

### Task 2: Add `formatFeedbackSection` and wire it into `formatWeeklyReport`

**Files:**
- Modify: `apps/usage-report-function/lib/slack-formatter.js`
- Test: `apps/usage-report-function/test/unit/slack-formatter.test.js`

**Interfaces:**
- Consumes: nothing external (pure function over feedback item objects shaped like Task 1's return type: `{ userMessage, botResponse, value, reason, hasReason }`).
- Produces: `formatFeedbackSection(feedbackItems)` → `string`. `formatWeeklyReport(kpis)` now also reads `kpis.representativeFeedback` (array, same shape) and appends the feedback section. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `apps/usage-report-function/test/unit/slack-formatter.test.js` (add `formatFeedbackSection` to the existing import on line 2 first: `import { formatFeedbackSection, formatWeeklyReport } from '../../lib/slack-formatter.js';`):

```javascript
describe('formatFeedbackSection', () => {
  it('shows a fallback message when there is no feedback', () => {
    const section = formatFeedbackSection([]);
    expect(section).toContain('No feedback recorded for this period.');
  });

  it('renders positive sentiment for good-feedback', () => {
    const section = formatFeedbackSection([
      { userMessage: 'How do I reset my password?', botResponse: 'Go to settings.', value: 'good-feedback', reason: 'Clear and fast', hasReason: true },
    ]);
    expect(section).toContain('👍 Positive');
    expect(section).toContain('Q: How do I reset my password?');
    expect(section).toContain('A: Go to settings.');
    expect(section).toContain('Reason: Clear and fast');
  });

  it('renders negative sentiment for bad-feedback', () => {
    const section = formatFeedbackSection([
      { userMessage: 'Why did this fail?', botResponse: 'Unclear error.', value: 'bad-feedback', reason: null, hasReason: false },
    ]);
    expect(section).toContain('👎 Negative');
  });

  it('flags fallback items with no reason provided', () => {
    const section = formatFeedbackSection([
      { userMessage: 'q', botResponse: 'a', value: 'good-feedback', reason: null, hasReason: false },
    ]);
    expect(section).toContain('Reason: (no reason provided)');
  });

  it('truncates question, response, and reason to 150 characters', () => {
    const long = 'x'.repeat(200);
    const section = formatFeedbackSection([
      { userMessage: long, botResponse: long, value: 'good-feedback', reason: long, hasReason: true },
    ]);
    const truncated = `${'x'.repeat(150)}…`;
    expect(section).toContain(`Q: ${truncated}`);
    expect(section).toContain(`A: ${truncated}`);
    expect(section).toContain(`Reason: ${truncated}`);
  });

  it('numbers multiple items in order', () => {
    const section = formatFeedbackSection([
      { userMessage: 'first', botResponse: 'r1', value: 'good-feedback', reason: 'r', hasReason: true },
      { userMessage: 'second', botResponse: 'r2', value: 'bad-feedback', reason: null, hasReason: false },
    ]);
    expect(section).toContain('1. 👍 Positive');
    expect(section).toContain('2. 👎 Negative');
  });
});

describe('formatWeeklyReport with representativeFeedback', () => {
  it('appends the representative feedback section', () => {
    const message = formatWeeklyReport({
      ...baseKpis,
      representativeFeedback: [
        { userMessage: 'How do I do X?', botResponse: 'Here is how.', value: 'good-feedback', reason: 'Helpful', hasReason: true },
      ],
    });
    expect(message).toContain('Representative Feedback');
    expect(message).toContain('How do I do X?');
  });

  it('shows the no-feedback message when representativeFeedback is empty', () => {
    const message = formatWeeklyReport({ ...baseKpis, representativeFeedback: [] });
    expect(message).toContain('No feedback recorded for this period.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/usage-report-function && npm test -- slack-formatter`
Expected: FAIL — `formatFeedbackSection is not a function`, and the `formatWeeklyReport with representativeFeedback` tests fail because the section isn't rendered.

- [ ] **Step 3: Implement `formatFeedbackSection` and wire it in**

In `apps/usage-report-function/lib/slack-formatter.js`, add a truncate helper and the new function above `formatWeeklyReport`, and call it from `formatWeeklyReport`:

```javascript
function truncate(text, maxLength = 150) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * Formats up to 5 representative feedback entries as plain text.
 *
 * @param {Array<{ userMessage: string|null, botResponse: string|null, value: string, reason: string|null, hasReason: boolean }>} feedbackItems
 * @returns {string}
 */
export function formatFeedbackSection(feedbackItems) {
  if (!feedbackItems || feedbackItems.length === 0) {
    return ['📋 *Representative Feedback*', 'No feedback recorded for this period.'].join('\n');
  }

  const lines = ['📋 *Representative Feedback*'];
  feedbackItems.forEach((item, index) => {
    const sentimentLabel = item.value === 'good-feedback' ? '👍 Positive' : '👎 Negative';
    lines.push(`${index + 1}. ${sentimentLabel}`);
    lines.push(`   Q: ${truncate(item.userMessage)}`);
    lines.push(`   A: ${truncate(item.botResponse)}`);
    lines.push(`   Reason: ${item.hasReason ? truncate(item.reason) : '(no reason provided)'}`);
  });

  return lines.join('\n');
}
```

Update the `formatWeeklyReport` destructuring and return to include the feedback section. Change:

```javascript
    environment,
    startDate,
    endDate,
  } = kpis;
```

to:

```javascript
    environment,
    startDate,
    endDate,
    representativeFeedback,
  } = kpis;
```

And change the final `return [ ... ].join('\n');` block from:

```javascript
    `_Environment: ${environment} | Generated by Fiona Analytics_`,
  ].join('\n');
```

to:

```javascript
    `_Environment: ${environment} | Generated by Fiona Analytics_`,
    '',
    formatFeedbackSection(representativeFeedback),
  ].join('\n');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/usage-report-function && npm test -- slack-formatter`
Expected: PASS (all new and existing tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/usage-report-function/lib/slack-formatter.js apps/usage-report-function/test/unit/slack-formatter.test.js
git commit -m "feat: render representative feedback section in weekly report"
```

---

### Task 3: Wire `getRepresentativeFeedback` into `WeeklyReportTrigger`

**Files:**
- Modify: `apps/usage-report-function/WeeklyReportTrigger/index.js`
- Test: `apps/usage-report-function/test/unit/weekly-report-trigger.test.js`

**Interfaces:**
- Consumes: `getRepresentativeFeedback(container, deploymentType, oneWeekAgoISO, limit = 5)` from Task 1; `formatWeeklyReport(kpis)` (now reading `kpis.representativeFeedback`) from Task 2.

- [ ] **Step 1: Write the failing tests**

In `apps/usage-report-function/test/unit/weekly-report-trigger.test.js`:

1. Add a new mock function near the other `mockGet*` declarations (after `const mockGetNewUsersCount = jest.fn();`):

```javascript
const mockGetRepresentativeFeedback = jest.fn();
```

2. Add it to the `jest.unstable_mockModule('../../lib/cosmos-queries.js', ...)` mock object:

```javascript
jest.unstable_mockModule('../../lib/cosmos-queries.js', () => ({
  getDistinctUsers: mockGetDistinctUsers,
  getSessionCount: mockGetSessionCount,
  getTotalInteractions: mockGetTotalInteractions,
  getErrorCount: mockGetErrorCount,
  getRateLimitedCount: mockGetRateLimitedCount,
  getFeedbackBreakdown: mockGetFeedbackBreakdown,
  getAvgInteractionsPerUser: mockGetAvgInteractionsPerUser,
  getFeedbackResponseRate: mockGetFeedbackResponseRate,
  getNewUsersCount: mockGetNewUsersCount,
  getRepresentativeFeedback: mockGetRepresentativeFeedback,
}));
```

3. In the `handler` `describe` block's `beforeEach`, add a default resolved value alongside the other `mockGet*.mockResolvedValue(...)` calls:

```javascript
      mockGetRepresentativeFeedback.mockResolvedValue([
        {
          userMessage: 'How do I reset my password?',
          botResponse: 'Go to settings.',
          value: 'good-feedback',
          reason: 'Clear and fast',
          hasReason: true,
        },
      ]);
```

4. Update the existing `'passes all 9 KPI queries to Promise.all'` test to also assert the new query, and rename it to reflect the new count:

```javascript
    it('passes all 10 KPI queries to Promise.all', async () => {
      await handler({}, context);
      expect(mockGetDistinctUsers).toHaveBeenCalledTimes(1);
      expect(mockGetSessionCount).toHaveBeenCalledTimes(1);
      expect(mockGetTotalInteractions).toHaveBeenCalledTimes(1);
      expect(mockGetErrorCount).toHaveBeenCalledTimes(1);
      expect(mockGetRateLimitedCount).toHaveBeenCalledTimes(1);
      expect(mockGetFeedbackBreakdown).toHaveBeenCalledTimes(1);
      expect(mockGetAvgInteractionsPerUser).toHaveBeenCalledTimes(1);
      expect(mockGetFeedbackResponseRate).toHaveBeenCalledTimes(1);
      expect(mockGetNewUsersCount).toHaveBeenCalledTimes(1);
      expect(mockGetRepresentativeFeedback).toHaveBeenCalledTimes(1);
    });
```

5. Add a new test after the `'passes all KPI values to formatWeeklyReport'` test:

```javascript
    it('passes representativeFeedback through to formatWeeklyReport', async () => {
      await handler({}, context);

      const [kpis] = mockFormatWeeklyReport.mock.calls[0];
      expect(kpis.representativeFeedback).toEqual([
        {
          userMessage: 'How do I reset my password?',
          botResponse: 'Go to settings.',
          value: 'good-feedback',
          reason: 'Clear and fast',
          hasReason: true,
        },
      ]);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/usage-report-function && npm test -- weekly-report-trigger`
Expected: FAIL — `mockGetRepresentativeFeedback` never called (function not wired into `index.js` yet), and `kpis.representativeFeedback` is `undefined`.

- [ ] **Step 3: Wire the query into `WeeklyReportTrigger/index.js`**

Update the import block (add `getRepresentativeFeedback` alphabetically):

```javascript
import {
  getAvgInteractionsPerUser,
  getDistinctUsers,
  getErrorCount,
  getFeedbackBreakdown,
  getFeedbackResponseRate,
  getNewUsersCount,
  getRateLimitedCount,
  getRepresentativeFeedback,
  getSessionCount,
  getTotalInteractions,
} from '../lib/cosmos-queries.js';
```

Update the `Promise.all` destructuring and call list:

```javascript
      const [
        distinctUsers,
        sessionCount,
        totalInteractions,
        errorCount,
        rateLimitedCount,
        feedbackBreakdown,
        avgInteractionsPerUser,
        feedbackResponseRate,
        newUsersCount,
        representativeFeedback,
      ] = await Promise.all([
        getDistinctUsers(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getSessionCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getTotalInteractions(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getErrorCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getRateLimitedCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getFeedbackBreakdown(feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getAvgInteractionsPerUser(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getFeedbackResponseRate(interactionsContainer, feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getNewUsersCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getRepresentativeFeedback(feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
      ]);
```

Add `representativeFeedback` to the `kpis` object:

```javascript
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
        newUsersCount,
        newUserPercentage,
        returningUsersCount,
        repeatRate,
        environment: DEPLOYMENT_TYPE,
        startDate: oneWeekAgo.toISOString().split('T')[0],
        endDate: endOfReport.toISOString().split('T')[0],
        representativeFeedback,
      };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/usage-report-function && npm test -- weekly-report-trigger`
Expected: PASS (all tests in the file, including the renamed/updated ones).

- [ ] **Step 5: Run the full test suite for the function app**

Run: `cd apps/usage-report-function && npm test`
Expected: PASS — all suites (`cosmos-queries`, `slack-formatter`, `weekly-report-trigger`) green.

- [ ] **Step 6: Commit**

```bash
git add apps/usage-report-function/WeeklyReportTrigger/index.js apps/usage-report-function/test/unit/weekly-report-trigger.test.js
git commit -m "feat: include representative feedback in weekly report trigger"
```

---

### Task 4: Update the ad-hoc agent skill doc

**Files:**
- Modify: `.github/agents/azure-usage-report.agent.md`

**Interfaces:**
- None (documentation only). Consumes Task 1–3's function names to reference them accurately.

- [ ] **Step 1: Update the Scope KPI list**

In `.github/agents/azure-usage-report.agent.md`, change the `## Scope` bullet list to add a new line after `feedback response rate`:

```markdown
  - feedback response rate
  - 5 representative feedback examples (question, response, thumb-derived sentiment, restated reason) when a weekly-style report is requested
```

- [ ] **Step 2: Update the Ground Rules reuse list**

No file path changes needed — `getRepresentativeFeedback` lives in the already-listed `apps/usage-report-function/lib/cosmos-queries.js`, and `formatFeedbackSection` lives in the already-listed `apps/usage-report-function/lib/slack-formatter.js`. Add one clarifying ground rule after the existing rule 4:

```markdown
5. When representative feedback is requested, reuse `getRepresentativeFeedback` and `formatFeedbackSection` rather than re-deriving sentiment or re-selecting examples — sentiment is always the raw thumbs rating restated (good-feedback → Positive, bad-feedback → Negative), never LLM-classified.
```

Renumber the old rule 5 (`Never post to Slack unless explicitly requested.`) to rule 6.

- [ ] **Step 3: Verify the file is well-formed**

Run: `cat .github/agents/azure-usage-report.agent.md` (or open in editor) and confirm:
- Frontmatter is unchanged and still valid YAML.
- The Ground Rules list is numbered 1–6 with no gaps or duplicates.

- [ ] **Step 4: Commit**

```bash
git add .github/agents/azure-usage-report.agent.md
git commit -m "docs: document representative feedback in usage report agent skill"
```

---

### Task 5: Update the PRD

**Files:**
- Modify: `docs/fiona-slack-prd.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Locate and update the §2.8 Weekly Usage Report KPI table**

Open `docs/fiona-slack-prd.md`. Around line 313, the KPI table in section `### 2.8 Weekly Usage Report` ends with:

```markdown
| Feedback response rate  | Percentage of successful interactions that were rated    |
```

Add a new row directly after it (table has two columns, `Metric` and `Description`; JIRA references are inlined in the Description column in parentheses, matching the `New users` and `Returning users` rows above it):

```markdown
| Representative feedback | Up to 5 feedback examples (question, response, thumb-derived sentiment, restated reason), prioritizing entries with a reason, then most-recent reason-less entries (AI-141) |
```

So the table becomes:

```markdown
| Metric                  | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| Distinct users          | Count of unique users with successful interactions       |
| New users (count & %)   | Distinct users in the window with no prior successful interaction, and their share of distinct users (`newUsersCount / distinctUsers * 100`) (AI-141) |
| Returning users & repeat rate | Derived, not queried: `distinctUsers - newUsersCount` and `100 - newUserPercentage` (AI-141) |
| Sessions                | Count of distinct session identifiers (`threadTs`) across successful, non-rate-limited interactions |
| Total interactions      | All interactions (success + error) in the window         |
| Error count & rate      | Absolute count and percentage of errored interactions    |
| Rate-limited hits       | Count of rate-limiter blocks                             |
| Good / bad feedback     | Feedback button click counts                             |
| Feedback ratio          | `good / (good + bad) * 100`                              |
| Avg interactions / user | Mean interactions per active user                        |
| Feedback response rate  | Percentage of successful interactions that were rated    |
| Representative feedback | Up to 5 feedback examples (question, response, thumb-derived sentiment, restated reason), prioritizing entries with a reason, then most-recent reason-less entries (AI-141) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/fiona-slack-prd.md
git commit -m "docs: document representative feedback KPI in usage report PRD (AI-141)"
```

---

## Self-Review Notes

- **Spec coverage:** Data selection (Task 1), sentiment (Task 2), formatting (Task 2), integration points 1–3 (Tasks 1–3), integration point 4 (Task 4), testing (Tasks 1–3), PRD documentation (Task 5, matching prior AI-141 commit pattern) — all covered.
- **Type consistency:** `getRepresentativeFeedback` return shape (`userMessage`, `botResponse`, `value`, `reason`, `timestamp`, `hasReason`) matches what `formatFeedbackSection` consumes in Task 2 and what the trigger test asserts in Task 3.
- **No placeholders:** all steps contain concrete code/commands.
