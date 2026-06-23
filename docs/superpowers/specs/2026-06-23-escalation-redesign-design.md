# Escalation Redesign — escalate a conversation to a human

- **Date:** 2026-06-23
- **Jira:** [AI-122](https://edfi.atlassian.net/browse/AI-122)
- **Supersedes:** the escalation approach in PR #63 (`AI-122`)
- **Status:** Design approved; pending spec review

## Background

PR #63 implemented `/fiona escalate` as a Slack slash command. Slash commands
carry no `thread_ts`, so the handler always passed `threadTs: null`, and the
transcript builder fell back to scraping the channel's recent **top-level**
messages — not the thread where the user's Fiona conversation lives. That both
failed the core requirement ("summarize the conversation from that thread") and
created a data-egress problem (one user copying other users' channel messages
into the escalation channel and to Perplexity). The green test suite masked the
gap by injecting a synthetic `threadTs` the real slash path never produces.

This redesign reframes the feature around where the conversation context
actually exists: the **Fiona thread**.

## Goals

1. A user in a conversation with Fiona can escalate **that conversation** to a
   human, with a transcript and summary of the thread.
2. Fiona can **proactively suggest** escalation when it judges it has not helped.
3. `/fiona escalate` still works outside a conversation, but **without a
   transcript** — it is an explicit "I need a human" signal, not a conversation
   capture.
4. No channel-history scraping anywhere. Transcripts come only from the user's
   own Fiona thread.

## Non-goals

- Fully automatic escalation with no human action. Every escalation in this
  design is user-initiated (slash command, explicit button, or clicking a
  suggested button). The model only *suggests*; it never escalates on its own.
- Group-DM (mpim) special handling beyond safe degradation.
- Routing/assignment logic in the human channel (out of scope; humans triage).

## Architecture

Three entry points feed one shared core. The transcript is **optional** and is
built only when a real Slack thread timestamp is available.

```
/fiona escalate   (slash, no thread)      ─┐
explicit button   (Fiona thread)          ─┼─► postEscalation() ─► human channel
suggested button  (Fiona thread, LLM)     ─┘                       + Cosmos records
```

### Shared core: `postEscalation()` (`src/agent/escalation.js`, refactored)

Single responsibility: post an escalation to the configured human channel and
record it to Cosmos. Signature (unchanged shape, clarified semantics):

```
postEscalation({
  client, userId, teamId, channelId,
  threadTs = null,   // real Slack ts when escalating a thread; null for slash
  messageTs,         // real message ts when available; trigger_id for slash
  source,            // 'slash_escalate' | 'button_escalate' | 'suggested_escalate'
  isDm = false,
  logger,
}) -> { ok: boolean, errorType: string|null }
```

Behavior:

- If `ESCALATION_CHANNEL` is unset → return `{ ok: false, errorType: 'channel_not_configured' }`.
- **Transcript (only when `threadTs` is a real Slack ts):** build via the shared
  thread-history core (see below). When `threadTs` is null, there is no
  transcript and no summary.
- **Summary:** `summarizeForEscalation(transcript)` only when a transcript
  exists; degrade to transcript-only on failure.
- **Permalink:** attempt `chat.getPermalink` only when the candidate ts matches
  `^\d+\.\d+$` and `isDm` is false. Otherwise skip straight to the fallback
  location text (no failed API call, no misleading warning).
- **Post** the escalation header block to `ESCALATION_CHANNEL` (optional on-call
  user-group ping), then the transcript as a threaded reply when present.
- **Record** to the interactions container and the feedback container
  (best-effort, fire-and-forget) using the shared `source`/value constants.

### Shared thread-history core

`fetchTranscript` is removed. Transcript text is derived from the same
`buildThreadHistory()` used by `app_mention.js` and `message.js`
(`src/agent/thread-history.js`), so the escalation transcript matches the
context Fiona actually answered from (subtype filtering, mention stripping,
consecutive-turn merging, char-budget truncation).

`buildThreadHistory` returns an OpenAI-style `[{ role, content }]` array. A
small adapter renders that to the plain-text "`*Who:* text`" transcript used in
the escalation post and passed to `summarizeForEscalation`. The adapter lives in
`thread-history.js` (e.g. `renderTranscript(messages)`) so the message-shaping
logic stays in one module.

### Entry point 1 — `/fiona escalate` (slash, no transcript)

`src/listeners/commands/fiona.js`:

- Ack, validate required fields, rate-limit (per user) using the shared
  rate-limit-message helper.
- Call `postEscalation({ threadTs: null, messageTs: trigger_id,
  source: 'slash_escalate', isDm })`.
- Human-channel post (no transcript, no permalink):
  > :rotating_light: *Escalation requested* by *<name>* from `<#channel>`
  > _Requested via `/fiona escalate` — no conversation context. For full
  > context, escalate from your conversation with Fiona using the **Get Live
  > Help** button._
- Ephemeral confirmation to the user. Do **not** hardcode "#escalation"; either
  resolve the channel's real name via `conversations.info` (cached) or omit the
  name ("…has been escalated. A team member will follow up shortly.").
- Add an `/fiona escalate` line to `HELP_TEXT`.

### Entry point 2 — explicit button (always present, with transcript)

- A small `actions` block with a single "Get Live Help" button is appended
  to the blocks passed to `streamer.stop()` in `app_mention.js` and `message.js`,
  alongside the existing `feedbackBlock`. (The feedback buttons live in a
  `context_actions` block; the escalate button uses a separate `actions` block
  with a `button` element and a dedicated `action_id`, e.g. `escalate_conversation`.)
- New action handler `src/listeners/actions/escalate.js`, registered in
  `src/listeners/actions/index.js`. The action body provides `body.message.thread_ts`
  (real), `body.channel.id`, `body.user.id`, `body.trigger_id`.
- Handler: ack, rate-limit (reuse `checkRateLimit`), then `postEscalation({
  threadTs: body.message.thread_ts ?? body.message.ts, messageTs: body.message.ts,
  source: 'button_escalate', isDm })`. Ephemeral confirmation via `respond`.

### Entry point 3 — proactive suggestion (async LLM self-signal)

- New non-streaming helper `classifyForEscalation(history, latestAnswer, logger)`
  in `src/agent/llm-caller.js`:
  - Returns `{ suggest: boolean, reason: string|null }`.
  - Returns `{ suggest: false, reason: null }` when the LLM client is
    unconfigured, the call fails, or the response can't be parsed (degrade
    quietly).
  - System prompt instructs the model to judge whether the user appears stuck,
    unresolved, or frustrated, and to answer with a fixed first line —
    `Get Live Help: yes` or `Get Live Help: no` — optionally followed by a short
    reason line. Parsed defensively (case-insensitive; anything that is not an
    explicit `yes` defaults to `no`).
