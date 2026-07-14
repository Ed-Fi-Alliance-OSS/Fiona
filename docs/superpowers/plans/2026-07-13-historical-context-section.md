# Historical Context Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Historical Context" page to the executive PDF showing three bar charts (interactions, unique users, error rate) spanning from April 1, 2026 (configurable) through the report end date, with current-period weeks highlighted in accent blue.

**Architecture:** Three layers — (1) data: `buildExecutiveReportData` gains a `historicalStartISO` parameter and fetches a second `getWeeklyTrendSeries` slice; (2) template: new `renderHistoricalContextPage` renderer uses per-bar color arrays to highlight current-period weeks; (3) wire-up: `renderExecutiveReportHtml` destructures `historicalWeeklyTrend` from `reportData` and inserts the new page after Usage Trends.

**Tech Stack:** Node.js ESM, Jest, Chart.js (via `simpleBarChartConfig`), Puppeteer (for PDF smoke test)

## Global Constraints

- All new JS files must start with the Apache-2.0 license header from `CLAUDE.md`
- TDD cycle: RED → GREEN → lint (`npm run lint`) → full suite (`npm test`) → commit
- Lint: `npm run lint` in `apps/usage-report-function/`
- Full suite: `npm test` in `apps/usage-report-function/`
- Canvas IDs for new charts: `hist-interactions-chart`, `hist-unique-users-chart`, `hist-error-rate-chart`
- Highlight color: `#1d4ed8` (accent blue); prior-week color: `#d1d5db` (grey)
- Historical start default: `'2026-04-01T00:00:00.000Z'`

---

## File Map

| File | Change |
|------|--------|
| `lib/report-data.js` | Add `historicalStartISO` param; second `getWeeklyTrendSeries` call; `historicalWeeklyTrend` in returned bundle |
| `lib/pdf/report-template.js` | Add `renderHistoricalContextPage` export; update `renderExecutiveReportHtml` to destructure and use it |
| `test/unit/report-data.test.js` | Update fixture for two `getWeeklyTrendSeries` calls; add `historicalWeeklyTrend` assertions |
| `test/unit/pdf/report-template.test.js` | Add `renderHistoricalContextPage` import and describe block; update `renderExecutiveReportHtml` fixture and assertions |
| `test/unit/pdf/generate-executive-report-pdf.test.js` | Add `historicalWeeklyTrend` to fixture |

---

### Task 1: Data layer — `historicalWeeklyTrend` slice in `buildExecutiveReportData`

**Files:**
- Modify: `lib/report-data.js`
- Test: `test/unit/report-data.test.js`

**Interfaces:**
- Produces: `buildExecutiveReportData({ ..., historicalStartISO? })` → `{ ..., historicalWeeklyTrend: Array }`
- `historicalStartISO` defaults to `'2026-04-01T00:00:00.000Z'`

- [ ] **Step 1: Write the failing tests**

Open `test/unit/report-data.test.js`. The file currently has three `it(...)` tests inside `describe('buildExecutiveReportData', ...)`. Make the following changes:

1. Add a `historicalWeeklyTrend` fixture alongside the existing fixtures (around line 43):
```js
const historicalWeeklyTrend = [{ weekStart: '2026-04-07' }, { weekStart: '2026-04-13' }];
```

2. Update `beforeEach` so `mockGetWeeklyTrendSeries` returns different values on its two calls (first call = report-period slice, second = historical slice):
```js
mockGetWeeklyTrendSeries
  .mockResolvedValueOnce(weeklyTrend)
  .mockResolvedValueOnce(historicalWeeklyTrend);
```
Replace the existing `mockGetWeeklyTrendSeries.mockResolvedValue(weeklyTrend)` line.

3. Update the `'assembles all data slices into the expected shape'` test to include `historicalWeeklyTrend` in the expected shape:
```js
expect(result).toEqual({
  period: { deploymentType, startISO, endISO },
  kpiSummary,
  weeklyTrend,
  historicalWeeklyTrend,
  dailySummary,
  feedbackDetails,
  representativeFeedback,
  topUsersByFeedback,
  topUsersByInteractions,
});
```

4. Update the `'calls each slice function with the correct arguments'` test. Replace the existing `expect(mockGetWeeklyTrendSeries).toHaveBeenCalledWith(...)` assertion with two ordered assertions:
```js
expect(mockGetWeeklyTrendSeries).toHaveBeenNthCalledWith(
  1,
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  startISO,
  endISO,
);
expect(mockGetWeeklyTrendSeries).toHaveBeenNthCalledWith(
  2,
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  '2026-04-01T00:00:00.000Z',
  endISO,
);
```

