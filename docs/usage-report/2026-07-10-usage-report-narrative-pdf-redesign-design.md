# Design: Narrative-Style Executive PDF Redesign

## Purpose

The first executive PDF implementation (see
`2026-07-10-usage-report-executive-pdf-design.md`) mirrors the original
notebook's structure 1:1: six small charts per section, wide raw-data tables
dominating every page. A stakeholder-facing reference PDF
(`fiona-executive-report-clean-*.pdf`) restructures the same underlying data
into a narrative, executive-readable format: KPI cards, one enlarged trend
chart, prose "Readout" insights, feedback presented as cards, and detailed
tables relegated to an appendix. This design replaces the first
implementation entirely with that narrative style.

Two real bugs were found and fixed in the pdfkit-based implementation before
this redesign — text wrapping past its allotted box bled into whatever
rendered next, both in chart axis labels (`2026-07-10-usage-report-executive-pdf-design.md`
follow-up fixes) and table cells. Both were symptoms of the same root cause:
pdfkit has no CSS-style box model, so every wrap/overflow decision is manual
arithmetic. The new design's harder rendering needs (dual-axis combo chart,
rounded/shadowed cards, rotated axis labels) make that risk worse, not
better, so this redesign also changes the rendering approach.

## Rendering Approach: Puppeteer + HTML/CSS + Chart.js

Three approaches were considered:

1. **Extend pdfkit further** — no new dependencies, but the combo chart and
   card styling require substantial hand-rolled vector math, and the
   underlying overflow-bug risk (no auto-reflow) remains.
2. **Puppeteer + HTML/CSS + Chart.js** *(chosen)* — CSS handles
   wrapping/overflow/rounded-corners/shadows/grid layout natively, directly
   eliminating the bug class hit twice in the prior implementation. Chart.js
   handles the dual-axis combo chart, legends, and rotated labels with no
   custom code. Cost: a ~300MB Chromium dependency and a new failure surface
   (headless sandboxing, font availability, browser lifecycle). The
   Chromium safety concern that ruled out this approach for the *original*
   pdfkit decision was specifically about the deployed Azure Function — this
   PDF path only ever runs ad hoc via the agent on a dev machine, so that
   concern doesn't apply here.
3. **Python (matplotlib + reportlab), matching the original notebook stack**
   — would nail the reference's exact visual style with the least custom
   code (matplotlib natively handles dual-axis/legends/rotation; reportlab's
   Platypus flowables auto-reflow, solving the pagination problem natively).
   Rejected because it reverses the stated purpose of the whole executive-
   report effort: the longitudinal-trends design doc explicitly ported logic
   into JS "so the same query helpers... can also answer this without the
   manual notebook process." Reintroducing Python here means a second
   language/runtime the agent must have installed wherever it runs, and an
   ongoing split between JS query-layer maintainers and Python
   rendering-layer maintainers.

**Chosen: option 2.** New dependencies: `puppeteer`, `chart.js` (loaded from
the local `node_modules` file at render time, not a CDN, so generation never
depends on network access). `pdfkit` is removed.

**Risk:** `puppeteer`'s bundled-Chromium postinstall download may not
succeed in every environment. Mitigation: fall back to `puppeteer-core` +
an already-installed Chrome/Edge via `executablePath` if the bundled
download fails. Confirm during implementation rather than assuming
up front.

## File Layout

Retired (deleted, along with their tests):
- `lib/pdf/charts.js`
- `lib/pdf/tables.js`
- `lib/pdf/executive-report-pdf.js`

New:
- **`lib/pdf/narrative.js`** — pure functions computing deterministic,
  template-based text from `reportData`. No AI-authored/interpretive prose;
  every sentence is a fixed template filled with a computed fact (peak
  value, total, rate). Exports:
  - `buildReadoutBullets(reportData)` → array of strings (engagement,
    reliability, feedback summary sentences)
  - `buildUsageObservations(weeklyTrend)` → array of `{ metric,
    observation }` rows (peak weekly interactions, peak unique users,
    late-period activity note, engagement-depth peak) — each computed via
    max/argmax over `weeklyTrend`
  - `buildReliabilityTakeaways(kpiSummary, weeklyTrend)` → array of
    `{ signal, takeaway }` rows (system error rate, rate limiting, feedback
    quality)
- **`lib/pdf/report-template.js`** — `renderExecutiveReportHtml(reportData,
  narrative)` returns a full HTML document string (inline `<style>`,
  Chart.js `<canvas>` elements sized per section, KPI/feedback card markup,
  appendix tables).
- **`lib/pdf/generate-executive-report-pdf.js`** (replaces
  `executive-report-pdf.js`) — `generateExecutiveReportPdf(reportData,
  outputPath)`: computes narrative → renders HTML → launches Puppeteer →
  sets page content → waits for Chart.js to finish drawing (chart
  `animation: false` plus an `onComplete`/load-event signal, not a fixed
  delay) → prints to PDF with a `footerTemplate` (page numbers) → writes the
  file → closes the browser.

