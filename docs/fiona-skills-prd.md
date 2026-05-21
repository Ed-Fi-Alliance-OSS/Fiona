# Fiona Skills — Product Requirements Document

> **Parent document:** [Fiona Slack PRD](fiona-slack-prd.md) (§2.9) \
> **Status:** Draft \
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
- **Composability** — Skills are implemented as independent handlers, making it
  straightforward to add new skills without modifying existing ones.

### 1.2 Slash Command Routing

All skills share a single Slack slash command: `/fiona`. The first token after
`/fiona` is the **sub-command**; the remainder is the **argument text**.

```
/fiona <sub-command> [argument text]
```

If no recognized sub-command is provided, Fiona responds with the help output
(equivalent to `/fiona help`).

---

## 2. Skills Reference

### 2.1 `/fiona help`

**Purpose:** Display a usage guide listing all available skills with brief
descriptions and example usage.

**Behavior:**

1. Fiona responds with an **ephemeral message** (visible only to the invoking
   user) containing:
   - A brief introduction to Fiona and how to interact with her.
   - A table or list of available skills with descriptions.
   - Example questions or prompts that Fiona answers well.
2. The response is static and does not invoke the LLM.

**Example output:**

> 👋 **Hi! I'm Fiona** — your AI companion for Ed-Fi documentation, standards,
> and implementation guidance.
>
> **Slash commands:**
>
> | Command                 | Description                                       |
> | ----------------------- | ------------------------------------------------- |
> | `/fiona help`           | Show this usage guide                             |
> | `/fiona ask <question>` | Ask Fiona a question privately                    |
> | `/fiona search <query>` | Search Ed-Fi sources without a synthesized answer |
> | `/fiona escalate`       | Escalate the current conversation to a human      |
>
> **You can also mention me directly:**
> `@Fiona What is the Ed-Fi Data Standard?`

**Acceptance criteria:**

- [ ] Response is ephemeral.
- [ ] Response renders correctly in Slack desktop and mobile.
- [ ] No LLM call is made.

---

### 2.2 `/fiona ask <question>`

**Purpose:** Allow a user to ask Fiona a question without @-mentioning her in
the channel. This is useful when a user prefers not to surface the question
publicly in the conversation, or when Fiona has not been invited to the channel.

**Behavior:**

1. The user types `/fiona ask <question>` in any channel or DM.
2. Fiona sends an **ephemeral message** (visible only to the invoking user) with
   a streamed LLM response.
3. The response follows the same LLM pipeline as a standard `app_mention` —
   including system prompt, citation handling, and domain filtering — but is
   delivered ephemerally rather than in-thread.
4. Thread context from the current channel is **not** included (the question is
   treated as standalone). If the user needs context-aware answers, they should
   use @-mentions in a thread instead.
5. Feedback buttons ("Good Response" / "Bad Response") are included in the
   ephemeral response.

**Edge cases:**

- If `<question>` is empty or blank, Fiona responds with the help output
  (equivalent to `/fiona help`).

**Acceptance criteria:**