5. Add a new test at the end of the describe block:
```js
it('accepts a custom historicalStartISO and passes it to the second getWeeklyTrendSeries call', async () => {
  mockGetWeeklyTrendSeries
    .mockResolvedValueOnce(weeklyTrend)
    .mockResolvedValueOnce(historicalWeeklyTrend);

  await buildExecutiveReportData({
    interactionsContainer,
    feedbackContainer,
    deploymentType,
    startISO,
    endISO,
    historicalStartISO: '2026-01-01T00:00:00.000Z',
  });

  expect(mockGetWeeklyTrendSeries).toHaveBeenNthCalledWith(
    2,
    interactionsContainer,
    feedbackContainer,
    deploymentType,
    '2026-01-01T00:00:00.000Z',
    endISO,
  );
});
```

Note: `beforeEach` calls `jest.clearAllMocks()`, so this new test needs its own `mockResolvedValueOnce` chain.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/usage-report-function && npm test -- --testPathPattern="report-data" 2>&1 | tail -30
```

Expected: FAIL — `historicalWeeklyTrend` not in result shape, `toHaveBeenNthCalledWith` on a single call.

- [ ] **Step 3: Update `lib/report-data.js`**

Replace the entire file with:
```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getFeedbackDetails, getRepresentativeFeedbackInRange } from './cosmos-queries.js';
import { getDailySummary } from './daily-queries.js';
import { getKpiSummary } from './kpi-summary.js';
import { getWeeklyTrendSeries } from './longitudinal-queries.js';
import { getTopUsersByFeedback, getTopUsersByInteractions } from './user-queries.js';

/**
 * Fetches every independent data slice needed for the executive PDF report
 * and returns them as one plain object, with no formatting/rendering logic
 * applied. Each slice is fetched by its own dedicated query function so it
 * stays independently testable and reusable outside of PDF rendering.
 */