## Backend Query Changes

`getDailySummary` (`lib/daily-queries.js`) gains `newUsers`, `returningUsers`,
`repeatRate` per day, mirroring `getWeeklyTrendSeries`'s existing logic:
bucket each user's first-seen-in-range day, then reuse one
"prior-history-before-range-start" query (not per-day) to classify true new
vs. returning. Adds one extra Cosmos round trip only when there are
current-period users. Implemented as a direct copy of the established
pattern (matching this codebase's existing style of per-module query logic)
rather than a shared helper — no third consumer exists yet to justify
extracting one.

`getRepresentativeFeedbackInRange` (new, `lib/cosmos-queries.js`) — a
range-bound sibling of the existing `getRepresentativeFeedback`. Discovered
during implementation planning: `getRepresentativeFeedback` takes only
`oneWeekAgoISO` with no upper bound, which is correct for
`WeeklyReportTrigger`'s "last 7 days up to now" usage but would silently
include feedback past `endISO` for the executive report's arbitrary past
range. Added as a separate function rather than changing
`getRepresentativeFeedback`'s signature, since that function is actively
used by `WeeklyReportTrigger` with passing tests that assume its current
open-ended behavior.

`buildExecutiveReportData` gains a `representativeFeedback` field, sourced
from `getRepresentativeFeedbackInRange`.

No other backend changes: `kpiSummary` and the weekly data already have
everything the new pages need.

## Page-by-Page Content Mapping

| Page | Content |
|---|---|
| 1 — Cover / Executive Summary | Title; `Period / Environment / Generated` header; static intro paragraph; 2×3 KPI card grid (Total Interactions, Unique Users, Total Sessions, Avg Interactions/User, System Error Rate, Positive Feedback); Readout bullet list |
| 2 — Usage Trends | One enlarged Chart.js combo chart (bar: Interactions; 2 lines: Users, Sessions; dual y-axis; diagonal week labels; legend); Observation table below |
| 3 — Reliability and Feedback | Weekly Error Rate bar chart; Weekly Feedback Volume stacked bar chart (Good/Bad legend); Takeaway table below |
| 4 — Representative Feedback | Cards from `getRepresentativeFeedbackInRange` (new range-bound variant of `getRepresentativeFeedback`'s reason-prioritized selection, limit 5 — added because the existing function is open-ended-to-now and not safe for an arbitrary past `[startISO, endISO)` range; see Backend Query Change below) — colored background by sentiment (light red/green), header "Good/Bad feedback - DATE", `Q:` (userMessage), `A:` (verbatim `botResponse`, truncated — **not paraphrased**, consistent with the existing ground rule that feedback content is restated, never reinterpreted) |
| 5 — Top Users | Top Users by Feedback (5 rows), Top Users by Interaction Count (6 rows), narrowed to decision-useful columns |
| 6 — Appendix | Weekly Snapshot table (adds `new_users`/`returning_users`/`repeat_rate%` columns, already in `weeklyTrend`); Daily Summary — 3 Chart.js bar charts (interactions, unique users, error rate) + table (adds `new_users`/`returning_users` columns, from the `getDailySummary` extension above); Executive Notes |

Footer on every page (Puppeteer `footerTemplate`): `Fiona Usage Analytics |
{environment} | {period}` and `Page X of Y`.

## Testing

- `narrative.js` — TDD, pure-function unit tests against known
  `weeklyTrend`/`dailySummary`/`feedbackDetails`/`kpiSummary` fixtures;
  assert exact computed bullet strings and table rows.
- `getDailySummary` extension — new test cases mirroring
  `longitudinal-queries.test.js`'s existing new/returning-user test
  structure (mock the raw-interactions query and the prior-history query).
- `report-template.js` — HTML string assertions (e.g. the rendered KPI
  value appears, section headings are present, card content appears) rather
  than pixel testing.
- `generate-executive-report-pdf.js` — integration-style test: a real
  Puppeteer run against fixture data, confirming a valid multi-page PDF is
  written (same spirit as the retired test, slower due to Chromium launch).
- Manual smoke test: temp runner script (`_run-live-executive-report.js`,
  deleted after use per the agent's own ground rule) against live Cosmos
  data, visual review of the generated PDF.

## Agent Skill Update

`.github/agents/azure-usage-report.agent.md` ground rule 12 updated to
reference `generate-executive-report-pdf.js` instead of the retired
`executive-report-pdf.js`.

## Out of Scope

- Agent-authored/interpretive narrative text (explicitly rejected in favor
  of deterministic templates — see Purpose).
- LLM-paraphrased feedback-card summaries (explicitly rejected in favor of
  verbatim truncated `botResponse` — see Page-by-Page mapping, page 4).
- A dedicated new-users chart in the appendix (only table columns were
  requested, not an additional chart).
- Running this render path inside the deployed Azure Function — it remains
  agent-only/ad hoc, same as the longitudinal trends and first PDF designs.
