# Fiona Skills — Product Requirements Document

> -**Owner:** Ed-Fi Alliance
> -**Parent document:** [Fiona Slack PRD](fiona-slack-prd.md) (§2.9)
> -**Jira Project:** AI

## 1. Overview

Fiona Skills are structured actions invoked through the `/fiona` Slack slash
command **or** through equivalent keyword commands typed in a thread, the
Assistant panel, a DM, or an @-mention. They provide purpose-built interactions
that complement Fiona's existing conversational interface (channel mentions,
DMs, and the Assistant panel).

### 1.1 Design Goals

- **Discoverability** — Users can type `/fiona help` to see everything Fiona can
  do, lowering the barrier to first use.
- **Precision** — Each skill performs a single, well-defined action with
  predictable output, reducing ambiguity compared to free-form prompts.
- **Composability** — Skills are implemented as independent handlers, making it
  straightforward to add new skills without modifying existing ones.

### 1.2 Command Routing

All skills share a single Slack slash command: `/fiona`. The first token after
`/fiona` is the **sub-command**; the remainder is the **argument text**.

```plaintext
/fiona <sub-command> [argument text]
```

If no recognized sub-command is provided, Fiona responds with the help output
(equivalent to `/fiona help`).

### 1.3 Invocation Contexts

Slack delivers slash commands only from a conversation's **main message box**.
Slash commands **do not** function inside a thread or in the Assistant panel —
Slack treats the Assistant panel the same as a thread, and neither surface
executes `/fiona`. Because much of Fiona's usage occurs in threads and the
Assistant panel, relying on the slash command alone would leave skills
unreachable in exactly the places users most often interact with Fiona.

To provide parity, Fiona recognizes skills through two complementary paths:

- **Slash command (channel main message box):** `/fiona <sub-command>
  [argument text]` — for example, `/fiona help`.
- **Keyword command (everywhere else Fiona reads messages):** the sub-command
  keyword typed as an ordinary message, optionally prefixed with the word
  `fiona`. For example, `help` or `fiona help`. Keyword commands are recognized
  wherever Fiona already processes messages, including:
  - threads and the Assistant panel (where slash commands do not work);
  - direct messages with Fiona;
  - channel and thread **@-mentions** — for example, `@Fiona help` (the mention
    is stripped before the keyword is evaluated).

The two paths route to the same skill handlers and produce equivalent behavior;
they differ only in how the invocation is received and (where noted) in how the
response is delivered.

#### 1.3.1 Keyword Command Parsing

When Fiona receives an ordinary message (in a thread, the Assistant panel, a
DM, or via @-mention), it evaluates the message to decide whether it is a skill
invocation or normal conversation. Matching is intentionally **strict** so that
ordinary questions that merely begin with a command word are not hijacked:

1. Any @-mention is stripped, leading and trailing whitespace is trimmed, and
   matching is **case-insensitive**.
2. If the message begins with the literal word `fiona`, that word is treated as
   an optional prefix and discarded before evaluating the sub-command.
3. The remaining text is then matched against the recognized sub-commands:
   - **`help`** matches **only when it is the entire (post-prefix) message**.
     Anything following `help` (for example, "help me understand the ODS API")
     does **not** match and is treated as normal conversation.
   - **`ask`** and **`search`** match only when the keyword is immediately
     followed by **non-empty argument text** (for example, `ask <question>` or
     `search <query>`). The text after the keyword is the **argument text**. A
     bare `ask` or `search` with no argument does **not** match.
4. If a sub-command matches, the message is handled as that skill invocation.
5. If nothing matches — including a bare `fiona` with no following
   sub-command, or a bare `ask`/`search` with no argument — the message is
   treated as normal conversational input and follows Fiona's existing
   message-handling flow. It is **not** routed to a skill handler.

This means each skill is reachable through several equivalent forms, illustrated
here with `help`:

