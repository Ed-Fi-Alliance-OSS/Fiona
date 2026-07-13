# Historical Context Section — Executive PDF Report

**Date:** 2026-07-13
**Feature:** Add a "Historical Context" page to the executive PDF showing weekly trend charts since April, with the current report period highlighted.

---

## Goal

Stakeholders reading the executive PDF can currently see the current period in detail (Usage Trends page) but have no reference point for whether the numbers are high, low, or trending. This feature adds a single new page — placed after Usage Trends — with three bar charts (interactions, unique users, error rate) spanning from a configurable historical start date (default: April 1, 2026) through the end of the report period. Current-period weeks are colored in accent blue; all prior weeks are grey.

---

## Data Layer

### `buildExecutiveReportData` (`lib/report-data.js`)

- Gains an optional `historicalStartISO` parameter.
- Default value: `'2026-04-01T00:00:00.000Z'`.
- Calls `getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, historicalStartISO, endISO)` as an additional parallel slice.
- Returns the result as `historicalWeeklyTrend` in the bundle alongside the existing slices.
- The existing `weeklyTrend` slice (covering only the report period) is unchanged.

```js
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
    ...
  ] = await Promise.all([
    getKpiSummary(...),
    getWeeklyTrendSeries(..., startISO, endISO),
    getWeeklyTrendSeries(..., historicalStartISO, endISO),
    getDailySummary(...),
    ...
  ]);

  return { ..., weeklyTrend, historicalWeeklyTrend };
}
```

### Runner script / agent invocations

The `generateExecutiveReportPdf` orchestrator and agent runner scripts pass `historicalStartISO` through to `buildExecutiveReportData` as an optional override. When not supplied, the April 1 default applies automatically.

---

## Template Layer

### New function: `renderHistoricalContextPage` (`lib/pdf/report-template.js`)

Signature:
```js
export function renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend)
```

Logic:
1. Build a `Set` of current-period week-start keys from `weeklyTrend` (e.g., `new Set(weeklyTrend.map(w => w.weekStart))`).
2. For each chart, derive a per-bar color array: accent blue (`#1d4ed8`) if the week's `weekStart` is in the set; grey (`#d1d5db`) otherwise.
3. Register three `simpleBarChartConfig` calls in `window.__chartConfigs`:
   - **Weekly Interactions** — `w.totalInteractions`
   - **Weekly Unique Users** — `w.uniqueUsers`
   - **Weekly Error Rate (%)** — `w.errorRate`
4. Labels are formatted via `formatWeekLabel(w.weekStart, w.weekEnd)`.
5. Page heading: **"Historical Context: Weekly Trends Since April"**.
6. Short explanatory paragraph below the heading noting that blue bars are the current report period.

`simpleBarChartConfig`'s `color` parameter maps directly to Chart.js `backgroundColor`, which accepts a string array natively — no changes to the helper are required.

### `renderExecutiveReportHtml` update

`renderExecutiveReportHtml` destructures `historicalWeeklyTrend` from `reportData` alongside the existing fields, then inserts `renderHistoricalContextPage(historicalWeeklyTrend, weeklyTrend)` between `renderUsageTrendsPage` and `renderReliabilityPage`. Report grows from 8 to 9 pages.

`generate-executive-report-pdf.js` requires no changes — it passes the full `reportData` bundle through unchanged; `renderExecutiveReportHtml` reads `historicalWeeklyTrend` directly from that bundle.

---

## Document Page Order (after change)

1. Cover — KPI cards + Readout
2. Usage Trends — current-period chart + observations table
3. **Historical Context** ← new
4. Reliability and Feedback
5. Representative Feedback
6. Top Users
7. Appendix: Weekly Snapshot
8. Appendix: Daily Summary
9. Executive Notes

---

## Testing

All additions go into existing test files; no new test files are created.

### `test/unit/report-data.test.js`
- Verify `historicalWeeklyTrend` is present in the returned bundle.
- Verify `historicalStartISO` defaults to `'2026-04-01T00:00:00.000Z'` when not supplied (inspect the query call args via a spy or by passing a custom value and asserting the slice length differs from `weeklyTrend`).

### `test/unit/pdf/report-template.test.js`
- `describe('renderHistoricalContextPage', ...)`:
  - Renders without throwing given sample `historicalWeeklyTrend` and `weeklyTrend`.
  - Output contains the heading text `"Historical Context"`.
  - Current-period bar entries use `#1d4ed8` and prior-period bars use `#d1d5db` in the serialised chart config script.

### `test/unit/pdf/generate-executive-report-pdf.test.js`
- Add `historicalWeeklyTrend` field to the existing fixture (matching the shape of `weeklyTrend`).
- Existing assertions (`%PDF-` header, file size > 1000 bytes) are unchanged.

---

## Non-Goals

- No new deployed Azure Function or infrastructure change.
- No changes to the Slack-style weekly text report (`formatLongitudinalReport`).
- No UI for selecting the historical start date — the default covers the expected use case; override is via code/runner script argument.