- After `streamer.stop()` and `captureConversation()` in both `app_mention.js`
  and `message.js`, run the classifier **fire-and-forget / non-blocking** (does
  not delay the answer). Runs on **every** turn, gated only by:
  - `ESCALATION_CHANNEL` configured — this is also the single on/off switch for
    suggestions (no separate flag); nowhere to escalate otherwise, AND
  - the turn did not error / degrade.
- If `suggest`, post a follow-up block in the thread: explanatory text plus a
  prominent "Get Live Help" button (same handler, `action_id` variant or
  metadata marking `source: 'suggested_escalate'`, carrying the classifier
  `reason`). Clicking it runs the same transcript-capturing escalation.
- The suggestion itself is not an escalation. Only a button click records an
  escalation. (Optionally record a lightweight "suggestion shown" telemetry
  event; not required for v1.)

## Data / records

- **Interactions container:** `interactionType` ∈ existing set plus
  `slash_escalate`, `button_escalate`, `suggested_escalate`. (Drop the unused
  `auto_escalation` type — there is no automatic escalation in this design.)
- **Feedback container:** `value: 'escalation'`, with `interactionType` set to
  the source. `userMessage` = transcript (or null for slash), `botResponse` =
  summary (or null).
- **Usage report** (`apps/usage-report-function/lib/cosmos-queries.js`): the
  feedback response-rate allow-list must continue to exclude escalation rows;
  the source/value strings come from a shared constants module rather than
  hardcoded literals duplicated across apps.

