# Fiona Skills — Product Requirements Document

> **Parent document:** [Fiona Slack PRD](fiona-slack-prd.md) (§2.9) \
> **Status:** Implemented (proactive escalation deferred; see §6) \
> **Jira Project:** AI

## 1. Overview

Fiona Skills are structured actions exposed through the `/fiona` Slack slash
command. They provide purpose-built interactions that complement Fiona's existing
conversational interface (channel mentions, DMs, and the Assistant panel).

### 1.1 Design Goals

- **Discoverability** — Users can type `/fiona help` to see everything Fiona can
  do, lowering the barrier to first use.
- **Precision** — Each skill performs a single, well-defined action with
  predictable output, reducing ambiguity compared to free-form prompts.
- **Composability** — New skills can be added without changing the behavior of
  existing ones.
- **Privacy by default** — Every skill answers only the invoking user. A new
  entry point must fail closed rather than post publicly.

### 1.2 Slash Command Routing

All skills share a single Slack slash command: `/fiona`. The first token after
`/fiona` is the **sub-command**; the remainder is the **argument text**.

```text
/fiona <sub-command> [argument text]
```

If no recognized sub-command is provided, Fiona responds with the help output
(equivalent to `/fiona help`).

### 1.3 Other Entry Points

The same skills are reachable without the slash command:

| Surface                       | How                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Channel or thread @-mention   | `@fiona help`, `@fiona ask <question>`, `@fiona search <query>`, `@fiona escalate` |
| DM and Assistant panel        | Type `help`, `ask <question>`, `search <query>`, or `escalate` directly      |

Keywords match only when they are the whole message (or, for `ask` and
`search`, are followed by text). A message such as "help me with X" is an
ordinary question for the LLM. `ask` and `search` answer privately wherever
they are used; any other @-mention in a channel gets a reply the whole channel
can see.

### 1.4 Deployment Switches

Escalation and ticket creation are off by default and are enabled per
deployment (see §5). A disabled skill does not appear in `/fiona help`, and its
keywords are treated as ordinary questions.

---

## 2. Skills Reference

### 2.1 `/fiona help`

**Purpose:** Display a usage guide listing the available skills, how to reach
Fiona, and who can see each kind of question.

**Behavior:**

1. Fiona responds with an **ephemeral message** containing:
   - A brief introduction to Fiona.
   - The skills available in this deployment, with short descriptions.
   - The ways to reach Fiona (slash command, @-mention, DM or Assistant panel).
   - Who can see a question and answer on each surface, and a note that
     conversations may be retained to review and improve answer quality.
   - A link to the Ed-Fi Terms of Use and Privacy Policy.
2. The response is static and does not invoke the LLM.

**Acceptance criteria:**

- [x] Response is ephemeral.
- [x] No LLM call is made.
- [x] Only skills enabled in the deployment are listed.
- [ ] Response renders correctly in Slack desktop and mobile (manual check).

---

### 2.2 `/fiona ask <question>`

**Purpose:** Let a user ask Fiona a question without @-mentioning her in the
channel, so the question and answer are visible only to them. This also works
in channels where Fiona has not been invited.

**Behavior:**

1. The user types `/fiona ask <question>` in any channel or DM.
2. Fiona acknowledges with an ephemeral "Thinking…" line, which the answer then
   replaces.
3. The answer goes through the same pipeline as a standard @-mention: system
   prompt, numbered Sources block, grounding rules (a question with no usable
   sources gets the standard decline), and domain filtering.
4. The answer is **ephemeral** and includes "Good Response" / "Bad Response"
   feedback buttons.
5. Thread context is **not** included; the question is treated as standalone.
   Users who need context-aware answers should @-mention Fiona in the thread.
6. The answer opens with a "You asked: …" line repeating the question, because
   an ephemeral answer is not threaded under it. Long questions are shortened
   in this line. Feedback uses this displayed text as the question stored with
   the rating.
7. Mentions inside the question are replaced with neutral markers (`@someone`,
   `#a-channel`) so no user or channel ID is displayed, stored with feedback, or
   captured. Fiona's own mention is removed.

**Why ephemeral answers are not streamed.** Slack offers no private equivalent
of streaming, and a streamed answer would post to the whole channel. The answer
is delivered in one ephemeral message instead.

**"Ephemeral" does not mean unrecorded.** Only the invoking user sees the
answer in Slack. When conversation capture is on, the question and answer are
kept for quality review, and a feedback click stores the rated answer.
User-facing copy says "only you see…" and that conversations may be retained,
and never describes them as private.

**Delivery failures.** If the answer cannot be delivered, the user gets a short
notice instead of silence, the interaction is recorded as an error, and the
conversation is not captured, because nobody saw the answer.

**Edge cases:**

- A blank question, or one containing only mentions, falls back to the help
  output. It is never sent to the LLM.
