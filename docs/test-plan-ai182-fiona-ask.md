# Fiona ask — Slack test plan

**Feature:** `ask <question>`: a Fiona answer only you can see (AI-182, PR #127).
**Audience:** a tester working inside Slack. You don't need repo or deploy access, except
for the steps marked **🔧 maintainer**, which need someone who can read Fiona's stored
records or change its configuration. Skip those if you're on your own.
**Time:** about 40 minutes for sections A–E.

---

## Before you start

**1. Pay attention to who can see the answer, not only whether one arrives.** Testing that is
the main job of this plan. On every public surface, an `ask` answer must be visible **only to
you**, even though your question may be visible to the channel. Note the channel, thread, or
DM you typed in for every test.

**2. A second viewer helps.** For the visibility tests in section A, have a teammate (or a
second browser session signed in as someone else) watch the same channel. "I saw it" doesn't
tell you whether anyone else did.

**3. You share the same 20-actions-per-hour budget as every other Fiona command.** The limit
is per user and counts every `/fiona` and `@fiona` invocation. Sections A–D use most of it.
Run section E last, either an hour later or from a second account.

**4. Pick a test channel Fiona is in, plus your Fiona DM and the agent panel.**

---

## What this feature does, in one paragraph

`ask <question>` gets you the same kind of answer as a normal `@fiona` question: the same
system prompt, citations, grounding rules, and numbered Sources block. The difference is that
only you can see it in Slack. You can reach it four ways: the `/fiona ask` slash command,
`@fiona ask <question>` in a channel or thread, and bare `ask <question>` in your Fiona DM or
the agent panel. On the slash command and the @-mention, the answer arrives all at once as a
message only you can see, because Slack can't stream that kind of message. That message starts
with a *You asked: …* line repeating your question. In the DM and the
agent panel, which only you can see anyway, it streams like any other reply. The question is
treated on its own: earlier messages in the thread are not sent with it. Answers have 👍/👎
buttons; error messages don't. "Only you can see it" is about Slack: conversations with Fiona
may still be kept to review answer quality.

---

## A. Entry points and visibility

| # | Do this | Expect |
|---|---|---|
| **T1** | `/fiona ask What is the Ed-Fi Data Standard?` | A *":hourglass_flowing_sand: Thinking…"* line appears right away, visible only to you. The answer then **replaces** it, all at once rather than streaming. It starts with a small grey *You asked: What is the Ed-Fi Data Standard?* line. Slack labels it "Only visible to you" |
| **T2** | In a real channel: `@fiona ask What is the Ed-Fi ODS/API?` | Your question is visible to the channel. While Fiona works, the thread may show a "thinking" status. The **answer** is visible **only to you**: check with the second viewer that no answer from Fiona appears for them. Once the answer arrives, the "thinking" status goes away |
| **T3** | Inside a thread in that channel: `@fiona ask How do I authenticate to the ODS/API?` | Answer visible only to you, **in that thread**, not at the top of the channel. The thread's "thinking" status clears when the answer arrives |
| **T4** | In your Fiona DM: bare `ask What is Ed-Fi?` (no `@fiona`) | Answer streams into the DM like a normal reply |
| **T5** | In the agent panel: bare `ask What is Ed-Fi?` | Same as T4: streams in, reads like any other reply |

> **T2 and T3 matter most.** A channel `@fiona ask` answer must stay visible only to you,
> even though a normal `@fiona <question>` in a channel posts for everyone. If the second
> viewer sees Fiona's answer in T2 or T3, report it as a serious bug, not a nitpick.

## B. Question parsing

| # | Do this | Expect |
|---|---|---|
| **T6** | `/fiona ask` with nothing after it | Falls back to the help message. Not an empty answer, not an error |
| **T7** | In a channel: `@fiona ask` with nothing after it. Also try `@fiona ASK` | Fiona replies with the help message. It must **not** answer the word "ask" as a question |
| **T8** | In your DM: `ASK what is Ed-Fi`, `/ask what is Ed-Fi`, `fiona ask what is Ed-Fi` | All three behave like `ask what is Ed-Fi`. Capital letters, a leading slash, and a leading `fiona ` don't change anything |
| **T9** | In a thread with earlier messages about something specific, `@fiona ask what about the second one?` | Fiona has no idea what "the second one" means. Deliberate: `ask` sends only the question, not the thread |
| **T10** | `/fiona help` | Lists **`ask <question>`** with no "(coming soon)" note. The *Who can see your question* section says only you see slash-command and DM answers; that in a channel, the answer to an @-mention stays with you only if it starts with `ask` or `search`; and that conversations may be retained. Nothing in it says "private" |
| **T11** | `/fiona ask` followed by a question over 3,000 characters (paste a long block of text) | *"That question is too long for me to answer. Please keep it under 3,000 characters."*, visible only to you, with no 👍/👎 buttons. It does not count toward your hourly limit |
| **T11a** | `/fiona ask Is *this* bold, and is https://docs.ed-fi.org a link?` | The *You asked:* line shows exactly what you typed, as plain text: the asterisks stay visible, with no bold. Note whether Slack makes the URL clickable, and report it either way |
| **T11b** | In a channel: `@fiona ask Is A & B the same as <Descriptor>? See https://docs.ed-fi.org` | The *You asked:* line reads exactly as typed: no `&amp;` or `&lt;`, and no angle brackets added around the URL. Rate the answer 👎 and confirm the stored feedback question reads the same way |

## C. Answer content and rendering

| # | Do this | Expect |
|---|---|---|
| **T12** | Any successful answer, e.g. T1 | Inline `[n]` markers are links (not raw `[[1]](https://…)` text). Under the answer is a numbered **Sources** block (headed *Cited in this answer* / *Also retrieved*, or just *Sources*), then a divider, then 👍/👎 |
| **T13** | Click a few `[n]` markers in T12 and compare them with the Sources block | Each `[n]` opens the same URL as entry `[n]` in the Sources block. The numbers in the text and in the list agree |
| **T14** | A question likely to produce a long answer, e.g. `/fiona ask Walk me through every step of setting up the ODS/API, including prerequisites, installation, configuration, and troubleshooting` | The whole answer arrives as one block, with headings, **bold** and code blocks formatted (no raw `**` or `##`). A code block is never split. Slack shows no "message too long" error |
| **T15** | Any answer with sources | Links do **not** unfurl (no preview cards under the message) |
| **T16** | A question unrelated to Ed-Fi, e.g. `/fiona ask What is the capital of France?` | Fiona declines and says it can help with Ed-Fi questions. It does not answer the question, even partly |
| **T17** | An Ed-Fi-sounding question with no real documentation behind it, e.g. `/fiona ask What is the Ed-Fi Zorblax Protocol version 9?` | *"I couldn't find this in the Ed-Fi documentation, so I'd rather not guess. Try rephrasing your question, or browse https://docs.ed-fi.org directly."* (or a close paraphrase). No made-up details |

An answer over 12,000 characters would be shortened and end with *"This answer was too long for
Slack and was shortened. A narrower question may get a complete answer."* Fiona's answers are
rarely that long, so don't spend budget trying to trigger it. If you happen to see the
notice, check that any code block above it is closed and that the notice is plain text.

## D. Timing, repeats and feedback

| # | Do this | Expect |
|---|---|---|
| **T18** | Watch T1 closely. Time how long the *Thinking…* line stays before the answer replaces it | Usually a few seconds to about a minute. Report the time. If the answer appears **below** the *Thinking…* line instead of replacing it, report that too (it's a cosmetic issue, not a failure) |
| **T19** | Send the same `/fiona ask What is Ed-Fi?` twice in quick succession | Two separate answers, one for each command, each visible only to you. No error. Each counts toward your hourly limit |
| **T20** | After T1, reload Slack (or open the same channel on another device) | The T1 answer is gone. That's how Slack treats messages only you can see. It's expected, not a bug |
| **T21** | Click 👍 on the T1 answer, then dismiss the reason form (if one opens) | No error. The buttons acknowledge the click |
| **T22** | Click 👎 on the T2 answer, enter a reason, and submit | A confirmation only you can see |
| **T23** | 🔧 **maintainer:** check the feedback record from T22 | It holds **both** your question (as shown in the *You asked:* line) and Fiona's answer text |
| **T24** | Click 👎 on the T5 (agent panel) answer and submit a reason. 🔧 **maintainer:** check the record | You see a confirmation. The record holds **both** your question and the answer |

## E. Rate limiting (do this last)

| # | Do this | Expect |
|---|---|---|
| **T25** | Keep sending `/fiona ask What is Ed-Fi?` until you pass the 20-per-hour limit | *":no_entry: You've reached the request limit. Please wait N minutes before trying again."*, replacing the *Thinking…* line, visible only to you. No answer |

---

## F. Error handling: 🔧 maintainer only

Skip this unless a maintainer with access to the Perplexity key or the deployment settings can
break connectivity for you. You can't trigger these from Slack alone.

| # | Condition | Expect |
|---|---|---|
| **T26** | Perplexity unreachable or key invalid, then `/fiona ask What is Ed-Fi?` | *":warning: Sorry, I could not answer that right now. Please try again in a few minutes."*, replacing the *Thinking…* line, visible only to you, with **no** 👍/👎 buttons and **no** Sources block |
| **T27** | Same condition, `@fiona ask What is Ed-Fi?` in a channel | The same error copy, visible only to you. The second viewer must not see an error posted to the channel. The thread's "thinking" status clears |

---

## G. Regression check: does everything else still work?

This feature changes shared routing files (`command-dispatch.js`, `command-handler.js`,
`fiona.js`) and the feedback handlers.

| # | Do this | Expect |
|---|---|---|
| **T28** | A normal channel question with no keyword: `@fiona What is the Ed-Fi Data Standard?` | Posts **publicly** in the thread, with the Sources block. This is the opposite of T2, and that's intended |
| **T29** | `/fiona search Ed-Fi Data Standard` | Search still returns its own source list (no synthesized answer), visible only to you |
| **T30** | `/fiona help` | Lists `help`, `ask <question>`, `search <query>` (and `ticket`, if ticketing is switched on in this deployment) |
| **T31** | Rate an `ask` answer, a `search` result, and a normal `@fiona` answer | Each set of buttons works on its own. Clicking one doesn't affect the others |

---

## Reporting back

For each failure, send:

- the test number;
- exactly what you typed;
- where you typed it: channel, thread, DM, or agent panel;
- a screenshot of what Slack showed, including what the second viewer saw for the section A
  and F tests.

"The answer looked wrong" isn't something anyone can act on. This is: "T2, posted
`@fiona ask x` in #test, the second viewer also saw the answer."

Also worth reporting even though it's not a failure:

- Copy that reads oddly. In particular, check that the *Who can see your question* lines in
  `/fiona help` (T10) match what you saw in T2 (only you) and T28 (everyone).
- How long you waited in T18, and whether getting the answer all at once (T1–T3) instead of
  streamed (T4–T5) felt slow enough to matter.
- Sources lists that look long next to a short answer.

---

## Known and expected: please don't file these

- **The answer doesn't stream on the slash command or channel @-mention.** Slack can't stream
  a message only you can see, so the answer arrives in one piece. Fiona would only have shown
  the full answer at the end anyway, because citations can't be linked until the last chunk
  arrives.
- **Answers only you can see disappear when you reload Slack.** That's Slack's behavior for
  these messages, not Fiona's.
- **`ask` ignores the thread.** Deliberate: the question is treated on its own. For an answer
  that uses the thread, use a normal `@fiona` question in the thread.
- **Bare `search` with no query isn't a command.** It's answered as a normal question. Bare
  `ask` is different: it shows the help message (T7).
- **The *You asked:* line shortens a very long question.** It shows the first 300 characters.
  Feedback saves the question as shown in that line.

---

*Drafted with AI assistance from the branch source; it has not itself been run against a live
Slack workspace. Read it through before you hand it over. If a step doesn't match what the
tester sees, the plan may be wrong rather than the code.*