| Context                       | Form           |
| ----------------------------- | -------------- |
| Channel main box              | `/fiona help`  |
| Thread / panel / DM (bare)    | `help`         |
| Thread / panel / DM (prefix)  | `fiona help`   |
| Channel or thread @-mention   | `@Fiona help`  |

#### 1.3.2 Response Delivery in Keyword Contexts

Keyword invocations arrive as message events rather than as a slash command, so
they do not carry a slash-command `response_url` and cannot rely on the slash
command's ephemeral acknowledgement. The slash command itself may continue to
respond **ephemerally** (visible only to the invoking user).

For keyword invocations, the response-visibility model — whether responses are
ephemeral (where the surface supports it) or posted as a normal message visible
to all participants in the thread/panel/DM — is an **open implementation
decision** to be settled during development. See §8. Skill acceptance criteria
below therefore avoid prescribing a specific visibility for keyword
invocations.

## 2. Skills Reference

### 2.1 `/fiona help`

**Invocation:** `/fiona help` (channel), or `help` / `fiona help` / `@Fiona help`
(thread, Assistant panel, or DM). The `help` keyword matches only as the whole
message (see §1.3.1). See §1.3.

**Purpose:** Display a usage guide listing all available skills with brief
descriptions and example usage.

**Behavior:**

1. Fiona responds with a message (ephemeral for the slash command; visibility
   for keyword invocations per §1.3.2) containing:
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
> **In a thread, the Assistant panel, or a DM**, slash commands don't work —
> just type the command on its own (with or without `fiona`): `help`,
> `ask <question>`, `search <query>`, or `escalate`. You can also @-mention the
> command (e.g. `@Fiona help`).
>
> **You can also mention me directly:**
> `@Fiona What is the Ed-Fi Data Standard?`

**Acceptance criteria:**

- [ ] Slash command response is ephemeral; keyword-invocation visibility follows
      the decision recorded in §1.3.2 / §8.
- [ ] Invokable as `/fiona help`, `help`, `fiona help`, and `@Fiona help`.
- [ ] `help` matches only as the whole message; "help …" with trailing text is
      treated as normal conversation.
- [ ] Response renders correctly in Slack desktop and mobile.
- [ ] No LLM call is made.

### 2.2 `/fiona ask <question>`

**Invocation:** `/fiona ask <question>` (channel), or `ask <question>` /
`fiona ask <question>` / `@Fiona ask <question>` (thread, Assistant panel, or
DM). The keyword forms require non-empty question text (see §1.3.1). See §1.3.

**Purpose:** Allow a user to ask Fiona a question without @-mentioning her in
the channel. This is useful when a user prefers not to surface the question
publicly in the conversation, or when Fiona has not been invited to the channel.

**Behavior:**

1. The user invokes the skill via any of the forms listed under **Invocation**
   above.
2. Fiona sends a streamed LLM response (ephemeral for the slash command;
   keyword-invocation visibility per §1.3.2).
3. The response follows the same LLM pipeline as a standard `app_mention` —
   including system prompt, citation handling, and domain filtering.
4. Thread context is **not** included (the question is treated as standalone),
   even when the skill is invoked by typing `ask <question>` inside a thread. If
   the user needs context-aware answers, they should @-mention Fiona normally
   (or, in the Assistant panel, ask normally) instead of using the `ask` skill.
   See the open question in §8 regarding thread-context behavior for in-thread
   invocations.
5. Feedback buttons ("Good Response" / "Bad Response") are included in the
   response.

**Edge cases:**

- For the **slash command**, if `<question>` is empty or blank, Fiona responds
  with the help output (equivalent to `/fiona help`).
- For the **keyword forms**, a bare `ask` with no question text does not match
  the skill and is treated as normal conversation (see §1.3.1).

**Acceptance criteria:**

- [ ] Response is streamed; slash command is ephemeral, keyword-invocation
      visibility per §1.3.2 / §8.
- [ ] Invokable as `/fiona ask`, `ask <question>`, `fiona ask <question>`, and
      `@Fiona ask <question>`.