- A question over 3,000 characters is declined with a short message, is not sent
  to the LLM, and does not count toward the rate limit.
- An unexpected error while building the answer is answered privately with
  error copy, never publicly.
- Error replies carry no feedback buttons. A failed call and an empty
  generation have different copy; the empty case suggests rephrasing or
  `/fiona search`.
- An answer over Slack's message block limit is cut at a line break, with a
  notice suggesting a narrower question.

**Acceptance criteria:**

- [x] Response is ephemeral.
- [x] `@fiona ask <question>` behaves the same as the slash command.
- [x] The LLM pipeline (system prompt, citations, grounding, domain filtering)
      is reused.
- [x] Empty questions fall back to help.
- [x] Rate limiting applies.
- [x] Interaction is recorded with `interactionType: slash_ask`.

---

### 2.3 `/fiona search <query>`

**Purpose:** Return the top matching source snippets for a query **without**
synthesizing an answer, so users can browse raw sources and decide which
documents to read.

**Behavior:**

1. The user types `/fiona search <query>`.
2. Fiona queries the knowledge retrieval backend with the query.
3. Fiona responds with an **ephemeral message** listing the top matching
   sources (the count is configurable per deployment), each with:
   - A short excerpt of the matching content.
   - A hyperlink to the original source document.
4. No synthesized answer is generated.
5. If no results are found, Fiona says so and suggests rephrasing the query.
   If the search fails, Fiona shows a brief error message.

**Example output:**

