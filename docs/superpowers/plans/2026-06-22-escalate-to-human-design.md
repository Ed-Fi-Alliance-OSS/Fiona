# Escalate-to-Human — Design

> **Status:** Draft (design) \
> **Date:** 2026-06-22 \
> **Jira:** [AI-122](https://edfi.atlassian.net/browse/AI-122) — `/fiona escalate` — escalate a conversation to a human \
> **Related PRD:** [Fiona Skills PRD](../../fiona-skills-prd.md) §2.4 (slash command) and §3 (proactive detection)

## 1. Summary

Add the ability for a Fiona user to escalate a conversation to a human team
member. Escalation is reachable two ways:

1. **Explicit slash command** — `/fiona escalate` (this is the scope of
   **AI-122**).
2. **Conversational** — while talking with Fiona, the user can *ask* for a
   human in plain language (e.g. "can I talk to a person?", "this isn't
   helping"). Fiona detects the intent and offers a one-click escalation. This
   is a **separate downstream story**; AI-122 only requires that the slash
   command extract a shared `postEscalation` helper that the conversational
   story will reuse.

Both paths converge on a single shared helper that posts a notification to a
configured Slack channel, pings an on-call user group, and records the event.

## 2. Decisions

These were settled during brainstorming and against the AI-122 acceptance
criteria:

| Topic | Decision |
| --- | --- |
| Detection (conversational) | **Hybrid** — fast keyword gate, then a cheap LLM confirm before offering. |
| Conversational offer UX | On confirmed intent, Fiona **offers escalation instead of answering** that turn (Yes / No buttons). A single Yes/No offer is used for **all** conversational triggers — explicit asks and inferred frustration alike — so a misread message can never escalate without consent. |
| `/fiona escalate` | Escalates **immediately** (the command is itself explicit intent); no confirmation step. |
| Post content | Short **LLM summary** + the **recent transcript** below it (transcript posted as a threaded reply to keep the channel scannable). |
| Notify | Post to the channel **and** @-mention a configurable user group. *(Beyond AI-122's AC; carried because it also serves the proactive story.)* |
| Channel config | Configured by **channel ID** for reliability, stored in the AC-mandated env var `ESCALATION_CHANNEL` (see §8). |
| Persistence | Record `slash_escalate` to **both** the `interactions` and `feedback` Cosmos containers, per AI-122. |

## 3. AI-122 Acceptance Criteria (verbatim) → coverage

| # | Acceptance criterion | Where covered |
| --- | --- | --- |
| 1 | `/fiona escalate` posts to the configured escalation channel (default `#escalation`) with: requesting user's display name, link back to originating channel/thread, and a summary of recent conversation history. | §4, §5 |
| 2 | Ephemeral confirmation to the user: *"✅ Your conversation has been escalated to #escalation. A team member will follow up shortly."* | §5 |
| 3 | In a DM (no thread to escalate), respond ephemerally: *"✅ A team member will follow up shortly."* | §5, §7 |
| 4 | If the channel can't be found or Fiona lacks permission, send an ephemeral error and log the failure. | §7 |
| 5 | Escalation channel configurable via `ESCALATION_CHANNEL` env var (default `#escalation`). | §8 |
| 6 | Rate limiting applies. | §5 |
| 7 | Interaction recorded to Cosmos DB with `interactionType: slash_escalate` to **both** the `interactions` and `feedback` containers. | §6 |
| 8 | A shared `postEscalation` helper is extracted for reuse by the proactive escalation story. | §4 |
| 9 | Unit tests cover: post contains display name + thread link; ephemeral confirmation sent; DM edge case; permission error caught and surfaced ephemerally; both Cosmos containers written; `ESCALATION_CHANNEL` respected. | §10 |

## 4. Module structure

The PRD sketches a `src/skills/` tree, but the codebase doesn't use one; this
design follows the **existing** `listeners/` + `agent/` layout.

```none
src/agent/
  escalation.js              # postEscalation(): the shared core flow (AI-122 AC #8)
  escalation-intent.js       # keyword gate + LLM confirm + maybeOfferEscalation() (proactive story)
src/listeners/
  views/escalation_block.js  # the Yes/No offer Block Kit block (proactive story)
  actions/escalation.js      # escalation_yes / escalation_no button handlers (proactive story)
  actions/index.js           # (edit) register the two new actions
  commands/fiona.js          # (edit) add the `escalate` sub-command (AI-122)
  events/app_mention.js      # (edit) insert detection step before normal answer (proactive story)
  assistant/message.js       # (edit) insert detection step before normal answer (proactive story)
src/agent/llm-caller.js      # (edit) add non-streaming summarizeForEscalation()
```

**AI-122 ships:** `escalation.js` (the `postEscalation` helper), the
`fiona.js` `escalate` sub-command, the `summarizeForEscalation()` helper, env
vars/config, and tests. The proactive-story files are listed here for
continuity but are implemented under the separate story.

### `postEscalation({ client, userId, teamId, channelId, threadTs, source, logger })`

The shared core (AI-122 AC #8). Steps:

1. **Resolve display name** via `getUser()` (`slack-users-store`); fall back to
   the Slack ID if Cosmos is unconfigured or misses.
2. **Build the transcript** with the existing `buildThreadHistory()`.
3. **Generate a summary** via `summarizeForEscalation()` (new non-streaming
   Perplexity call). On failure, **degrade gracefully** to a transcript-only
   post — escalation must never fail because the summary did.
4. **Build the Block Kit message**: header → user-group mention
   (`<!subteam^ID>`) → summary → context block (user display name, permalink to
   the source thread via `chat.getPermalink`, timestamp). Post the **full
   transcript as a threaded reply** to that message.
5. **Post** to the channel ID from `ESCALATION_CHANNEL` via `chat.postMessage`.
6. **Record** analytics to both Cosmos containers (§6).
7. **Return** `{ ok, error }` so the caller picks the right ephemeral message.

`source` is `'slash_escalate'` or `'auto_escalation'` so analytics and copy can
differ by entry point.

## 5. `/fiona escalate` sub-command (AI-122)

Added as a new `case 'escalate'` in `src/listeners/commands/fiona.js`:

1. **Rate limit.** The existing slash handlers don't rate-limit; this path adds
   a `checkRateLimit(user_id)` guard (the `handleRateLimitedInteraction` wrapper
   is built around `say`, so the slash path calls `checkRateLimit` directly and
   responds ephemerally via `ack`/`respond`). On limit: ephemeral notice, record
   a rate-limited interaction, stop.
2. **DM check.** If the invocation has no escalatable thread (DM / no
   `channel`/thread context), send the ephemeral *"✅ A team member will follow
   up shortly."* and still record the interaction (AC #3). Whether a DM also
   posts to the channel is covered in §7.
3. **Escalate.** Call `postEscalation({ source: 'slash_escalate', ... })`.
4. **Confirm / error.** On success: ephemeral *"✅ Your conversation has been
   escalated to #escalation. A team member will follow up shortly."* On failure
   (channel missing / no permission): ephemeral error + log (AC #4).

## 6. Analytics & persistence (AI-122 AC #7)

`postEscalation` records `interactionType: slash_escalate` (or
`auto_escalation` for the proactive path) to **both** Cosmos containers:

- **`interactions`** — via the existing `recordInteraction()` (user/team/
  channel/thread/message identifiers, status, timestamp).
- **`feedback`** — via `recordFeedback()` (or a thin escalation variant),
  capturing the escalation context (user message / summary, thread link).

Both writes are best-effort and logged on failure; a Cosmos outage must not
block the user-facing escalation.

New `interactionType` values: `slash_escalate`, `auto_escalation`, and (for the
proactive buttons) `escalation_confirmed` / `escalation_declined`.

## 7. Error handling & edge cases

| Case | Behavior |
| --- | --- |
| `ESCALATION_CHANNEL` unset / channel not found / bot not a member / no permission | Ephemeral error to the user, log the failure (AC #4). |
| Summary LLM call fails | Post with transcript only; do not fail the escalation. |
| Cosmos unavailable | Name lookup falls back to the Slack ID; both records are fire-and-forget. |
| DM with no public thread | Send the AC #3 ephemeral *and* still post to the escalation channel carrying the DM transcript — without it responders have no context to follow up on (the DM isn't visible to them). The permalink/thread link is omitted since the DM isn't linkable for others. |
| LLM-confirm error (proactive path) | Fall back to **offering** escalation (the keyword already matched) and log. *Fail-open chosen so a flagged user is never silently ignored.* |

## 8. Configuration & Slack app

- **Env vars:**
  - `ESCALATION_CHANNEL` — the destination channel. **Value is a channel ID**
    (e.g. `C0123456789`) for reliable posting; the AC's `#escalation` default is
    illustrative. Added to `.env.sample` and the container Bicep
    (`infra/fiona-slack-container/main.bicep`).
  - `ESCALATION_USERGROUP_ID` — the on-call user group to @-mention (e.g.
    `S0123456789`). *(Enhancement beyond AI-122.)*
- **Slack scopes:** none new required. A user-group mention is just message text
  (`<!subteam^ID>`), and `chat:write` already exists.
- **Deploy step:** the bot **must be a member** of the escalation channel —
  documented in deploy notes.

## 9. Conversational path (proactive story — context only)

Implemented under the separate downstream story; included here to show the
shared helper's reuse.

- `escalation-intent.js`: `detectEscalationKeyword(text)` (curated phrase list)
  → `confirmEscalationIntent(text, logger)` (tiny LLM yes/no) →
  `maybeOfferEscalation({...})` which posts the offer block and returns `true`
  when intent is confirmed.
- In `app_mention.js` and `message.js`, after the rate-limit check and text
  extraction and before `buildThreadHistory`/`callLLM`:
  `if (await maybeOfferEscalation({ client, text, ... })) return;` — a single
  shared call keeps the two handlers in lockstep.
- `escalation_block.js`: Yes / No buttons (`escalation_yes` / `escalation_no`),
  with minimal `{ channelId, threadTs }` context in the button `value`.
- `actions/escalation.js`: `escalation_yes` calls the shared `postEscalation`;
  `escalation_no` posts a friendly ephemeral ack. Registered in
  `actions/index.js`.

## 10. Testing (AI-122 AC #9)

Unit tests mirroring the existing `tests/` layout. For AI-122:

- Escalation post contains the user **display name** and a **thread link**.
- Ephemeral confirmation is sent to the invoking user.
- DM edge case handled with the AC #3 message.
- Permission/channel error is caught and surfaced ephemerally + logged.
- **Both** Cosmos containers (`interactions` and `feedback`) are written.
- `ESCALATION_CHANNEL` env var is respected (post targets the configured
  channel).
- Rate limiting applies on the slash path.
- Summary-failure degradation (transcript-only post).

Proactive-story tests (separate story): keyword + confirm (mocked LLM), the
"offer instead of answer" flow, and both button handlers.

## 11. Resolved decisions

These were the previously-open items; all are now settled and reflected in the
sections above.

1. **`ESCALATION_CHANNEL` value format** — **Resolved: store a channel ID.** The
   AC-named `ESCALATION_CHANNEL` variable holds a channel ID (e.g.
   `C0123456789`) rather than a `#name`, avoiding fragile runtime name→ID
   lookup. See §8.
2. **User-group ping** — **Resolved: keep it.** `ESCALATION_USERGROUP_ID` is
   carried as an enhancement beyond AI-122's AC because it also serves the
   proactive story. When unset, escalation still posts to the channel (the ping
   is simply omitted). See §2, §8.
3. **DM → channel post** — **Resolved: yes, a DM escalation also posts to the
   channel.** A DM escalation sends the AC #3 ephemeral *and* posts the DM
   transcript to the escalation channel, because responders otherwise have no
   context to follow up on (the DM is invisible to them). The permalink is
   omitted since the DM isn't linkable for others. Note this surfaces an
   otherwise-private DM transcript into the escalation channel — acceptable
   because escalation is an explicit user request for a human to see the
   conversation. See §7.