- [ ] LLM pipeline (system prompt, citations, domain filtering) is reused.
- [ ] Empty slash-command questions fall back to the help output; bare keyword
      `ask` falls through to normal conversation.
- [ ] Rate limiting applies (counts toward the user's rate-limit window).
- [ ] Interaction is recorded to Cosmos DB with `interactionType: slash_ask`.

### 2.3 `/fiona search <query>`

**Invocation:** `/fiona search <query>` (channel), or `search <query>` /
`fiona search <query>` / `@Fiona search <query>` (thread, Assistant panel, or
DM). The keyword forms require non-empty query text (see §1.3.1). See §1.3.

**Purpose:** Return the top matching source snippets for a query **without**
synthesizing an answer. This lets users browse raw sources and decide for
themselves which documents to read.

**Behavior:**

1. The user invokes the skill via any of the forms listed under **Invocation**
   above.
2. Fiona calls the knowledge retrieval backend (Perplexity `search` or
   equivalent) with the query.
3. Fiona responds (ephemeral for the slash command; keyword-invocation
   visibility per §1.3.2) with the top 3–5 source snippets, each including:
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

- For the **slash command**, if `<query>` is empty, Fiona responds with the help
  output.
- For the **keyword forms**, a bare `search` with no query text does not match
  the skill and is treated as normal conversation (see §1.3.1).

**Acceptance criteria:**

- [ ] Slash command response is ephemeral; keyword-invocation visibility per
      §1.3.2 / §8.
- [ ] Invokable as `/fiona search`, `search <query>`, `fiona search <query>`,
      and `@Fiona search <query>`.
- [ ] Returns 3–5 source snippets with hyperlinks.
- [ ] No synthesized or summarized answer is included.
- [ ] Rate limiting applies.
- [ ] Interaction is recorded to Cosmos DB with `interactionType: slash_search`.

### 2.4 `/fiona escalate`

**Invocation:** `/fiona escalate` (channel), or `escalate` / `fiona escalate` /
`@Fiona escalate` (thread, Assistant panel, or DM). See §1.3. Because escalation
operates on the surrounding conversation history, the thread and Assistant-panel
forms are the primary way users will reach this skill.

> **Note:** PR #62 implements keyword routing for `help`, `ask`, and `search`
> only. The keyword forms for `escalate` described here are target behavior and
> are not yet implemented.

**Purpose:** Escalate the current conversation to a human agent by posting a
summary in the designated `#escalation` channel.

**Behavior:**

1. The user invokes the skill via any of the forms listed under **Invocation**
   above, from a conversation that is occurring.
2. Fiona posts a **private message** in the `#escalation` channel containing:
   - The name (display name) of the user who requested escalation.
   - A link back to the original channel and thread (if applicable).
   - A summary or transcript of the recent conversation history in the
     originating channel/thread.
3. Fiona records the escalation event in Cosmos DB with `interactionType: slash_escalate` and relevant metadata (user ID,
   channel ID, timestamp) and writes the context into the `feedback` collection.
4. Fiona sends a confirmation to the invoking user (ephemeral for the slash
   command; keyword-invocation visibility per §1.3.2):
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
- [ ] Confirmation is sent to the invoking user (ephemeral for the slash
      command; keyword-invocation visibility per §1.3.2 / §8).
- [ ] Invokable as `/fiona escalate`, `escalate`, `fiona escalate`, and
      `@Fiona escalate` (keyword forms are target behavior; see note above).
- [ ] DM invocations are handled gracefully with a helpful message.
- [ ] Rate limiting applies.
- [ ] Interaction is recorded to Cosmos DB with
      `interactionType: slash_escalate`.

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

## 4. Slack App Configuration Changes

Enabling Skills requires the following updates to the Slack app manifest
(`apps/fiona-slack/manifest.json`):

- **OAuth scope:** Add the `commands` scope.
- **Slash command registration:** Register `/fiona` with a description and usage
  hint.
- **Interactivity:** Ensure interactivity is enabled (required for escalation
  buttons).
- **Event subscriptions:** Ensure the message/`app_mention` events that cover
  threads, the Assistant panel, DMs, and @-mentions (e.g. `app_mention`,
  `message.channels`, `message.im`, and Assistant-thread message events) are
  subscribed, so keyword commands (§1.3) can be detected. These are reused from
  Fiona's existing conversational handling.

## 5. Environment Variables

| Variable              | Default        | Purpose                                            |
| --------------------- | -------------- | -------------------------------------------------- |
| `ESCALATION_CHANNEL`  | `#escalation`  | Slack channel where escalation posts are created   |

## 6. Module Structure (Proposed)

This reflects the structure introduced in PR #62 (AI-133/AI-134) for keyword
routing of `help`/`ask`/`search`:

```none
src/
├── listeners/
│   ├── commands/
│   │   ├── fiona.js              # Slash command entry point (channel main box)
│   │   └── command-handler.js   # Shared module: parseCommandKeyword + routeCommandViaSay + text constants (§1.3.1)
│   ├── assistant/
│   │   └── message.js           # (existing) Assistant-panel/DM handler; calls command-handler before the LLM
│   ├── events/
│   │   └── app_mention.js       # (existing) @-mention handler; calls command-handler before the LLM
│   └── actions/
│       ├── feedback.js          # (existing) Feedback button click handler
│       └── escalation.js        # Escalation button click handler (Yes/No) — future
```

The slash command entry point and the existing message/@-mention handlers all
delegate to the shared `command-handler`, which normalizes the input, strips an
optional `fiona` prefix, applies the matching rules in §1.3.1, and routes to the
skill response. Keyword routing runs inside the existing rate-limit/telemetry
wrapper, before the LLM is invoked. Response visibility for keyword invocations
is the open decision described in §1.3.2.

## 7. Analytics

All skill invocations are recorded to the Cosmos DB `interactions` container
using the existing interaction document schema (see parent PRD §2.6).

The `interactionType` values below apply regardless of invocation path — the
slash command and the keyword forms (§1.3) for a given skill record the same
`interactionType`. To preserve analytic insight into how skills are reached, the
invocation source (e.g. `slash`, `keyword_thread`, `keyword_panel`,
`keyword_dm`, `keyword_mention`) SHOULD be captured in the interaction document
metadata. The `slash_` prefix is retained for continuity with the original
naming.

New `interactionType` values:

| Value             | Trigger                                    |
| ----------------- | ------------------------------------------ |
| `slash_help`      | `help` skill invoked (any path)            |
| `slash_ask`       | `ask` skill invoked (any path)             |
| `slash_search`    | `search` skill invoked (any path)          |
| `slash_escalate`  | `escalate` skill invoked (any path)        |
| `auto_escalation` | Proactive escalation offered via detection |

## 8. Open Questions

- **Thread context for in-thread `ask`:** §2.2 currently keeps `ask` standalone
  (no thread context) even when invoked by typing `ask <question>` inside a
  thread, for behavioral parity with the slash command. Should an in-thread
  `ask` instead incorporate the surrounding thread context, given the user is
  already inside that thread? Resolving this affects the §2.2 behavior.
- **Response visibility for keyword invocations:** The slash command can respond
  ephemerally, but keyword invocations (thread, Assistant panel, DM, @-mention)
  arrive as message events without a slash `response_url`. Whether keyword
  responses should be ephemeral (where the surface supports it) or posted as a
  normal message visible to all participants is an **open implementation
  decision** to be settled during development (§1.3.2). PR #62's current
  implementation posts keyword responses as normal visible messages.

### 8.1 Decision Log

- **Keyword disambiguation (decided):** To avoid hijacking ordinary questions
  that begin with a command word, the parser requires `help` to be the entire
  message and requires `ask`/`search` to be followed by non-empty argument text;
  otherwise the message is treated as normal conversation (§1.3.1). This
  supersedes the earlier proposal of leading-token (prefix) matching.
