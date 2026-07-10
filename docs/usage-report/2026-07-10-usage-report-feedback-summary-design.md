# Design: Feedback Summary Section for Usage Report

## Purpose

The weekly usage report currently shows numeric KPIs only. Executives reading the
report have no qualitative sense of what users are actually saying. This adds a
short, plain-text "Representative Feedback" section to the bottom of the report
showing 5 real feedback examples (question, response, and sentiment) from the
reporting window, for a quick executive read — not deep analysis.

## Data Selection

New function `getRepresentativeFeedback(startDate, endDate, limit = 5)` in
`apps/usage-report-function/lib/cosmos-queries.js`.

- Queries the `feedback` container for documents with `timestamp` in
  `[startDate, endDate)`.
- Two-tier selection:
  1. Entries with a non-empty `reason`, most recent first.
  2. Entries without a `reason`, most recent first (fallback fill).
- Returns up to `limit` entries total, tier 1 first, filling remaining slots
  from tier 2. Each returned item is tagged with which tier it came from
  (`hasReason: boolean`) so the formatter can flag fallback items.
- If the feedback container has zero matching entries, returns an empty array.

Fields returned per item: `userMessage`, `botResponse`, `value`
(`good-feedback` / `bad-feedback`), `reason`, `timestamp`, `hasReason`.

## Sentiment

Sentiment is not computed via LLM or NLP. It is derived directly and only from
the existing thumbs rating:

- `good-feedback` → `👍 Positive`
- `bad-feedback` → `👎 Negative`

The free-text `reason` (when present) is shown verbatim alongside the
sentiment label — it is restated, not reinterpreted.

## Formatting

New function `formatFeedbackSection(feedbackItems)` in
`apps/usage-report-function/lib/slack-formatter.js`, called from
`formatWeeklyReport(kpis)` and appended after the existing KPI lines.

Plain text, consistent with the report's existing style (no Slack Block Kit):

```
📋 Representative Feedback
1. 👍 Positive
   Q: <userMessage, truncated to 150 chars>
   A: <botResponse, truncated to 150 chars>
   Reason: <reason, truncated to 150 chars>
2. 👎 Negative
   Q: <userMessage, truncated to 150 chars>
   A: <botResponse, truncated to 150 chars>
   Reason: (no reason provided)
```

Rules:
- Truncate `userMessage`, `botResponse`, and `reason` independently to 150
  characters each, appending `…` when truncated.
- When `hasReason` is `false`, print `Reason: (no reason provided)` instead of
  omitting the line — this makes fallback items explicit to the reader.
- If `feedbackItems` is empty, print a single line:
  `No feedback recorded for this period.` instead of a numbered list.
- Numbering is 1-based in encounter order (tier 1 items first, then tier 2
  fallback items), matching the order returned by
  `getRepresentativeFeedback`.

## Integration Points

1. `apps/usage-report-function/lib/cosmos-queries.js` — add
   `getRepresentativeFeedback`.
2. `apps/usage-report-function/lib/slack-formatter.js` — add
   `formatFeedbackSection`; call it from `formatWeeklyReport`.
3. `apps/usage-report-function/WeeklyReportTrigger/index.js` — add the new
   query into the existing `Promise.all` block alongside the other KPI
   queries; pass the result into the `kpis` object under a
   `representativeFeedback` key.
4. `.github/agents/azure-usage-report.agent.md` — document the new section so
   ad-hoc agent-generated reports for arbitrary date ranges also include it,
   reusing `getRepresentativeFeedback` / `formatFeedbackSection` per the
   skill's existing "reuse and preserve parity" ground rules.

## Testing

- `apps/usage-report-function/test/unit/cosmos-queries.test.js`: reason-tier
  priority ordering, fallback fill when fewer than 5 have reasons, empty
  result when no feedback exists in window.
- `apps/usage-report-function/test/unit/slack-formatter.test.js`:
  truncation at 150 chars, `(no reason provided)` flag on fallback items,
  zero-feedback message, correct sentiment emoji/label mapping.
- `apps/usage-report-function/test/unit/weekly-report-trigger.test.js`:
  assert the feedback section text appears in the final composed message.

## Out of Scope

- LLM-based or NLP-based sentiment classification.
- Slack Block Kit / rich formatting.
- Redaction or anonymization of feedback content (feedback-store already
  captures `userMessage`/`botResponse` as an explicit opt-in via the
  feedback button, distinct from the privacy-scoped `interactions`
  container).
