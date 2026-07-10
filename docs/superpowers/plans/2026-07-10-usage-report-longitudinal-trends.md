# Weekly Longitudinal Trend Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `getWeeklyTrendSeries` query helper and `formatLongitudinalReport` formatter to the usage-report-function codebase so multi-week ("how has usage trended") requests can be answered without the manual Jupyter notebook process, and teach the `azure-usage-report` agent skill when to use it.

**Architecture:** Two new raw-document queries (one per Cosmos container) fetch all interaction/feedback records for the requested date range in a single round trip each, plus one bounded prior-history query for new/returning-user detection. All bucketing into Monday–Sunday weeks, KPI math, and week-over-week deltas happen in JS, not in Cosmos. A new formatter renders the resulting week array as Slack-style text, one block per week. The agent skill is updated to route multi-week requests to this new path instead of looping the existing single-window helpers.

**Tech Stack:** Node.js (ES modules), `@azure/cosmos`, Jest (`@jest/globals`), existing `apps/usage-report-function` conventions.

## Global Constraints

- New JS files must start with the Apache-2.0 SPDX license header (see `CLAUDE.md`):
  ```javascript
  // SPDX-License-Identifier: Apache-2.0
  // Licensed to the Ed-Fi Alliance under one or more agreements.
  // The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
  // See the LICENSE and NOTICES files in the project root for more information.
  ```
- Reuse existing query/formatter conventions from `apps/usage-report-function/lib/cosmos-queries.js` and `lib/slack-formatter.js` — same parameterized-query style, same mock-container test pattern.
- No new deployed Azure Function / HTTP trigger — this phase is library code only, consumed by the agent skill ad hoc (per `docs/usage-report/2026-07-10-usage-report-longitudinal-trends-design.md`).
- PDF rendering is explicitly out of scope for this plan.

---

### Task 1: `getWeeklyTrendSeries` query helper

**Files:**
- Create: `apps/usage-report-function/lib/longitudinal-queries.js`
- Test: `apps/usage-report-function/test/unit/longitudinal-queries.test.js`

**Interfaces:**
- Produces: `getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO) => Promise<Array<WeekTrend>>`, where `WeekTrend` is:
  ```
  {
    weekStart: string,       // 'YYYY-MM-DD', Monday
    weekEnd: string,         // 'YYYY-MM-DD', Sunday
    uniqueUsers: number,
    sessions: number,
    totalInteractions: number,
    errors: number,
    errorRate: number,       // 0-100, unrounded
    rateLimited: number,
    goodFeedback: number,
    badFeedback: number,
    feedbackRatio: number,   // 0-100, unrounded
    avgInteractionsPerUser: number,
    feedbackResponseRate: number, // 0-100, unrounded
    newUsers: number,
    returningUsers: number,
    repeatRate: number,      // 0-100, unrounded
    usersWowPct: number | null,
    interactionsWowPct: number | null,
    errorRateWowPp: number | null,
  }
  ```
  Weeks are ordered oldest to newest. Only weeks with at least one interaction or feedback record are included. The first week in the returned array always has `usersWowPct`, `interactionsWowPct`, and `errorRateWowPp` set to `null` (no prior week to diff against).

- [ ] **Step 1: Write the failing test suite**

Create `apps/usage-report-function/test/unit/longitudinal-queries.test.js`:

```javascript
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getWeeklyTrendSeries } from '../../lib/longitudinal-queries.js';

describe('getWeeklyTrendSeries', () => {
  let mockInteractionsContainer;
  let mockFeedbackContainer;

  const deploymentType = 'production';
  const startISO = '2026-04-13T00:00:00.000Z';
  const endISO = '2026-04-27T00:00:00.000Z';

  const makeQueryable = (resourcesList) => {
    const query = jest.fn();
    for (const resources of resourcesList) {
      query.mockReturnValueOnce({ fetchAll: jest.fn().mockResolvedValue({ resources }) });
    }
    return { items: { query } };
  };

  const weekAInteractions = [
    { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-04-13T10:00:00.000Z' },
    { userId: 'u1', threadTs: 't1', status: 'success', rateLimited: false, timestamp: '2026-04-14T10:00:00.000Z' },
    { userId: 'u2', threadTs: 't2', status: 'error', rateLimited: false, timestamp: '2026-04-15T10:00:00.000Z' },
  ];
  const weekBInteractions = [
    { userId: 'u1', threadTs: 't3', status: 'success', rateLimited: false, timestamp: '2026-04-21T10:00:00.000Z' },
    { userId: 'u3', threadTs: 't4', status: 'success', rateLimited: false, timestamp: '2026-04-22T10:00:00.000Z' },
    { userId: 'u4', threadTs: 't5', status: 'success', rateLimited: false, timestamp: '2026-04-23T10:00:00.000Z' },
  ];
  const allInteractions = [...weekAInteractions, ...weekBInteractions];

  const weekAFeedback = [{ value: 'good-feedback', timestamp: '2026-04-13T12:00:00.000Z' }];
  const weekBFeedback = [{ value: 'bad-feedback', timestamp: '2026-04-22T12:00:00.000Z' }];
  const allFeedback = [...weekAFeedback, ...weekBFeedback];

  beforeEach(() => {
    mockFeedbackContainer = makeQueryable([allFeedback]);
  });

  it('buckets interactions/feedback into Monday-Sunday weeks, oldest to newest', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const weeks = await getWeeklyTrendSeries(mockInteractionsContainer, mockFeedbackContainer, deploymentType, startISO, endISO);

    expect(weeks).toHaveLength(2);
    expect(weeks[0].weekStart).toBe('2026-04-13');
    expect(weeks[0].weekEnd).toBe('2026-04-19');
    expect(weeks[1].weekStart).toBe('2026-04-20');
    expect(weeks[1].weekEnd).toBe('2026-04-26');
  });

  it('counts uniqueUsers/sessions from success+non-rate-limited records only, but totalInteractions/errors from all records', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA] = await getWeeklyTrendSeries(mockInteractionsContainer, mockFeedbackContainer, deploymentType, startISO, endISO);

    expect(weekA.uniqueUsers).toBe(1); // only u1 (u2's record errored)
    expect(weekA.sessions).toBe(1); // only t1
    expect(weekA.totalInteractions).toBe(3); // includes u2's errored record
    expect(weekA.errors).toBe(1);
    expect(weekA.errorRate).toBeCloseTo(33.333, 2);
    expect(weekA.rateLimited).toBe(0);
  });

  it('computes avgInteractionsPerUser as successful records divided by distinct successful users', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA] = await getWeeklyTrendSeries(mockInteractionsContainer, mockFeedbackContainer, deploymentType, startISO, endISO);

    expect(weekA.avgInteractionsPerUser).toBe(2); // u1 has 2 successful records, 1 distinct user
  });

  it('computes feedbackRatio and feedbackResponseRate per week', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA, weekB] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weekA.goodFeedback).toBe(1);
    expect(weekA.badFeedback).toBe(0);
    expect(weekA.feedbackRatio).toBe(100);
    expect(weekA.feedbackResponseRate).toBe(50); // 1 feedback / 2 successful records

    expect(weekB.goodFeedback).toBe(0);
    expect(weekB.badFeedback).toBe(1);
    expect(weekB.feedbackRatio).toBe(0);
    expect(weekB.feedbackResponseRate).toBeCloseTo(33.333, 2); // 1 feedback / 3 successful records
  });

  it('classifies new vs returning users using first-seen-in-range and prior-to-range history', async () => {
    // Prior-history query (2nd interactions-container call) reports u4 as seen before the range.
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA, weekB] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    // Week A: only u1 is active, and has no prior-to-range history -> new.
    expect(weekA.newUsers).toBe(1);
    expect(weekA.returningUsers).toBe(0);
    expect(weekA.repeatRate).toBe(0);

    // Week B: u1 returns (first seen week A) and u4 returns (prior-to-range history);
    // u3 is genuinely new (first seen week B, no prior history).
    expect(weekB.uniqueUsers).toBe(3);
    expect(weekB.newUsers).toBe(1);
    expect(weekB.returningUsers).toBe(2);
    expect(weekB.repeatRate).toBeCloseTo(66.667, 2);
  });

  it('computes week-over-week deltas, with null for the first week', async () => {
    mockInteractionsContainer = makeQueryable([allInteractions, ['u4']]);

    const [weekA, weekB] = await getWeeklyTrendSeries(
      mockInteractionsContainer,
      mockFeedbackContainer,
      deploymentType,
      startISO,
      endISO,
    );

    expect(weekA.usersWowPct).toBeNull();
    expect(weekA.interactionsWowPct).toBeNull();
    expect(weekA.errorRateWowPp).toBeNull();

    expect(weekB.usersWowPct).toBe(200); // (3 - 1) / 1 * 100
    expect(weekB.interactionsWowPct).toBe(0); // (3 - 3) / 3 * 100
    expect(weekB.errorRateWowPp).toBeCloseTo(-33.333, 2); // 0 - 33.333
  });

  it('only queries prior-history for users who actually appear in the range', async () => {
    mockInteractionsContainer = makeQueryable([[], []]);
    mockFeedbackContainer = makeQueryable([[]]);

    const weeks = await getWeeklyTrendSeries(mockInteractionsContainer, mockFeedbackContainer, deploymentType, startISO, endISO);

    expect(weeks).toEqual([]);
    expect(mockInteractionsContainer.items.query).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/usage-report-function && npx jest test/unit/longitudinal-queries.test.js`