## Shared constants

Introduce a small constants module (e.g. `src/agent/escalation-constants.js`)
exporting the escalation `source` values and the `'escalation'` feedback value,
imported by `escalation.js`, the command/action handlers, and referenced by the
usage-report allow-list, to remove the cross-file magic-string coupling.

## Configuration

- `ESCALATION_CHANNEL` (existing) — destination channel **ID**; bot must be a
  member.
- `ESCALATION_USERGROUP_ID` (existing, optional) — on-call user group to ping.
- Proactive suggestions have **no separate flag**: they are active whenever
  `ESCALATION_CHANNEL` is set and inactive when it is not.
- All read at module-load into consts (no inline `process.env` reads in
  functions), consistent with the rest of the codebase.

## Security / privacy

- **No new egress.** Transcripts come only from the user's own Fiona thread,
  whose content was already sent to Perplexity to generate the answers. The
  slash path sends no transcript. The PR-#63 channel-history scraping is removed.
- **Injection hardening:** render the requesting user's display name and the
  transcript so that Slack control tokens cannot mass-ping or spoof headers —
  prefer `plain_text` for the display name and neutralize `<!channel>`,
  `<!here>`, `<!subteam^…>` and `<@…>`-style tokens in transcript text before
  posting.
- **Summarizer prompt injection:** wrap the transcript passed to
  `summarizeForEscalation` in clear delimiters and render the returned summary as
  non-interpolated text.

## Error handling & degradation

- Channel not configured → `{ ok:false, errorType:'channel_not_configured' }`;
  handlers show `ESCALATE_ERROR_TEXT`.
- Post failure → `{ ok:false, errorType:'post_failed' }`; user is told and the
  error interaction is recorded.
- Transcript fetch / summary / permalink / classifier failures degrade
  gracefully (transcript-only, no summary, fallback location link, no
  suggestion) and warn; the escalation still succeeds where the channel post
  succeeds.
- `hasRequiredFields` failure on the slash path sends `ESCALATE_ERROR_TEXT`
  rather than a silent no-op.

## Testing

- **`postEscalation`:** real assertions on the posted block content for both the
  with-transcript (real `threadTs`) and no-transcript (`threadTs: null`) paths;
  permalink attempted only for real ts + non-DM; summary-failure degradation;
  post-failure error; recording to both containers; usergroup ping.
- **Transcript rendering:** assert ordering, who-labeling, mention/token
  stripping, and truncation against `buildThreadHistory` output.
- **Slash handler:** ack, rate-limit branch (with limiter state cleanup),
  delegation with `threadTs: null` and `source: 'slash_escalate'`,
  required-fields failure path, DM vs channel confirmation text.
- **Button handler:** delegation with real `thread_ts` and
  `source: 'button_escalate'`; rate-limit; confirmation.
- **`classifyForEscalation`:** suggest true/false parsing, unconfigured-client
  returns false without calling the LLM, error path returns false and warns.
- **Proactive flow:** suggestion posted when classifier returns true and
  `ESCALATION_CHANNEL` is set; not posted when the channel is unset or the turn
  errored. Classifier first line parsed case-insensitively; non-`yes` → no
  suggestion.
- Tests must use real entry-point arguments (no synthetic `threadTs` on the
  slash path) and must not leak shared limiter / `process.env` state.

## Migration / cleanup from PR #63

- Remove `fetchTranscript` and its channel-history branch.
- Remove the `auto_escalation` interaction type.
- Move the two large `docs/superpowers/plans/*.md` process artifacts out of the
  PR (PR description or local), per the review.
- Replace hardcoded source/value literals with the shared constants module.
