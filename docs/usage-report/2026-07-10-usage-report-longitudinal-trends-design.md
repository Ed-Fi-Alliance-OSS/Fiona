# Design: Weekly Longitudinal Trend Series for Usage Report

## Purpose

The weekly usage report and the `azure-usage-report` agent skill currently
only compute KPIs for a single window (default: last 7 days). Executive
review previously relied on a manual, disconnected process — a Jupyter
notebook (`notebooks/usage-analytics/usage-analytics.ipynb`) that required
exporting Cosmos DB data to local CSVs and using pandas/matplotlib/reportlab
to build a multi-week trend view and PDF.

This adds week-over-week (WoW) longitudinal trend computation directly to
the JS codebase, so the same query helpers used by `WeeklyReportTrigger` and
the agent skill can also answer "how has usage trended over the last N
weeks" without the manual notebook process. No new deployed Azure Function
is added — the agent computes this ad hoc, the same way it already runs
single-window queries today.

## Data Fetching Approach

Two options were considered:

1. **Loop over weeks, reuse existing single-week helpers**
   (`getDistinctUsers`, `getSessionCount`, etc.) once per week boundary.
   Simple, but for an N-week range this is ~9 queries × N weeks — expensive
   and slow as the range grows.
2. **Fetch raw records for the full range once per container, bucket into
   weeks in JS** — mirrors what the notebook already does with pandas
   `groupby`. One query per container regardless of range length.

**Chosen: option 2.** Query cost stays flat regardless of range length, and
it ports logic already proven correct by the notebook rather than inventing
a new aggregation strategy.

## New Query Module

`apps/usage-report-function/lib/longitudinal-queries.js`

```
getWeeklyTrendSeries(interactionsContainer, feedbackContainer, deploymentType, startISO, endISO)
```

- Fetches raw interaction documents (`userId`, `threadTs`, `status`,
  `rateLimited`, `timestamp`) and raw feedback documents (`value`,
  `timestamp`) for `[startISO, endISO)` in two queries (one per container).
- Buckets both into Sunday-ending weeks (`W-SUN`, matching the notebook's
  convention: week start = Monday, week end = Sunday).
- Per week, computes:
  - `uniqueUsers`, `sessions`, `totalInteractions`, `errors`, `errorRate`,
    `rateLimited`
  - `goodFeedback`, `badFeedback`, `feedbackRatio`, `avgInteractionsPerUser`,
    `feedbackResponseRate`
  - `newUsers`, `returningUsers`, `repeatRate` — computed per week using the
    same "first successful interaction before this week's start" logic as
    `getNewUsersCount`, applied per week bucket instead of a single window
    (this is new relative to the notebook, which did not track new/returning
    users; it keeps parity with what the single-week report already
    surfaces)
- Also computes WoW deltas between consecutive weeks:
  - `usersWowPct`, `interactionsWowPct` — percent change vs. prior week
  - `errorRateWowPp` — percentage-point change vs. prior week
  - First week in the range has no prior week to diff against; these fields
    are `null` for it.
- Returns plain data (array of week objects, ordered oldest to newest) with
  no formatting baked in, so a future non-Slack renderer (e.g. PDF) can
  consume the same structure without any changes to this module.

## Formatting

New function `formatLongitudinalReport(weeklySeries, { deploymentType, startDate, endDate })`
in `apps/usage-report-function/lib/slack-formatter.js`.

- One Slack-text block per week, reusing the existing emoji/line style from
  `formatWeeklyReport`.
- Each week's block includes the KPI lines plus a WoW delta line (skipped
  for the first week in the range, which has no prior week).
- Plain text, consistent with the rest of the report (no Slack Block Kit).

## Agent Skill Update

`.github/agents/azure-usage-report.agent.md`:

- New ground rule: when a request implies more than one week (e.g. "trend
  over the last 2 months", "compare weekly growth since April"), use
  `getWeeklyTrendSeries` + `formatLongitudinalReport` instead of the
  single-window KPI helpers.
- Single-window behavior (current default, last 7 days) is unchanged when no
  multi-week range is implied.
- No new deployed Azure Function — the agent computes this the same way it
  already does for single-window ad hoc queries (reusing the query helpers
  directly).

## Integration Points

1. `apps/usage-report-function/lib/longitudinal-queries.js` (new) —
   `getWeeklyTrendSeries`.
2. `apps/usage-report-function/lib/slack-formatter.js` — add
   `formatLongitudinalReport`.
3. `.github/agents/azure-usage-report.agent.md` — document the multi-week
   ground rule and when to use the new module vs. the existing single-window
   helpers.

## Testing

- New `apps/usage-report-function/test/unit/longitudinal-queries.test.js`:
  weekly bucketing correctness (week boundaries, W-SUN convention), WoW delta
  math (including `null` for the first week), new/returning users computed
  per week, empty-range handling.
- `apps/usage-report-function/test/unit/slack-formatter.test.js`: add cases
  for `formatLongitudinalReport` (per-week block formatting, WoW line
  omitted for first week, multi-week ordering).

## Out of Scope (this phase)

- **PDF / rich rendering.** Deferred as a follow-up. `getWeeklyTrendSeries`
  returns plain structured data with no formatting baked in specifically so
  a PDF path can be added later as an alternate formatter (e.g.
  `formatLongitudinalReportPdf`) consuming the same data, without reworking
  the query layer. When scoped, this needs its own design pass (rendering
  approach — e.g. Puppeteer/HTML+CSS vs. a table-only PDF library — plus the
  dependency and layout tradeoffs that come with it).
  - **Manual PDF-readiness smoke test, without building anything:** the
    existing notebook (`notebooks/usage-analytics/usage-analytics.ipynb` in
    the `escalate-ai-122` worktree) already has a working reportlab PDF cell.
    Before scoping real PDF implementation, that cell can be pointed at the
    JSON output of `getWeeklyTrendSeries` (in place of its pandas-computed
    `weekly` dataframe) as a throwaway check that the data shape is
    sufficient to render a PDF. This is not automated test coverage — just a
    quick manual confirmation that the phase-2 data contract holds.
- Top users leaderboards (by interaction count / feedback volume) and raw
  feedback-detail listings from the notebook — not part of this phase;
  covered ad hoc by existing agent capabilities where needed.
- A new deployed Azure Function / HTTP trigger for on-demand runs.