Expected: FAIL — `Cannot find module '../../lib/longitudinal-queries.js'`

- [ ] **Step 3: Implement `lib/longitudinal-queries.js`**

Create `apps/usage-report-function/lib/longitudinal-queries.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getWeekStartISO(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday));
  return monday.toISOString().split('T')[0];
}

function getWeekEndISO(weekStartISO) {
  const start = new Date(`${weekStartISO}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  return end.toISOString().split('T')[0];
}

function createWeekBucket() {
  return {
    totalInteractions: 0,
    errors: 0,
    rateLimited: 0,
    successRecords: 0,
    successUserIds: new Set(),
    successThreadTs: new Set(),
    goodFeedback: 0,
    badFeedback: 0,
    feedbackCount: 0,
  };
}

/**
 * Returns week-over-week KPI trend data for [startISO, endISO), bucketed into
 * Monday-Sunday weeks. Fetches raw interaction/feedback documents for the
 * full range in two queries (plus one bounded prior-history query for
 * new/returning-user detection), so query cost stays flat regardless of how
 * many weeks the range spans.
 *
 * @returns {Promise<Array<Object>>} weeks ordered oldest to newest
 */
export async function getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO) {
  const { resources: interactions } = await interactionsContainer.items
    .query({
      query: `SELECT i.userId, i.threadTs, i.status, i.rateLimited, i.timestamp
       FROM interactions i
       WHERE i.deploymentType = @deploymentType
         AND i.timestamp >= @startISO
         AND i.timestamp < @endISO`,
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@startISO', value: startISO },
        { name: '@endISO', value: endISO },
      ],
    })
    .fetchAll();

  const { resources: feedback } = await feedbackContainer.items
    .query({
      query: `SELECT f["value"] AS value, f.timestamp
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp >= @startISO
         AND f.timestamp < @endISO`,
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@startISO', value: startISO },
        { name: '@endISO', value: endISO },
      ],
    })
    .fetchAll();

  const weekBuckets = new Map();
  const successUsersByWeek = new Map();

  const ensureWeekBucket = (weekKey) => {
    if (!weekBuckets.has(weekKey)) {
      weekBuckets.set(weekKey, createWeekBucket());
      successUsersByWeek.set(weekKey, new Set());
    }
    return weekBuckets.get(weekKey);
  };

  for (const record of interactions) {
    const weekKey = getWeekStartISO(record.timestamp);
    const bucket = ensureWeekBucket(weekKey);
    bucket.totalInteractions += 1;
    if (record.status === 'error') {
      bucket.errors += 1;
    }
    if (record.rateLimited === true) {
      bucket.rateLimited += 1;
    }
    if (record.status === 'success' && record.rateLimited === false) {
      bucket.successRecords += 1;
      bucket.successUserIds.add(record.userId);
      bucket.successThreadTs.add(record.threadTs);
      successUsersByWeek.get(weekKey).add(record.userId);
    }
  }

  for (const record of feedback) {
    const weekKey = getWeekStartISO(record.timestamp);
    const bucket = ensureWeekBucket(weekKey);
    bucket.feedbackCount += 1;
    if (record.value === 'good-feedback') {
      bucket.goodFeedback += 1;
    } else if (record.value === 'bad-feedback') {
      bucket.badFeedback += 1;
    }
  }

  const sortedWeekKeys = [...weekBuckets.keys()].sort();

  const firstWeekSeenByUser = new Map();
  for (const weekKey of sortedWeekKeys) {
    for (const userId of successUsersByWeek.get(weekKey)) {
      if (!firstWeekSeenByUser.has(userId)) {
        firstWeekSeenByUser.set(userId, weekKey);
      }
    }
  }

  const currentUsers = [
    ...new Set(
      interactions.filter((record) => record.status === 'success' && record.rateLimited === false).map((record) => record.userId),
    ),
  ];

  let priorHistoryUsers = new Set();
  if (currentUsers.length > 0) {
    const { resources: priorUsers } = await interactionsContainer.items
      .query({
        query: `SELECT DISTINCT VALUE i.userId
         FROM interactions i
         WHERE i.deploymentType = @deploymentType
           AND i.timestamp < @startISO
           AND i.status = 'success'
           AND i.rateLimited = false
           AND ARRAY_CONTAINS(@currentUsers, i.userId)`,
        parameters: [
          { name: '@deploymentType', value: deploymentType },
          { name: '@startISO', value: startISO },
          { name: '@currentUsers', value: currentUsers },
        ],
      })
      .fetchAll();
    priorHistoryUsers = new Set(priorUsers);
  }

  let prevWeek = null;
  return sortedWeekKeys.map((weekKey) => {
    const bucket = weekBuckets.get(weekKey);
    const uniqueUsers = bucket.successUserIds.size;
    const sessions = bucket.successThreadTs.size;
    const errorRate = bucket.totalInteractions > 0 ? (bucket.errors / bucket.totalInteractions) * 100 : 0;
    const avgInteractionsPerUser = uniqueUsers > 0 ? bucket.successRecords / uniqueUsers : 0;
    const feedbackRatio =
      bucket.goodFeedback + bucket.badFeedback > 0 ? (bucket.goodFeedback / (bucket.goodFeedback + bucket.badFeedback)) * 100 : 0;
    const feedbackResponseRate = bucket.successRecords > 0 ? (bucket.feedbackCount / bucket.successRecords) * 100 : 0;

    let newUsers = 0;
    for (const userId of successUsersByWeek.get(weekKey)) {
      if (firstWeekSeenByUser.get(userId) === weekKey && !priorHistoryUsers.has(userId)) {
        newUsers += 1;
      }
    }
    const returningUsers = uniqueUsers - newUsers;
    const repeatRate = uniqueUsers > 0 ? (returningUsers / uniqueUsers) * 100 : 0;

    const usersWowPct = prevWeek && prevWeek.uniqueUsers > 0 ? ((uniqueUsers - prevWeek.uniqueUsers) / prevWeek.uniqueUsers) * 100 : null;
    const interactionsWowPct =
      prevWeek && prevWeek.totalInteractions > 0
        ? ((bucket.totalInteractions - prevWeek.totalInteractions) / prevWeek.totalInteractions) * 100
        : null;
    const errorRateWowPp = prevWeek ? errorRate - prevWeek.errorRate : null;

    const week = {
      weekStart: weekKey,
      weekEnd: getWeekEndISO(weekKey),
      uniqueUsers,
      sessions,
      totalInteractions: bucket.totalInteractions,
      errors: bucket.errors,
      errorRate,
      rateLimited: bucket.rateLimited,
      goodFeedback: bucket.goodFeedback,
      badFeedback: bucket.badFeedback,
      feedbackRatio,
      avgInteractionsPerUser,
      feedbackResponseRate,
      newUsers,
      returningUsers,
      repeatRate,
      usersWowPct,
      interactionsWowPct,
      errorRateWowPp,
    };

    prevWeek = week;
    return week;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/usage-report-function && npx jest test/unit/longitudinal-queries.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/usage-report-function/lib/longitudinal-queries.js apps/usage-report-function/test/unit/longitudinal-queries.test.js
git commit -m "feat: add getWeeklyTrendSeries query for longitudinal usage trends"
```

---

### Task 2: `formatLongitudinalReport` formatter

**Files:**
- Modify: `apps/usage-report-function/lib/slack-formatter.js`
- Test: `apps/usage-report-function/test/unit/slack-formatter.test.js`

**Interfaces:**
- Consumes: `WeekTrend` objects as produced by `getWeeklyTrendSeries` (Task 1) — `weekStart`, `weekEnd`, `uniqueUsers`, `sessions`, `totalInteractions`, `errors`, `errorRate`, `rateLimited`, `goodFeedback`, `badFeedback`, `feedbackRatio`, `avgInteractionsPerUser`, `feedbackResponseRate`, `newUsers`, `returningUsers`, `repeatRate`, `usersWowPct`, `interactionsWowPct`, `errorRateWowPp`.
- Produces: `formatLongitudinalReport(weeklySeries, { deploymentType, startDate, endDate }) => string`. Also exports the previously-internal `formatWeekLabel(startDate, endDate) => string` so this function can reuse it.

- [ ] **Step 1: Write the failing tests**

Add to `apps/usage-report-function/test/unit/slack-formatter.test.js` (new `import` and new `describe` block — append at the end of the file):

```javascript
import { formatFeedbackSection, formatLongitudinalReport, formatWeeklyReport } from '../../lib/slack-formatter.js';
```

Replace the existing import line at the top of the file with the one above, then append this block at the end of the file:

```javascript
describe('formatLongitudinalReport', () => {
  const weekA = {
    weekStart: '2026-04-13',
    weekEnd: '2026-04-19',
    uniqueUsers: 1,
    sessions: 1,
    totalInteractions: 3,
    errors: 1,
    errorRate: 33.333,
    rateLimited: 0,
    goodFeedback: 1,
    badFeedback: 0,
    feedbackRatio: 100,
    avgInteractionsPerUser: 2,
    feedbackResponseRate: 50,
    newUsers: 1,
    returningUsers: 0,
    repeatRate: 0,
    usersWowPct: null,
    interactionsWowPct: null,
    errorRateWowPp: null,
  };

  const weekB = {
    weekStart: '2026-04-20',
    weekEnd: '2026-04-26',
    uniqueUsers: 3,
    sessions: 3,
    totalInteractions: 3,
    errors: 0,
    errorRate: 0,
    rateLimited: 0,
    goodFeedback: 0,
    badFeedback: 1,
    feedbackRatio: 0,
    avgInteractionsPerUser: 1,
    feedbackResponseRate: 33.333,
    newUsers: 1,
    returningUsers: 2,
    repeatRate: 66.667,
    usersWowPct: 200,
    interactionsWowPct: 0,
    errorRateWowPp: -33.333,
  };

  const options = { deploymentType: 'production', startDate: '2026-04-13', endDate: '2026-04-26' };

  it('includes a header with the date range and environment', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    expect(message).toContain('Longitudinal Usage Trends');
    expect(message).toContain('Apr 13–26, 2026');
    expect(message).toContain('production');
  });

  it('renders one block per week with its own week label', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    expect(message).toContain('Week of Apr 13–19, 2026');
    expect(message).toContain('Week of Apr 20–26, 2026');
  });

  it('includes new/returning users and repeat rate on the unique users line', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    expect(message).toContain('Unique users: 1 (🆕 1 new, 🔁 0 returning, 0.0% repeat rate)');
    expect(message).toContain('Unique users: 3 (🆕 1 new, 🔁 2 returning, 66.7% repeat rate)');
  });

  it('omits the WoW line for the first week and includes it for subsequent weeks', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    const weekABlockEnd = message.indexOf('Week of Apr 20');
    const weekABlock = message.slice(0, weekABlockEnd);
    expect(weekABlock).not.toContain('WoW:');
    expect(message).toContain('WoW: +200.0% users, +0.0% interactions, -33.3pp error rate');
  });

  it('shows a no-data message when the series is empty', () => {
    const message = formatLongitudinalReport([], options);
    expect(message).toContain('No interaction data recorded for this period.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/usage-report-function && npx jest test/unit/slack-formatter.test.js`
Expected: FAIL — `formatLongitudinalReport is not a function` (import error)

- [ ] **Step 3: Implement `formatLongitudinalReport` in `lib/slack-formatter.js`**

In `apps/usage-report-function/lib/slack-formatter.js`, change the existing (non-exported) `formatWeekLabel` declaration:

```javascript
function formatWeekLabel(startDate, endDate) {
```

to:

```javascript
export function formatWeekLabel(startDate, endDate) {
```

Then append this to the end of the file:

```javascript
/**
 * Formats week-over-week trend data (from getWeeklyTrendSeries) as a Slack
 * message string — one block per week, oldest to newest.
 *
 * @param {Array<Object>} weeklySeries
 * @param {Object} options
 * @param {string} options.deploymentType
 * @param {string} options.startDate  ISO date string (YYYY-MM-DD)
 * @param {string} options.endDate    ISO date string (YYYY-MM-DD)
 * @returns {string}
 */
export function formatLongitudinalReport(weeklySeries, { deploymentType, startDate, endDate }) {
  const rangeLabel = formatWeekLabel(startDate, endDate);
  const header = [`📈 *Fiona Longitudinal Usage Trends* — ${rangeLabel}`, `_Environment: ${deploymentType}_`, ''];

  if (!weeklySeries || weeklySeries.length === 0) {
    return [...header, 'No interaction data recorded for this period.'].join('\n');
  }

  const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;

  const blocks = weeklySeries.map((week) => {
    const weekLabel = formatWeekLabel(week.weekStart, week.weekEnd);
    const lines = [
      `📊 *Week of ${weekLabel}*`,
      `👤 Unique users: ${week.uniqueUsers} (🆕 ${week.newUsers} new, 🔁 ${week.returningUsers} returning, ${week.repeatRate.toFixed(1)}% repeat rate)`,
      `💬 Sessions: ${week.sessions}`,
      `📨 Total interactions: ${week.totalInteractions}`,
      `⛔ Errors: ${week.errors} (${week.errorRate.toFixed(1)}% error rate)`,
      `🚫 Rate-limited: ${week.rateLimited}`,
      `👍 Good feedback: ${week.goodFeedback}  👎 Bad feedback: ${week.badFeedback} (${week.feedbackRatio.toFixed(1)}% positive)`,
      `📊 Avg interactions/user: ${week.avgInteractionsPerUser.toFixed(1)}`,
      `📝 Feedback response rate: ${week.feedbackResponseRate.toFixed(1)}%`,
    ];

    if (week.usersWowPct !== null) {
      lines.push(
        `📈 WoW: ${signed(week.usersWowPct)}% users, ${signed(week.interactionsWowPct)}% interactions, ${signed(week.errorRateWowPp)}pp error rate`,
      );
    }

    return lines.join('\n');
  });

  return [...header, blocks.join('\n\n')].join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/usage-report-function && npx jest test/unit/slack-formatter.test.js`
Expected: PASS (all existing tests plus the 5 new `formatLongitudinalReport` tests)

- [ ] **Step 5: Run the full test suite**

Run: `cd apps/usage-report-function && npm test`
Expected: PASS (no regressions in `weekly-report-trigger.test.js`, `cosmos-queries.test.js`, `key-vault-client.test.js`)

- [ ] **Step 6: Commit**

```bash
git add apps/usage-report-function/lib/slack-formatter.js apps/usage-report-function/test/unit/slack-formatter.test.js
git commit -m "feat: add formatLongitudinalReport for weekly trend series"
```

---

### Task 3: Agent skill update — route multi-week requests to the new module

**Files:**
- Modify: `.github/agents/azure-usage-report.agent.md`

**Interfaces:**
- Consumes: `getWeeklyTrendSeries` (Task 1, `apps/usage-report-function/lib/longitudinal-queries.js`) and `formatLongitudinalReport` (Task 2, `apps/usage-report-function/lib/slack-formatter.js`) by name only — this task is documentation, no code changes.

- [ ] **Step 1: Add a Scope bullet for multi-week trend requests**

In `.github/agents/azure-usage-report.agent.md`, in the `## Scope` section, add this bullet immediately after the existing "Reproduce the WeeklyReportTrigger KPI set..." bullet and before its nested list ends (i.e., as a new top-level bullet after that nested list, at the same indent level as "Provide short analysis..."):

```markdown
- Reproduce week-over-week longitudinal trend data whenever the user asks for
  a trend, comparison, or "over time" view spanning more than one week (e.g.
  "trend over the last 2 months", "compare weekly growth since April").
```

- [ ] **Step 2: Add a Ground Rule for routing multi-week requests**

In the `## Ground Rules` section, append this as a new numbered item after the existing item 6 ("Never post to Slack unless explicitly requested."):

```markdown
7. For requests spanning more than one week, use `getWeeklyTrendSeries`
   (`apps/usage-report-function/lib/longitudinal-queries.js`) and
   `formatLongitudinalReport` (`apps/usage-report-function/lib/slack-formatter.js`)
   instead of looping the single-window helpers across weeks — the
   longitudinal query fetches raw records for the whole range once, so
   looping single-window helpers would multiply query cost unnecessarily.
```

- [ ] **Step 3: Update the Execution Pattern output-shape bullet**

In the `## Execution Pattern` section, find this line:

```markdown
   - output shape (Slack-style report text vs analytical summary vs raw KPI table).
```

Replace it with:

```markdown
   - output shape (single-window Slack-style report text vs. multi-week
     longitudinal trend report vs. analytical summary vs. raw KPI table).
```

- [ ] **Step 4: Verify the edits**

Run: `grep -n "getWeeklyTrendSeries\|formatLongitudinalReport\|longitudinal" .github/agents/azure-usage-report.agent.md`
Expected: matches on all three new mentions (Scope bullet, Ground Rule 7, and no stray leftover text from the old output-shape bullet)

- [ ] **Step 5: Commit**

```bash
git add .github/agents/azure-usage-report.agent.md
git commit -m "docs: route multi-week usage report requests to longitudinal trend series"
```

---

## Self-Review Notes

- **Spec coverage:** `getWeeklyTrendSeries` (Task 1) covers the design's data-fetching approach, weekly bucketing, new/returning/repeat-rate-per-week, and WoW deltas. `formatLongitudinalReport` (Task 2) covers the design's formatting section. The agent skill ground rule (Task 3) covers the design's "Agent Skill Update" section. PDF and top-user leaderboards are explicitly out of scope per the design doc and have no task here.
- **Type consistency:** `WeekTrend` field names (`weekStart`, `weekEnd`, `uniqueUsers`, `newUsers`, `returningUsers`, `repeatRate`, `usersWowPct`, `interactionsWowPct`, `errorRateWowPp`, etc.) are identical between Task 1's produced interface and Task 2's consumed interface and test fixtures.
- **No placeholders:** all steps contain complete, runnable code and exact commands.
