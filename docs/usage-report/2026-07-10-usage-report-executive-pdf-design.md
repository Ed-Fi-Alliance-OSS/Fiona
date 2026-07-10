# Design: Executive PDF Report

## Purpose

Executives previously reviewed usage analytics via a manual notebook process
(`notebooks/usage-analytics/usage-analytics.ipynb` in the `escalate-ai-122`
worktree — pandas → matplotlib PNGs → reportlab PDF). This ports that report
into the JS codebase as an ad hoc, agent-invocable PDF generator, reusing the
query layer already built for the Slack report and the longitudinal trend
series. No new deployed Azure Function — same pattern as
`getWeeklyTrendSeries` (see
`2026-07-10-usage-report-longitudinal-trends-design.md`): the agent computes
this on demand from a natural-language request and writes a PDF file.

## Data-Slice Architecture

Each report section is an independent data slice — a plain array of objects,
no shared intermediate state — fetched by its own query function and handed
to its own table/chart renderer. This mirrors the notebook's per-dataframe
structure and keeps each slice independently testable.

| Section | Data source | Status |
|---|---|---|
| KPI summary | existing `cosmos-queries.js` (single window) | exists |
| Week-over-week trends | `getWeeklyTrendSeries` (`longitudinal-queries.js`) | exists |
| Weekly snapshots | same `getWeeklyTrendSeries` output, reshaped (no WoW columns) | exists (reshape only) |
| Daily summary | **new** `getDailySummary` | new |
| Feedback details | **new** `getFeedbackDetails` | new |
| Top users by feedback | **new** `getTopUsersByFeedback` | new |
| Top users by interaction count | **new** `getTopUsersByInteractions` | new |
| New/returning users | `newUsers`/`returningUsers`/`repeatRate` already in `getWeeklyTrendSeries` output | exists (surface only) |

## New Query Module: `lib/daily-queries.js`

```
getDailySummary(interactionsContainer, deploymentType, startISO, endISO)
```

