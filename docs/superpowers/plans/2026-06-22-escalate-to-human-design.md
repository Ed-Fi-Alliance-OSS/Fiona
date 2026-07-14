# Escalate-to-Human — Design

> **Status:** Implemented (AI-122) \
> **Date:** 2026-06-22 \
> **Updated:** 2026-07-14 — revised to match what shipped: escalation is reachable
> from the slash command **and** conversationally via the `escalate` keyword
> (`@fiona escalate` and `escalate` in a DM / assistant panel). The slash path is
> context-free; conversational paths capture the thread transcript. \
> **Jira:** [AI-122](https://edfi.atlassian.net/browse/AI-122) — escalate a conversation to a human \
> **Related PRD:** [Fiona Skills PRD](../../fiona-skills-prd.md) §2.4 (slash command) and §3 (proactive detection) \
> **See also:** [Escalation redesign](../specs/2026-06-23-escalation-redesign-design.md) — the button + proactive-suggestion story that builds on this.

## 1. Summary

Add the ability for a Fiona user to escalate a conversation to a human team
member. Escalation is reachable three ways, all converging on one shared core:

1. **Slash command** — `/fiona escalate`. Slash commands carry **no `thread_ts`**,
   so this path is **context-free**: it posts a "someone needs a human"
   notification with no transcript (it never scrapes channel history).
2. **@-mention** — `@fiona escalate` in a channel or thread. The app-mention
   event carries a real `thread_ts`, so this **captures the thread transcript**.
3. **DM / assistant keyword** — typing `escalate` (or `fiona escalate`) in a DM
   or the assistant panel. Also thread-aware, so it captures the transcript.

Paths 2 and 3 reuse the existing keyword router (`parseCommandKeyword` /
`routeCommandViaSay`) that already handles `help`/`ask`/`search`, so `escalate`
behaves consistently with the other conversational keywords.

A **fourth** path — Fiona *proactively suggesting* escalation when it judges it
has not helped, and an always-present "Get Live Help" button — is a separate
downstream story (see the [redesign spec](../specs/2026-06-23-escalation-redesign-design.md)).
It reuses the same `postEscalation` core.

## 2. Decisions

Settled during brainstorming and against the AI-122 acceptance criteria, then
refined during implementation:

| Topic | Decision |
| --- | --- |
| Entry points | Slash command **plus** the `escalate` keyword via @-mention and DM/assistant, mirroring the existing help/ask/search keyword routing. |
| `/fiona escalate` (slash) | Escalates **immediately** and **context-free** — no transcript, no channel-history scraping, no permalink (a slash command has no thread to capture). Posts a "no conversation context" note. |
| Conversational escalate (@mention / DM / assistant) | Escalates immediately using the **real `thread_ts`**, capturing the thread transcript + LLM summary + permalink. |
| Confirmation | Slash: ephemeral `respond(...)`. Conversational: `say(...)` **posted in-thread** (pass `thread_ts`) so it lands in the conversation, not the channel root. |
| Post content | Short **LLM summary** + the **recent transcript** below it (transcript as a threaded reply). Slash posts header only. |
| Notify | Post to the channel **and** optionally @-mention a configurable user group. |
| Channel config | Configured by **channel ID** for reliability, in `ESCALATION_CHANNEL` (see §8). |
| Persistence | Record the escalation to **both** the `interactions` and `feedback` Cosmos containers, tagged with the entry-point `source` (§6). |
| Telemetry counting | The conversational path calls `markInteractionRecorded()` so the surrounding telemetry wrapper does not double-count; `postEscalation` owns the record (mirrors the slash path). |

## 3. AI-122 Acceptance Criteria (verbatim) → coverage

| # | Acceptance criterion | Where covered / deviation |
| --- | --- | --- |
| 1 | Posts to the configured escalation channel with: requesting user's display name, link back to originating channel/thread, and a summary of recent conversation history. | §4, §5. **Note:** the transcript/summary/permalink apply to the **conversational** paths (real thread). The **slash** path is context-free by design (§5) — a slash command exposes no thread. |
| 2 | Confirmation to the user: *"✅ Your conversation has been escalated. A team member will follow up shortly."* | §5. The channel name was dropped from the copy (the configured channel is an ID and may not be visible to the user). |
| 3 | In a DM (no thread to escalate), respond: *"✅ A team member will follow up shortly."* | §5, §7 |
| 4 | If the channel can't be found or Fiona lacks permission, send an error and log the failure. | §7 |
| 5 | Escalation channel configurable via `ESCALATION_CHANNEL`. | §8 |
| 6 | Rate limiting applies. | §5 (slash guards directly; conversational paths are already rate-limited upstream by their handlers). |
| 7 | Interaction recorded to Cosmos with an escalate `interactionType` to **both** the `interactions` and `feedback` containers. | §6 |
| 8 | A shared `postEscalation` helper is extracted for reuse. | §4 |
| 9 | Unit tests cover: post contains display name + thread link; confirmation sent; DM edge case; permission error caught and surfaced; both Cosmos containers written; `ESCALATION_CHANNEL` respected. | §10 |

## 4. Module structure

Follows the existing `listeners/` + `agent/` layout.

```none
src/agent/
  escalation.js               # postEscalation() shared core + escalateViaSay() conversational wrapper
  llm-caller.js               # (edit) summarizeForEscalation() — non-streaming summary
  interaction-store.js        # (edit) interactionType enum documents the escalate sources
src/listeners/
  commands/command-handler.js # (edit) parseCommandKeyword() recognizes `escalate`; shared ESCALATE_* copy
  commands/fiona.js           # (edit) `escalate` slash sub-command (context-free)
  events/app_mention.js       # (edit) `escalate` keyword branch → escalateViaSay (real thread_ts)
  assistant/message.js        # (edit) `escalate` keyword branch → escalateViaSay (real thread_ts)
```

The proactive-suggestion + "Get Live Help" button files (`escalation-intent.js`,
`views/escalation_block.js`, `actions/escalation.js`) are **not** part of AI-122;
they belong to the [redesign story](../specs/2026-06-23-escalation-redesign-design.md).

### `postEscalation({ client, userId, teamId, channelId, threadTs, messageTs, source, isDm, logger })`

The shared core (AI-122 AC #8). Steps:

1. Return `{ ok: false, errorType: 'channel_not_configured' }` if `ESCALATION_CHANNEL` is unset.
2. **Resolve display name** via `getUser()` (`slack-users-store`); fall back to the Slack ID.
3. **Transcript — only when `threadTs` is a real Slack ts** (conversational paths):
   build from the user's own thread via `conversations.replies`. The slash path
   passes `threadTs: null` → no transcript, **no channel-history scraping**.
4. **Summary** via `summarizeForEscalation()` only when a transcript exists;
   degrade to transcript-only on failure.
5. **Permalink** via `chat.getPermalink` only when there is a real `threadTs`
   and it is not a DM (avoids a doomed call using a slash `trigger_id`).
6. **Post** the header to `ESCALATION_CHANNEL` (optional user-group ping); when
   there is no thread, append a "no conversation context" note. Post the
   transcript as a threaded reply when present.
7. **Record** to both Cosmos containers (§6).
8. **Return** `{ ok, errorType }` so the caller picks the right confirmation.

`source` is `'slash_escalate'`, `'mention_escalate'`, or `'assistant_escalate'`
so analytics can differ by entry point.

### `escalateViaSay({ client, userId, teamId, channelId, threadTs, messageTs, source, isDm, say, logger })`

The conversational wrapper (shared by @-mention and assistant). Calls
`postEscalation`, then replies via `say({ text, thread_ts })` **in-thread**:
`ESCALATE_CONFIRM_TEXT` (or `ESCALATE_DM_TEXT` in a DM) on success,
`ESCALATE_ERROR_TEXT` on failure (and records an escalate-error interaction so
the event is captured exactly once). Rate limiting is applied upstream by the
message handler, so it is not repeated here.

## 5. Entry points

### 5a. `/fiona escalate` (slash — context-free)

A new `case 'escalate'` in `src/listeners/commands/fiona.js`:

1. **Rate limit** via `checkRateLimit(user_id)`; on limit, ephemeral notice +
   record a rate-limited interaction, stop.
2. **DM check** (`isDmChannel`) selects the DM vs channel confirmation copy.
3. **Escalate** via `postEscalation({ threadTs: null, source: 'slash_escalate', ... })`
   — context-free.
4. **Confirm / error** via ephemeral `respond(...)`: success → *"✅ Your
   conversation has been escalated. A team member will follow up shortly."* (DM:
   *"✅ A team member will follow up shortly."*); failure → error + log (AC #4).

### 5b. `escalate` keyword (@-mention and DM/assistant — with transcript)

In `app_mention.js` and `assistant/message.js`, after the rate-limit check and
text extraction, `parseCommandKeyword(text)` recognizes an exact `escalate`
(or `fiona escalate`). The handler then:

1. Calls `markInteractionRecorded()` (so the telemetry wrapper doesn't also record the turn).
2. Calls `escalateViaSay({ threadTs, messageTs, source: 'mention_escalate' | 'assistant_escalate', isDm, say, ... })`
   with the **real `thread_ts`**, which captures the transcript and replies in-thread.

Non-escalate keywords (`help`/`ask`/`search`) continue to route through
`routeCommandViaSay` unchanged.

## 6. Analytics & persistence (AI-122 AC #7)

`postEscalation` records `interactionType: <source>` to **both** Cosmos containers:

- **`interactions`** — via `recordInteraction()`.
- **`feedback`** — via `recordFeedback()` with `value: 'escalation'` and the
  `interactionType` source (the usage-report feedback-response-rate KPI excludes
  `value: 'escalation'` rows via an allow-list on `good-feedback`/`bad-feedback`).

Both writes are best-effort and logged on failure. `interactionType` values:
`slash_escalate`, `mention_escalate`, `assistant_escalate`.

## 7. Error handling & edge cases

| Case | Behavior |
| --- | --- |
| `ESCALATION_CHANNEL` unset / channel not found / bot not a member / no permission | Error to the user (ephemeral for slash, in-thread for conversational), log the failure (AC #4). |
| Summary LLM call fails | Post with transcript only; do not fail the escalation. |
| Cosmos unavailable | Name lookup falls back to the Slack ID; both records are fire-and-forget. |
| Slash command (no thread) | Context-free post with a "no conversation context" note; no transcript, no scraping, no permalink. |
| DM escalation | Skip the permalink (a DM isn't linkable for others); still post to the escalation channel. Conversational DM/assistant escalations carry the thread transcript. |

## 8. Configuration & Slack app

- **Env vars:**
  - `ESCALATION_CHANNEL` — the destination channel. **Value is a channel ID**
    (e.g. `C0123456789`). Added to `.env.sample` and the container Bicep.
  - `ESCALATION_USERGROUP_ID` — optional on-call user group to @-mention (e.g.
    `S0123456789`); when unset, the ping is simply omitted.
- **Slack scopes:** `chat:write` (existing). Reading a thread transcript uses the
  existing history scopes (`channels:history` / `im:history` / `groups:history`).
- **Deploy steps:** the bot **must be a member** of the escalation channel;
  re-upload the manifest so the `/fiona` usage hint advertises `escalate`.

## 9. Proactive path (future story — context only)

The always-present "Get Live Help" button and Fiona's proactive escalation
suggestion are a **separate downstream story** — see the
[redesign spec](../specs/2026-06-23-escalation-redesign-design.md). They reuse
`postEscalation`; nothing in AI-122 blocks them.

## 10. Testing (AI-122 AC #9)

Unit tests mirroring the existing `tests/` layout:

- `postEscalation`: post contains display name + thread link; both Cosmos
  containers written; `ESCALATION_CHANNEL` respected; summary-failure
  degradation; post-failure error; DM permalink skipped; **context-free slash
  path** (no history/replies scrape, no permalink, single post with the
  "no conversation context" note).
- `escalateViaSay`: channel confirmation **in-thread** on success; DM
  confirmation in-thread; error text in-thread + escalate-error record;
  delegation with the real thread ts and source.
- Slash handler (`fiona.js`): confirmation sent (no hardcoded channel name); DM
  vs channel copy; error path; rate-limit branch.
- `parseCommandKeyword`: recognizes `escalate` / `fiona escalate` (exact match).
- `app_mention.js` / `message.js`: `escalate` routes to `escalateViaSay` (not the
  LLM) with the right source/thread; rate-limited users don't escalate.

## 11. Resolved decisions

1. **`ESCALATION_CHANNEL` value format** — store a **channel ID** (not `#name`),
   avoiding fragile runtime name→ID lookup. See §8.
2. **User-group ping** — kept as an optional enhancement (`ESCALATION_USERGROUP_ID`);
   omitted cleanly when unset. See §2, §8.
3. **Slash transcript** — **context-free.** A slash command has no `thread_ts`,
   so instead of scraping unrelated channel history (a data-egress risk), the
   slash path posts a context-free notification. Transcripts come only from the
   user's own Fiona thread via the @-mention / DM / assistant keyword paths. See §5.
4. **Confirmation placement** — conversational confirmations are posted
   **in-thread** (`say({ thread_ts })`) so they land in the conversation rather
   than the channel root. See §2.
5. **Confirmation copy** — the confirmation no longer names `#escalation` (the
   configured channel is an ID and may not be visible to the user). See §3 AC #2.
