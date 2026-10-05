# Fiona ask — Slack test plan

**Feature:** `ask <question>`: a private, synthesized Fiona answer (AI-182), open as PR #83,
stacked on AI-231 (#118) → AI-230 (#117) → `main`.
**Audience:** a tester working entirely inside Slack. You don't need repo or deploy access.
**Time:** about 30 minutes for the core pass (T1–T19).

---

## Before you start

**1. Pay attention to who can see the answer, not only whether one arrives.** Testing that is
the main job of this plan. On every public surface, an `ask` answer must be visible **only to
you**. The first version of this branch got that wrong: it streamed the answer into the
channel for everyone and called it private. Note the channel, thread, or DM you typed in for
every test.

**2. A second viewer helps.** For the visibility tests in section A, have a teammate (or a
second browser session signed in as someone else) watch the same channel. "I saw it" doesn't
tell you whether anyone else did.

**3. You share the same 20-actions-per-hour budget as every other Fiona command.** The limit
is per user and counts every `/fiona` and `@fiona` invocation. The core pass uses about 17;
T20 then spends the rest on purpose, so do it last.

**4. Pick a test channel Fiona is in, plus your Fiona DM and the agent panel.**

---

## What this feature does, in one paragraph

`ask <question>` gets you the same kind of answer as a normal `@fiona` question: the same
system prompt, citations, grounding rules, and numbered Sources block. The difference is that
only you can see it. You can reach it four ways: the `/fiona ask` slash command,
`@fiona ask <question>` in a channel or thread, and bare `ask <question>` in your Fiona DM or
the agent panel. On the first two the answer arrives all at once as a message only you can
see, because Slack can't stream a private message. In the DM and the agent panel, which are
already private, it streams like any other reply. The question is treated on its own: earlier
messages in the thread are not sent with it. Every answer, including the error cases, has
👍/👎 buttons.

---

## A. Entry points and visibility

| # | Do this | Expect |
|---|---|---|
| **T1** | `/fiona ask What is the Ed-Fi Data Standard?` | Answer visible **only to you** (Slack labels it "Only visible to you"), arriving all at once, not streaming |
| **T2** | In a real channel: `@fiona ask What is the Ed-Fi ODS/API?` | Your question is visible to the channel. The **answer** is visible **only to you**: check with the second viewer that nothing from Fiona appears for them |
| **T3** | Inside a thread in that channel: `@fiona ask How do I authenticate to the ODS/API?` | Answer visible only to you, **in that thread**, not at the top of the channel |
| **T4** | In your Fiona DM: bare `ask What is Ed-Fi?` (no `@fiona`) | Answer streams into the DM like a normal reply |
| **T5** | In the agent panel: bare `ask What is Ed-Fi?` | Same as T4: streams in, reads like any other reply |

> **T2 and T3 matter most.** A channel `@fiona ask` answer must stay private, even though a
> normal `@fiona <question>` in a channel posts for everyone. If the second viewer sees
> Fiona's answer in T2 or T3, that's the exact bug this branch fixed coming back. Report it
> as a regression, not a nitpick.

## B. Question parsing

| # | Do this | Expect |
|---|---|---|
| **T6** | `/fiona ask` with nothing after it | Falls back to the help message. Not an empty answer, not an error |
| **T7** | Bare `ask` with no question, in your DM | Not treated as a command. Fiona answers the literal word "ask" as a normal question |
| **T8** | In your DM: `ASK what is Ed-Fi`, `/ask what is Ed-Fi`, `fiona ask what is Ed-Fi` | All three behave like `ask what is Ed-Fi`. Capital letters, a leading slash, and a leading `fiona ` don't change anything |
| **T9** | In a thread with earlier messages about something specific, `@fiona ask what about the second one?` | Fiona has no idea what "the second one" means. Deliberate: `ask` sends only the question, not the thread |
| **T10** | `/fiona help` | Lists **`ask <question>`** with no "(coming soon)" note. The *Question privacy* section says an @-mention answer is private only with `@fiona ask` or `@fiona search`, and that any other @-mention gets a reply the whole channel can see |

## C. Answer content and rendering

| # | Do this | Expect |
|---|---|---|
| **T11** | Any successful answer, e.g. T1 | Inline `[n]` markers are links. Under the answer is a numbered **Sources** block (headed *Cited in this answer* / *Also retrieved*, or just *Sources*), then a divider, then 👍/👎 |
| **T12** | Click a few `[n]` markers in T11 and compare them with the Sources block | Each `[n]` opens the same URL as entry `[n]` in the Sources block. The numbers in the text and in the list agree |
| **T13** | A question likely to produce a long answer, e.g. `/fiona ask Walk me through every step of setting up the ODS/API, including prerequisites, installation, configuration, and troubleshooting` | The whole answer arrives as one block, with headings, **bold** and code blocks formatted (no raw `**` or `##`). A code block is never split. Slack shows no "message too long" error. Only an answer over 12,000 characters is shortened, ending with *This answer was shortened to fit in Slack.* |
| **T14** | Any answer with sources | Links do **not** unfurl (no preview cards under the message) |
| **T15** | A question unrelated to Ed-Fi, e.g. `/fiona ask What is the capital of France?` | Fiona declines and says it can help with Ed-Fi questions. It does not answer the question, even partly |
| **T16** | An Ed-Fi-sounding question with no real documentation behind it, e.g. `/fiona ask What is the Ed-Fi Zorblax Protocol version 9?` | *"I couldn't find this in the Ed-Fi documentation, so I'd rather not guess. Try rephrasing your question, or browse https://docs.ed-fi.org directly."* (or a close paraphrase). No made-up details |

## D. Feedback

| # | Do this | Expect |
|---|---|---|
| **T17** | Click 👍 on the T1 answer, then dismiss the reason form (if one opens) | No error. The buttons acknowledge the click |
| **T18** | Click 👎 on the T2 answer, enter a reason, and submit | A confirmation only you can see. Ask a maintainer to confirm the feedback record holds Fiona's **answer text**. It won't hold your question, and that's expected for private answers (see "Known and expected") |
| **T19** | Click 👎 on the T5 (agent panel) answer and submit a reason | A confirmation. Here the record should hold **both** your question and the answer |

## E. Rate limiting (do this last)

| # | Do this | Expect |
|---|---|---|
| **T20** | Keep sending `/fiona ask What is Ed-Fi?` until you pass the 20-per-hour limit | *":no_entry: You've reached the request limit. Please wait N minutes before trying again."*, visible only to you. No answer, and no LLM call |

---

## F. Error handling: only if a maintainer can break config for you

Skip this unless a maintainer with access to the Perplexity key or the deployment settings can
break connectivity for you. You can't trigger these from Slack alone.

| # | Condition | Expect |
|---|---|---|
| **T21** | Perplexity unreachable or key invalid, then `/fiona ask What is Ed-Fi?` | *":warning: Sorry, I could not answer that right now. Please try again later."*, visible only to you, with 👍/👎 and **no** Sources block |
| **T22** | Same condition, `@fiona ask What is Ed-Fi?` in a channel | The same error copy, visible only to you. The second viewer must not see an error posted to the channel |

---

## G. Regression check: does everything else still work?

This branch now sits on top of the citation work (AI-230 Sources block, AI-231 grounding),
and it changes shared routing files (`command-dispatch.js`, `command-handler.js`,
`fiona.js`) and the feedback handlers.

| # | Do this | Expect |
|---|---|---|
| **T23** | A normal channel question with no keyword: `@fiona What is the Ed-Fi Data Standard?` | Posts **publicly** in the thread, with the Sources block. This is the opposite of T2, and that's intended |
| **T24** | `/fiona search Ed-Fi Data Standard` | Search still returns its own source list (no synthesized answer), visible only to you |
| **T25** | `/fiona help` | Lists `help`, `ask <question>`, `search <query>` (and `ticket`, if ticketing is switched on in this deployment) |
| **T26** | Rate an `ask` answer, a `search` result, and a normal `@fiona` answer | Each set of buttons works on its own. Clicking one doesn't affect the others |

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

- Copy that reads oddly. In particular, check that the *Question privacy* lines in
  `/fiona help` (T10) match what you saw in T2 (private) and T23 (public).
- Whether getting the answer all at once (T1–T3) instead of streamed (T4–T5) felt slow
  enough to matter.
- Sources lists that look long next to a short answer.

---

## Known and expected: please don't file these

- **The answer doesn't stream on the slash command or channel @-mention.** Slack has no
  private version of a streamed message, so the answer arrives in one piece. Fiona would only
  have shown the full answer at the end anyway, because citations can't be linked until the
  last chunk arrives.
- **`ask` ignores the thread.** Deliberate: the question is treated on its own. For an answer
  that uses the thread, use a normal `@fiona` question in the thread.
- **Bare `ask` with no question isn't a command.** It's answered as a normal question, the
  same way bare `search` is.
- **Private answers don't save your question with your feedback.** Slack doesn't let Fiona
  read a private message back later, so only the answer text can be saved when you click.
  Unlike a search result, the answer doesn't repeat your question, so the question isn't
  recoverable.

---

*Drafted with AI assistance from the branch source; it has not itself been run against a live
Slack workspace. Read it through before you hand it over. If a step doesn't match what the
tester sees, the plan may be wrong rather than the code.*
