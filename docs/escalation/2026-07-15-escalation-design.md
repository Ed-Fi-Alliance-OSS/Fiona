# Design: Escalate a Conversation to a Human

- **Jira:** [AI-122](https://edfi.atlassian.net/browse/AI-122)
- **Status:** As-built (shipped in PR #63). Deferred entry points tracked in
  [AI-159](https://edfi.atlassian.net/browse/AI-159) and
  [AI-160](https://edfi.atlassian.net/browse/AI-160).

## Purpose

Let a user hand their Fiona conversation off to a human. Fiona posts an
escalation notice — with a link back to the conversation and an LLM summary of
the thread — into a configured Slack channel where the support team is watching,
and confirms to the user that a human will follow up.

## Entry points

Escalation is shipped with two entry points, both funneling into one shared core
(`postEscalation` in `apps/fiona-slack/src/agent/escalation.js`):

| Entry point | Source tag | Context | Reply |
| --- | --- | --- | --- |
| `/fiona escalate` (slash command) | `slash_escalate` | **Context-free** — slash commands carry no `thread_ts`, so no transcript is captured | Ephemeral (`respond`) |
| `escalate` keyword — `@fiona escalate`, or `escalate` in a DM / assistant panel | `mention_escalate` / `assistant_escalate` | Captures the real thread transcript | Threaded (`say`) |

The slash command is handled in `listeners/commands/fiona.js` (`handleEscalate`);
the keyword path is routed by `parseCommandKeyword` in
`listeners/commands/command-handler.js` and dispatched through `escalateViaSay`.
Both share the confirmation/error copy exported from `command-handler.js`
(`ESCALATE_CONFIRM_TEXT`, `ESCALATE_DM_TEXT`, `ESCALATE_ERROR_TEXT`) so the two
paths stay in lockstep.

### Why the slash command is deliberately context-free

Slash commands do not carry a `thread_ts`. An earlier design fell back to
scraping the channel's recent top-level messages to build a transcript, which
(a) grabbed the wrong content — not the user's Fiona thread — and (b) created a
data-egress problem: one user's escalation could copy unrelated users' channel
messages into the escalation channel and to the summarization model. The slash
path therefore posts a context-free escalation with an explicit
"_no conversation context_" note rather than scraping. Transcript + summary only
exist for the conversational entry points, which have a genuine `threadTs`.

## Behavior of `postEscalation`

1. If `ESCALATION_ENABLED` is not exactly `true` → log a warning, record
   **nothing**, and return `{ ok: false, errorType: 'feature_disabled' }`. This
   check is first, ahead of the channel check, so an operator who switched the
   feature off is not shown a misleading configuration error. It records no
   interaction because a feature that is off by decision is not a failure and
   must not land in the error telemetry alongside genuine post failures.
2. If `ESCALATION_CHANNEL_ID` is unset → record an error interaction and return
   `{ ok: false, errorType: 'channel_not_configured' }`.
3. When a `threadTs` is present, run three independent Slack calls concurrently:
   fetch the thread transcript (up to 50 replies), and — for non-DM threads —
   look up a permalink to the conversation. The LLM summary depends on the
   transcript, so it chains off it.
4. Post a Block Kit `section` header to `ESCALATION_CHANNEL_ID` containing: an
   optional user-group ping (`ESCALATION_USERGROUP_ID`), the requester, a
   **Where** link, a timestamp, and the **Summary** when available. DMs show
   `Direct message (no permalink)` instead of a channel link. The context-free
   slash path appends the no-context note.
4. When a transcript exists, post it as a **threaded reply** under the header
   (truncated under Slack's section-text limit).
5. Record the outcome to Cosmos best-effort (see below).
6. Return `{ ok, errorType }`; callers render the user-facing confirmation or
   error.

## Data recording

Every escalation attempt is recorded best-effort (failures are logged, never
thrown):

- **Interactions container** via `recordInteraction` — `interactionType` is the
  source tag (`slash_escalate` / `mention_escalate` / `assistant_escalate`),
  `status` is `success` or `error`.
- **Feedback container** via `recordFeedback` with **`value: 'escalation'`**,
  storing the transcript as `userMessage` and the summary as `botResponse`.

> **Downstream impact:** because escalation rows now live in the `feedback`
> container, `getFeedbackResponseRate` in
> `apps/usage-report-function/lib/cosmos-queries.js` filters to
> `value IN ('good-feedback', 'bad-feedback')` so escalation rows do not inflate
> the feedback-response-rate metric. This filter is required, not incidental.

## Security: Slack token neutralization

Text that originates from users or the LLM and is embedded into `mrkdwn` blocks
posted to the escalation channel is neutralized to prevent unwanted pings /
mass-mentions (including via prompt injection into the summary). Both the
transcript builder and the summary path strip/rewrite `<!channel>`, `<!here>`,
`<!subteam^…>`, and `<@U…>` tokens before posting.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ESCALATION_ENABLED` | `false` | Master switch (AI-217). Escalation is off unless this is exactly `true`; an unset, blank or misspelled value leaves it off. |
| `ESCALATION_CHANNEL_ID` | (unset) | Channel **ID** where escalation posts are created (bot must be a member). Escalation is disabled when unset. |
| `ESCALATION_USERGROUP_ID` | (unset) | Optional Slack user-group ID to @-mention on escalation. |

The `_ID` suffix on `ESCALATION_CHANNEL_ID` signals the value must be a channel
ID (e.g. `C0123456789`), not a channel name like `#escalation`.

### What "off" looks like

With `ESCALATION_ENABLED` off the feature **disappears** rather than declining:

- `/fiona escalate` is not routed. It falls through to `handleUnknown`, which
  acks with the help text and records the turn as `slash_unknown`.
- `escalate` as a keyword — `@fiona escalate`, or `escalate` in a DM or the
  assistant panel — stops being recognised by `parseCommandKeyword`, so the
  message is answered by the LLM as an ordinary question.
- `postEscalation` refuses regardless of caller, so any future entry point
  (including automatic escalation) inherits the gate without its own check.

Escalation was never listed in the help text, so nothing has to be removed there.

## Deferred (not shipped in AI-122)

- **Always-present "Get Live Help" button** — [AI-159](https://edfi.atlassian.net/browse/AI-159).
- **Proactive, LLM-suggested escalation** (Fiona offers to escalate when it
  detects a stuck user) — [AI-160](https://edfi.atlassian.net/browse/AI-160).

Both can build directly on the shared `postEscalation` core.

## References

- Implementation: `apps/fiona-slack/src/agent/escalation.js`,
  `listeners/commands/fiona.js`, `listeners/commands/command-handler.js`.
- Living product context: `docs/fiona-skills-prd.md`.