- Fetches raw interaction documents for `[startISO, endISO)` in one query
  (same shape as `getWeeklyTrendSeries`'s interactions query).
- Buckets by calendar day (UTC date, `YYYY-MM-DD`).
- Per day: `uniqueUsers`, `sessions`, `totalInteractions`, `errors`,
  `errorRate`, `rateLimited`.
- Returns days ordered oldest to newest. Days with zero interactions are
  omitted (matches the sample PDF, which only lists days with activity).

## New Query Module: `lib/user-queries.js`

```
getTopUsersByInteractions(interactionsContainer, deploymentType, startISO, endISO, limit = 10)
```
- Aggregates all interactions (not just successful ones, so error-heavy users
  are visible) per `userId`: `interactions`, `sessions` (distinct
  `threadTs`), `errors`, `errorRate`, `avgPerSession`, `firstSeen`,
  `lastSeen`.
- Sorted by `interactions` descending, capped at `limit`.

```
getTopUsersByFeedback(feedbackContainer, deploymentType, startISO, endISO, limit = 10)
```
- Aggregates feedback per `userId`: `feedbackCount`, `goodFeedback`,
  `badFeedback`, `lastFeedback`, `positiveRatioPct`.
- Sorted by `feedbackCount` descending, capped at `limit`.

## New Query Function: `getFeedbackDetails` (`lib/cosmos-queries.js`)

```
getFeedbackDetails(feedbackContainer, deploymentType, startISO, endISO, limit = 25)
```
- Unlike `getRepresentativeFeedback` (5 items, reason-prioritized, for the
  Slack report), this returns the most recent `limit` feedback entries
  unfiltered — `timestamp`, `userId`, `value`, `userMessage`, `botResponse`
  — sorted newest-first. Purely a chronological listing for the PDF's
  Feedback Details table.

## Report Data Orchestrator: `lib/report-data.js`

```
buildExecutiveReportData({ interactionsContainer, feedbackContainer, deploymentType, startISO, endISO })
```

Runs all of the above queries (in parallel where independent) and returns one
plain object:

```js
{
  period: { deploymentType, startISO, endISO },
  kpiSummary: { totalInteractions, uniqueUsers, totalSessions, avgInteractionsPerUser, errorRate, rateLimitedEvents, positiveFeedbackPct },
  weeklyTrend: [...],       // getWeeklyTrendSeries output, unchanged
  dailySummary: [...],      // getDailySummary output
  feedbackDetails: [...],   // getFeedbackDetails output
  topUsersByFeedback: [...],
  topUsersByInteractions: [...],
}
```

No formatting/rendering logic lives here — same separation of concerns as
`getWeeklyTrendSeries` vs `formatLongitudinalReport`.

## PDF Rendering: `lib/pdf/`

- **`lib/pdf/charts.js`** — hand-drawn vector charts using `pdfkit`'s drawing
  primitives directly (`rect`, `path`/arc for pie slices, `moveTo`/`lineTo`
  for axes). No canvas/Chart.js — avoids native dependencies and Chromium,
  which matters since this needs to run reliably wherever the agent executes
  it (a dev machine or, later, inside the Azure Function's Node runtime).
  - `drawBarChart(doc, { x, y, width, height, data, labels, title, color })`
  - `drawGroupedBarChart(doc, { ..., series: [{ label, data, color }] })` —
    for the stacked good/bad feedback-per-week chart
  - `drawPieChart(doc, { x, y, radius, slices: [{ label, value, color }], title })`
- **`lib/pdf/tables.js`** — `drawTable(doc, { x, y, columns, rows, headerColor })`
  simple styled table (header row background + banded row colors, matching
  the sample's blue header / light-blue banding), with column width weights
  and text truncation/wrapping options (mirrors `col_weights`/`wrap_cols` in
  the notebook).
- **`lib/pdf/executive-report-pdf.js`** — top-level
  `generateExecutiveReportPdf(reportData, outputPath)`:
  assembles the document section by section (landscape letter, same margins
  as the notebook) in this order: Executive Summary (KPI table) → Week-over-
  Week Trends (6-chart grid + table) → Weekly Snapshots (table) → Daily
  Summary (3-chart row + table) → Feedback Details (pie chart + table) → Top
  Users by Feedback (table) → Top Users by Interaction Count (bar chart +
  table) → Executive Notes. Page breaks placed the same as the notebook
  (after Executive Summary, before Feedback Details).

## Dependency

Add `pdfkit` (pure JS, no native bindings) to
`apps/usage-report-function/package.json` dependencies. No other new
dependencies.

## Agent Skill Update

`.github/agents/azure-usage-report.agent.md`:
- New ground rule: when a request asks for a PDF/document/executive report
  artifact (vs. a Slack-style text summary), call
  `buildExecutiveReportData` + `generateExecutiveReportPdf` and return the
  output file path, instead of formatting a Slack text block.

## Testing

- `test/unit/daily-queries.test.js` — day bucketing correctness, omission of
  zero-activity days, error rate math.
- `test/unit/user-queries.test.js` — interaction/feedback aggregation
  correctness, sort order, `limit` cap, `positiveRatioPct`/`errorRate` math,
  ties.
- `test/unit/cosmos-queries.test.js` — add cases for `getFeedbackDetails`
  (ordering, `limit`, empty range).
- `test/unit/report-data.test.js` — orchestrator assembles all slices into
  the expected shape; empty-range handling (all slices empty, no throws).
- `test/unit/pdf/charts.test.js` and `tables.test.js` — since output is a
  rendered PDF (no easy snapshot assertion), tests validate the drawing
  functions are called with correct computed values (bar heights, slice
  angles, column widths) via a mocked `pdfkit` doc, not actual PDF byte
  comparison.
- Manual smoke test: generate a PDF against real data (or the existing fixture
  data used in the other unit tests) and visually confirm it resembles
  `notebooks/usage-analytics/fiona-executive-report.pdf`.

## Out of Scope (this phase)

- Automatic scheduling / delivery (email, Slack file upload, Blob Storage).
  This stays ad hoc via the agent, consistent with the longitudinal trends
  precedent.
- Exact visual parity with matplotlib-rendered charts — hand-drawn pdfkit
  charts will be simpler (no gridlines/legends beyond what's easy to draw)
  but must show the same data correctly.