export async function buildExecutiveReportData({
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  startISO,
  endISO,
  historicalStartISO = '2026-04-01T00:00:00.000Z',
}) {
  const [
    kpiSummary,
    weeklyTrend,
    historicalWeeklyTrend,
    dailySummary,
    feedbackDetails,
    representativeFeedback,
    topUsersByFeedback,
    topUsersByInteractions,
  ] = await Promise.all([
    getKpiSummary(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO),
    getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO),
    getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, historicalStartISO, endISO),
    getDailySummary(interactionsContainer, deploymentType, startISO, endISO),
    getFeedbackDetails(feedbackContainer, deploymentType, startISO, endISO),
    getRepresentativeFeedbackInRange(feedbackContainer, deploymentType, startISO, endISO),
    getTopUsersByFeedback(feedbackContainer, deploymentType, startISO, endISO),
    getTopUsersByInteractions(interactionsContainer, deploymentType, startISO, endISO),
  ]);

  return {
    period: { deploymentType, startISO, endISO },
    kpiSummary,
    weeklyTrend,
    historicalWeeklyTrend,
    dailySummary,
    feedbackDetails,
    representativeFeedback,
    topUsersByFeedback,
    topUsersByInteractions,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/usage-report-function && npm test -- --testPathPattern="report-data" 2>&1 | tail -20
```

Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

```bash
cd apps/usage-report-function && npm run lint 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Full suite**

```bash
cd apps/usage-report-function && npm test 2>&1 | tail -20
```

Expected: all tests pass (same count as before — no other files changed yet).

- [ ] **Step 7: Commit**

```bash
cd apps/usage-report-function && git add lib/report-data.js test/unit/report-data.test.js
git commit -m "feat: add historicalWeeklyTrend slice to buildExecutiveReportData"
```

---

### Task 2: Template renderer — `renderHistoricalContextPage`

**Files:**
- Modify: `lib/pdf/report-template.js`
- Test: `test/unit/pdf/report-template.test.js`

**Interfaces:**
- Consumes: `historicalWeeklyTrend: Array<{ weekStart, weekEnd, totalInteractions, uniqueUsers, errorRate }>`, `weeklyTrend: Array<{ weekStart }>`
- Produces: `renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend): string` — HTML `<section>` with three bar charts

- [ ] **Step 1: Write the failing tests**

Open `test/unit/pdf/report-template.test.js`. Add `renderHistoricalContextPage` to the import at the top:
```js
import {
  renderAppendixPage,
  renderCoverPage,
  renderExecutiveReportHtml,
  renderFeedbackPage,
  renderHistoricalContextPage,
  renderReliabilityPage,
  renderTopUsersPage,
  renderUsageTrendsPage,
} from '../../../lib/pdf/report-template.js';
```

Then add a new `describe` block just before the existing `describe('renderAppendixPage', ...)`:
```js
describe('renderHistoricalContextPage', () => {
  const weeklyTrend = [
    { weekStart: '2026-07-07', weekEnd: '2026-07-13', totalInteractions: 20, uniqueUsers: 5, errorRate: 1.0 },
  ];
  const historicalWeeklyTrend = [
    { weekStart: '2026-04-07', weekEnd: '2026-04-13', totalInteractions: 10, uniqueUsers: 3, errorRate: 2.5 },
    { weekStart: '2026-07-07', weekEnd: '2026-07-13', totalInteractions: 20, uniqueUsers: 5, errorRate: 1.0 },
  ];

  it('renders without throwing given sample data', () => {
    expect(() => renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend)).not.toThrow();
  });

  it('includes the heading text "Historical Context"', () => {
    const html = renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend);
    expect(html).toContain('Historical Context');
  });

  it('colors current-period bars accent blue and prior bars grey', () => {
    const html = renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend);
    expect(html).toContain('#1d4ed8');
    expect(html).toContain('#d1d5db');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/usage-report-function && npm test -- --testPathPattern="report-template" 2>&1 | tail -20
```

Expected: FAIL — `renderHistoricalContextPage` is not exported from `report-template.js`.

- [ ] **Step 3: Implement `renderHistoricalContextPage` in `lib/pdf/report-template.js`**

Insert the following function immediately before the existing `export function renderAppendixPage(...)` (around line 308). Do not modify any other existing function.

```js
export function renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend) {
  const currentPeriodWeeks = new Set(weeklyTrend.map((w) => w.weekStart));
  const labels = historicalWeeklyTrend.map((w) => formatWeekLabel(w.weekStart, w.weekEnd));
  const barColors = historicalWeeklyTrend.map((w) =>
    currentPeriodWeeks.has(w.weekStart) ? '#1d4ed8' : '#d1d5db',
  );

  const interactionsConfig = simpleBarChartConfig(
    labels,
    historicalWeeklyTrend.map((w) => w.totalInteractions),
    'Weekly Interactions',
    barColors,
  );
  const uniqueUsersConfig = simpleBarChartConfig(
    labels,
    historicalWeeklyTrend.map((w) => w.uniqueUsers),
    'Weekly Unique Users',
    barColors,
  );
  const errorRateConfig = simpleBarChartConfig(
    labels,
    historicalWeeklyTrend.map((w) => w.errorRate),
    'Weekly Error Rate (%)',
    barColors,
  );

  return `
  <section class="page">
    <h2>Historical Context: Weekly Trends Since April</h2>
    <p>
      Blue bars mark weeks within the current report period. Grey bars show prior weeks for reference.
    </p>
    <canvas id="hist-interactions-chart" width="900" height="220"></canvas>
    <script>
      window.__chartConfigs = window.__chartConfigs || {};
      window.__chartConfigs['hist-interactions-chart'] = ${JSON.stringify(interactionsConfig)};
    </script>
    <canvas id="hist-unique-users-chart" width="900" height="220"></canvas>
    <script>
      window.__chartConfigs['hist-unique-users-chart'] = ${JSON.stringify(uniqueUsersConfig)};
    </script>
    <canvas id="hist-error-rate-chart" width="900" height="220"></canvas>
    <script>
      window.__chartConfigs['hist-error-rate-chart'] = ${JSON.stringify(errorRateConfig)};
    </script>
  </section>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/usage-report-function && npm test -- --testPathPattern="report-template" 2>&1 | tail -20
```

Expected: PASS (all report-template tests including the new 3).

- [ ] **Step 5: Lint**

```bash
cd apps/usage-report-function && npm run lint 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Full suite**

```bash
cd apps/usage-report-function && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/usage-report-function/lib/pdf/report-template.js apps/usage-report-function/test/unit/pdf/report-template.test.js
git commit -m "feat: add renderHistoricalContextPage with per-bar highlight colors"
```

---

### Task 3: Wire `renderHistoricalContextPage` into `renderExecutiveReportHtml` and update fixtures

**Files:**
- Modify: `lib/pdf/report-template.js` — update `renderExecutiveReportHtml`
- Test: `test/unit/pdf/report-template.test.js` — update `renderExecutiveReportHtml` fixture + assertion
- Test: `test/unit/pdf/generate-executive-report-pdf.test.js` — add `historicalWeeklyTrend` to fixture

**Interfaces:**
- Consumes: `reportData.historicalWeeklyTrend` (added in Task 1), `renderHistoricalContextPage` (added in Task 2)
- Produces: updated `renderExecutiveReportHtml` producing a 9-page document with "Historical Context" after "Usage Trends"

- [ ] **Step 1: Write the failing tests**

**In `test/unit/pdf/report-template.test.js`**, find the `describe('renderExecutiveReportHtml', ...)` block (around line 261). Update the `reportData` fixture inside it to include `historicalWeeklyTrend`:

```js
const reportData = {
  period: { deploymentType: 'production', startISO: '2026-03-18T00:00:00.000Z', endISO: '2026-07-10T00:00:00.000Z' },
  kpiSummary,
  weeklyTrend: weeklyTrendForAppendix,
  historicalWeeklyTrend: [
    { weekStart: '2026-04-07', weekEnd: '2026-04-13', totalInteractions: 8, uniqueUsers: 2, errorRate: 0 },
    { weekStart: '2026-04-14', weekEnd: '2026-04-20', totalInteractions: 12, uniqueUsers: 3, errorRate: 1.5 },
  ],
  dailySummary: dailySummaryForAppendix,
  representativeFeedback,
  topUsersByFeedback,
  topUsersByInteractions,
};
```

Update the `'produces a full HTML document containing every page section'` test to also assert the new section is present:

```js
it('produces a full HTML document containing every page section', () => {
  const html = renderExecutiveReportHtml(reportData, narrative, fakeChartJsSource);
  expect(html).toMatch(/^<!DOCTYPE html>/);
  expect(html).toContain('Executive Summary');
  expect(html).toContain('Usage Trends');
  expect(html).toContain('Historical Context');
  expect(html).toContain('Reliability and Feedback');
  expect(html).toContain('Representative Feedback');
  expect(html).toContain('Top Users');
  expect(html).toContain('Appendix: Weekly Snapshot');
});
```

**In `test/unit/pdf/generate-executive-report-pdf.test.js`**, add `historicalWeeklyTrend` to the `reportData` fixture (after `weeklyTrend`, around line 42):

```js
historicalWeeklyTrend: [
  {
    weekStart: '2026-04-07',
    weekEnd: '2026-04-13',
    uniqueUsers: 2,
    sessions: 2,
    totalInteractions: 5,
    errors: 0,
    errorRate: 0,
    goodFeedback: 0,
    badFeedback: 0,
    feedbackRatio: 0,
    avgInteractionsPerUser: 2.5,
    newUsers: 2,
    returningUsers: 0,
    repeatRate: 0,
  },
  {
    weekStart: '2026-04-13',
    weekEnd: '2026-04-19',
    uniqueUsers: 4,
    sessions: 4,
    totalInteractions: 6,
    errors: 0,
    errorRate: 0,
    goodFeedback: 1,
    badFeedback: 2,
    feedbackRatio: 33.3,
    avgInteractionsPerUser: 1.5,
    newUsers: 4,
    returningUsers: 0,
    repeatRate: 0,
  },
],
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/usage-report-function && npm test -- --testPathPattern="report-template|generate-executive-report-pdf" 2>&1 | tail -30
```

Expected: `report-template` FAIL (missing "Historical Context" in output); `generate-executive-report-pdf` may pass or fail depending on whether missing `historicalWeeklyTrend` causes a thrown error in `renderHistoricalContextPage`.

- [ ] **Step 3: Update `renderExecutiveReportHtml` in `lib/pdf/report-template.js`**

Find `renderExecutiveReportHtml` (around line 470). Make two changes:

1. Add `historicalWeeklyTrend` to the destructure:
```js
const {
  kpiSummary,
  weeklyTrend,
  historicalWeeklyTrend,
  dailySummary,
  representativeFeedback,
  topUsersByFeedback,
  topUsersByInteractions,
  period,
} = reportData;
```

2. Insert `renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend)` into the `pages` array after `renderUsageTrendsPage(...)`:
```js
const pages = [
  renderCoverPage(kpiSummary, readoutBullets, period),
  renderUsageTrendsPage(weeklyTrend, usageObservations),
  renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend),
  renderReliabilityPage(weeklyTrend, reliabilityTakeaways),
  renderFeedbackPage(representativeFeedback),
  renderTopUsersPage(topUsersByFeedback, topUsersByInteractions),
  renderAppendixPage(weeklyTrend, dailySummary),
].join('\n');
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/usage-report-function && npm test -- --testPathPattern="report-template|generate-executive-report-pdf" 2>&1 | tail -30
```

Expected: PASS. Note: `generate-executive-report-pdf.test.js` has a 30-second timeout; allow it to complete.

- [ ] **Step 5: Lint**

```bash
cd apps/usage-report-function && npm run lint 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Full suite**

```bash
cd apps/usage-report-function && npm test 2>&1 | tail -20
```

Expected: all tests pass. Test count increases by 4 over the pre-task-1 baseline (3 new `renderHistoricalContextPage` tests + 1 new `historicalStartISO` custom-param test in `report-data.test.js`).

- [ ] **Step 7: Commit**

```bash
git add apps/usage-report-function/lib/pdf/report-template.js \
        apps/usage-report-function/test/unit/pdf/report-template.test.js \
        apps/usage-report-function/test/unit/pdf/generate-executive-report-pdf.test.js
git commit -m "feat: wire historical context page into executive PDF report"
```