- [ ] Response is ephemeral and streamed.
- [ ] LLM pipeline (system prompt, citations, domain filtering) is reused.
- [ ] Empty questions fall back to `/fiona help`.
- [ ] Rate limiting applies (counts toward the user's rate-limit window).
- [ ] Interaction is recorded to Cosmos DB with `interactionType: slash_ask`.

---

### 2.3 `/fiona search <query>`

**Purpose:** Return the top matching source snippets for a query **without**
synthesizing an answer. This lets users browse raw sources and decide for
themselves which documents to read.

**Behavior:**

1. The user types `/fiona search <query>`.
2. Fiona calls the knowledge retrieval backend (Perplexity `search` or
   equivalent) with the query.
3. Fiona responds with an **ephemeral message** containing the top 3–5 source
   snippets, each including:
   - A brief excerpt or snippet of the matching content.
   - A hyperlink to the original source document.
4. No synthesized answer is generated — the response is purely a list of
   sources.
5. If no results are found, Fiona responds with a message indicating that no
   matching sources were found and suggests rephrasing the query.

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
>
> 3. **[Data Standard 5.1 — Assessments Domain](https://docs.ed-fi.org/...)**
>    *"The Assessments domain captures information about assessments,
>    objectives, and performance levels…"*

**Edge cases:**

- If `<query>` is empty, Fiona responds with the help output.

**Acceptance criteria:**

- [ ] Response is ephemeral.
- [ ] Returns 3–5 source snippets with hyperlinks.
- [ ] No synthesized or summarized answer is included.
- [ ] Rate limiting applies.
- [ ] Interaction is recorded to Cosmos DB with `interactionType: slash_search`.

---

### 2.4 `/fiona escalate`

**Purpose:** Escalate the current conversation to a human agent by posting a
summary in the designated `#escalation` channel.

**Behavior:**

1. The user types `/fiona escalate` in a channel where a conversation is
   occurring.
2. Fiona posts a **private message** in the `#escalation` channel containing:
   - The name (display name) of the user who requested escalation.
   - A link back to the original channel and thread (if applicable).
   - A summary or transcript of the recent conversation history in the
     originating channel/thread.
3. Fiona records the escalation event in Cosmos DB with `interactionType: slash_escalate` and relevant metadata (user ID,
   channel ID, timestamp) and writes the context into the `feedback` collection.
4. Fiona sends an **ephemeral confirmation** to the invoking user:
   *"✅ Your conversation has been escalated to #escalation. A team member will
   follow up shortly."*
5. The escalation channel name is configurable via environment variable
   (`ESCALATION_CHANNEL`, default: `#escalation`).

**Edge cases:**

- If the user invokes `/fiona escalate` in a DM (no channel thread to
  escalate), Fiona responds with an ephemeral message:
  *"✅ A team member will follow up shortly."*
- If the escalation channel cannot be found or Fiona lacks permission to post,
  Fiona responds with an ephemeral error and logs the failure.

**Acceptance criteria:**

- [ ] Escalation post appears in `#escalation` with user name and conversation
      history.
- [ ] Escalation post includes a link to the original thread.
- [ ] Ephemeral confirmation is sent to the invoking user.
- [ ] DM invocations are handled gracefully with a helpful message.
- [ ] Rate limiting applies.
- [ ] Interaction is recorded to Cosmos DB with
      `interactionType: slash_escalate`.

---

## 3. Proactive Escalation Detection

In addition to the explicit `/fiona escalate` skill, Fiona monitors regular
conversational messages for **escalation intent**.

### 3.1 Trigger

When a user's message in a conversation with Fiona contains language suggesting
they want human help — for example, words or phrases such as *"escalate"*,
*"talk to a human"*, *"need a real person"*, or *"this isn't helping"* — Fiona
detects this intent and offers to escalate.

> **Implementation note:** The exact detection mechanism (keyword matching, LLM
> classification, or a hybrid approach) is an implementation decision. The
> requirements below describe the user-facing behavior.

### 3.2 Behavior

1. Fiona responds in the current thread/conversation with a message containing
   interactive buttons:

   > *"It sounds like you'd like to connect with a human. Would you like me to
   > escalate this conversation?"*
   >
   > **[ Yes, escalate ]** · **[ No, keep trying ]**

2. **If the user clicks "Yes, escalate":**
   - Fiona posts in the `#escalation` channel with the same content and format
     described in §2.4 (user name, conversation history, link to thread).
   - Fiona sends a confirmation in the current thread:
     *"✅ Done! Your conversation has been posted in #escalation. A team member
     will follow up shortly."*

3. **If the user clicks "No, keep trying":**
   - Fiona sends an ephemeral acknowledgment:
     *"No problem — I'm here to help. Feel free to keep asking questions!"*
   - The conversation continues normally.

4. Buttons expire gracefully — if not clicked, they remain visible but Fiona
   does not re-prompt.

### 3.3 Acceptance Criteria

- [ ] Escalation intent is detected during normal conversation flow (not only
      via slash command).
- [ ] Fiona presents "Yes, escalate" / "No, keep trying" interactive buttons.
- [ ] "Yes, escalate" triggers the same escalation flow as `/fiona escalate`.
- [ ] "No, keep trying" dismisses the prompt without side effects.
- [ ] Detection does not trigger on every use of the word "help" — it should
      target phrases that indicate frustration or explicit escalation requests.

---

## 4. Slack App Configuration Changes

Enabling Skills requires the following updates to the Slack app manifest
(`apps/fiona-slack/manifest.json`):

| Change                         | Detail                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| **OAuth scope**                | Add `commands` scope                                                   |
| **Slash command registration** | Register `/fiona` with a description and usage hint                   |
| **Interactivity**              | Ensure interactivity is enabled (required for escalation buttons)     |

---

## 5. Environment Variables

| Variable              | Default        | Purpose                                            |
| --------------------- | -------------- | -------------------------------------------------- |
| `ESCALATION_CHANNEL`  | `#escalation`  | Slack channel where escalation posts are created   |

---

## 6. Module Structure (Proposed)

```none
src/
├── listeners/
│   ├── commands/
│   │   └── fiona.js              # Slash command dispatcher: routes to skill handlers
│   └── actions/
│       ├── feedback.js            # (existing) Feedback button click handler
│       └── escalation.js         # Escalation button click handler (Yes/No)
├── skills/
│   ├── help.js                   # /fiona help handler
│   ├── ask.js                    # /fiona ask handler
│   ├── search.js                 # /fiona search handler
│   └── escalate.js               # /fiona escalate handler + proactive detection
```

---

## 7. Analytics

All skill invocations are recorded to the Cosmos DB `interactions` container
using the existing interaction document schema (see parent PRD §2.6).

New `interactionType` values:

| Value             | Trigger                                    |
| ----------------- | ------------------------------------------ |
| `slash_help`      | `/fiona help` invoked                      |
| `slash_ask`       | `/fiona ask` invoked                       |
| `slash_search`    | `/fiona search` invoked                    |
| `slash_escalate`  | `/fiona escalate` invoked                  |
| `auto_escalation` | Proactive escalation offered via detection |