> 🔍 **Search results for:** *"assessment API endpoints"*
>
> 1. **[Assessment API — Ed-Fi ODS/API Documentation](https://docs.ed-fi.org/...)**
>    *"The Assessment API provides endpoints for creating, reading, updating,
>    and deleting assessment metadata…"*
>
> 2. **[API Guidelines — Ed-Fi Alliance](https://www.ed-fi.org/...)**
>    *"All assessment resources follow the standard REST conventions described
>    in section 4.2…"*

**Edge cases:**

- An empty query falls back to the help output.

**Acceptance criteria:**

- [x] Response is ephemeral.
- [x] Returns source snippets with hyperlinks.
- [x] No synthesized or summarized answer is included.
- [x] Rate limiting applies.
- [x] Interaction is recorded with `interactionType: slash_search`.

---

### 2.4 `/fiona escalate`

**Purpose:** Hand a conversation to a human by posting an escalation notice in
a designated Slack channel.

**Behavior:**

1. The user invokes escalation through `/fiona escalate`, or by typing
   `escalate` in a DM, Assistant panel, or thread @-mention.
2. Fiona posts to the configured escalation channel:
   - The user who requested escalation.
   - Where the request came from, with a link back to the conversation when one
     exists (not for DMs).
   - The time of the request.
   - An optional @-mention of a configured Slack user group.
3. Where the entry point has a real conversation thread (the `escalate` keyword
   in a thread, DM, or Assistant panel), Fiona also includes an LLM-generated
   summary and posts the transcript as a reply to the escalation post.
4. The slash command carries no thread information, so a `/fiona escalate`
   post is **context-free**. It names the user and channel and says no
   conversation context was captured; Fiona does not read channel history to
   fill the gap.
5. The invoking user receives a confirmation: ephemeral for the slash command,
   in-thread for the keyword. Invoked from a DM, the confirmation says a team
   member will follow up.
6. The escalation is recorded as an interaction and its context is written to
   the feedback store.

**Edge cases:**

- If escalation is not configured, the channel cannot be posted to, or the
  post fails, the user gets an apology that points them to the team directly,
  and the failure is logged and recorded.
- If escalation is switched off for the deployment, no post is made and no
  interaction is recorded.

**Acceptance criteria:**

- [x] The escalation post names the requesting user.
- [x] The post links to the original thread where one exists.
- [x] Keyword escalations include a summary and transcript of the thread.
- [ ] Slash-command escalations include conversation history (not possible with
      Slack's slash-command payload; see §6).
- [x] The invoking user receives a confirmation or error message.
- [x] DM invocations are handled with a suitable message.
- [x] Rate limiting applies to the slash command.
- [x] Interaction is recorded with `interactionType: slash_escalate` (or
      `mention_escalate` / `assistant_escalate` for the keyword).

---

### 2.5 `/fiona ticket`

**Purpose:** Let a user file an Ed-Fi support ticket (bug, feature request, or
question) without leaving Slack.

**Behavior:**

1. The user types `/fiona ticket`. Fiona opens a form in which the user chooses
   the ticket type and describes the issue.
2. `/fiona bug` and `/fiona feature` open the same form with the type
   preselected. They are accepted but not advertised in help.
3. Conversationally, whole-message phrases such as "file a bug" or "request a
   feature" make Fiona offer to open the form.
4. If ticketing is switched on but its backing service is not configured, Fiona
   says so rather than failing silently.

**Acceptance criteria:**

- [x] The form opens for `/fiona ticket`, `bug`, and `feature`.
- [x] The skill appears in help only when ticketing is enabled.
- [x] Rate limiting applies.
- [x] Interaction is recorded with `interactionType` matching the word typed
      (`slash_ticket`, `slash_bug`, `slash_feature`).

---

## 3. Slack App Configuration

Skills require the following in the Slack app manifest:

| Change                         | Detail                                              |
| ------------------------------ | --------------------------------------------------- |
| **OAuth scope**                | `commands`                                          |
| **Slash command registration** | `/fiona`, with a description and usage hint         |
| **Interactivity**              | Enabled (feedback, ticket, and approval buttons)    |

Slash-command text is delivered unescaped, so angle brackets typed by the user
are literal text, not Slack link markup.

## 4. Configuration

| Variable                  | Default | Purpose                                                                  |
| ------------------------- | ------- | ------------------------------------------------------------------------ |
| `ESCALATION_ENABLED`      | `false` | Turns escalation on. Only the exact value `true` enables it.             |
| `ESCALATION_CHANNEL_ID`   | (unset) | Channel **ID** for escalation posts (the bot must be a member). Required when escalation is enabled. |
| `ESCALATION_USERGROUP_ID` | (unset) | Optional Slack user group to @-mention on escalation.                    |
| `TICKET_CREATION_ENABLED` | `false` | Turns ticket creation on. Only the exact value `true` enables it.        |

Changing a switch requires a restart. Escalation and ticketing default to off
so that neither goes live until the team has chosen to enable it.

## 5. Analytics

All skill invocations are recorded to the Cosmos DB `interactions` container
using the existing interaction schema (see parent PRD §2.6).

| `interactionType`                                   | Trigger                                               |
| --------------------------------------------------- | ----------------------------------------------------- |
| `slash_help`                                        | `/fiona help`                                         |
| `slash_ask`                                         | `/fiona ask`                                          |
| `slash_search`                                      | `/fiona search`                                       |
| `slash_escalate`                                    | `/fiona escalate`                                     |
| `mention_escalate` / `assistant_escalate`           | `escalate` keyword in a mention / DM or panel         |
| `slash_ticket`, `slash_bug`, `slash_feature`        | Ticket commands                                       |
| `slash_unknown`                                     | An unrecognized `/fiona` sub-command                  |

Failures, rate-limit rejections, and over-long questions are recorded on the
interaction as an error type rather than as separate interaction types.

---

## 6. Out of Scope / Future Directions

### 6.1 Proactive Escalation Detection

**Status:** Not implemented. Escalation today is explicit only: `/fiona
escalate` or the `escalate` keyword. The requirements below are retained for a
future release and would need their own Jira issue.

In addition to the explicit skill, Fiona would monitor regular conversational
messages for **escalation intent**.

#### Trigger

When a user's message in a conversation with Fiona contains language suggesting
they want human help — for example *"escalate"*, *"talk to a human"*, *"need a
real person"*, or *"this isn't helping"* — Fiona detects the intent and offers
to escalate.

> **Implementation note:** The detection mechanism (keyword matching, LLM
> classification, or a hybrid) is left open. The requirements below describe
> the user-facing behavior.

#### Behavior

1. Fiona responds in the current thread with interactive buttons:

   > *"It sounds like you'd like to connect with a human. Would you like me to
   > escalate this conversation?"*
   >
   > **[ Yes, escalate ]** · **[ No, keep trying ]**

2. **"Yes, escalate":** Fiona posts to the escalation channel with the same
   content as §2.4 (user, conversation history, link to thread) and confirms in
   the thread: *"✅ Done! Your conversation has been escalated. A team member
   will follow up shortly."*
3. **"No, keep trying":** Fiona sends an ephemeral acknowledgment — *"No problem
   — I'm here to help. Feel free to keep asking questions!"* — and the
   conversation continues normally.
4. Buttons that are not clicked stay visible. Fiona does not re-prompt.
5. Offers are recorded with `interactionType: auto_escalation`.

#### Acceptance criteria

- [ ] Escalation intent is detected during normal conversation flow, not only
      through the slash command.
- [ ] Fiona presents "Yes, escalate" / "No, keep trying" buttons.
- [ ] "Yes, escalate" triggers the same flow as `/fiona escalate`.
- [ ] "No, keep trying" dismisses the prompt without side effects.
- [ ] Detection does not trigger on every use of the word "help"; it targets
      phrases that indicate frustration or an explicit escalation request.

### 6.2 Conversation Context for Slash-Command Escalation

Slack's slash-command payload carries no thread reference, so `/fiona escalate`
cannot include a transcript or thread link today. Possible approaches include
reading recent channel history (which needs additional scopes and raises
privacy questions) or having the user invoke the keyword form in the thread.
