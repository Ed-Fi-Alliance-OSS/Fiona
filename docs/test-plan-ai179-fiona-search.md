# Fiona search — Slack test plan

**Feature:** `/fiona search` — browse raw Perplexity sources with no synthesized answer
(AI-179), open as PR #81 against `main`.
**Audience:** a tester working entirely inside Slack. No repo access, no deploy access needed.
**Time:** ~25 minutes for the core pass (T1–T14).

---

## Before you start

**1. Search never posts anything on your behalf and never creates anything outside Slack.**
Unlike ticketing, there is no "wrong repo" risk here — the worst outcome is an ephemeral
message showing up somewhere it shouldn't, or a channel message that should have been
ephemeral. That visibility distinction is the main thing this plan checks.

**2. Watch *where* the response lands, not just whether one arrives.** Some entry points reply
only to you (ephemeral); others reply to the whole channel or thread. Getting this backwards —
e.g. a channel `@fiona search` leaking to everyone — is the specific bug the last two commits
on this branch fixed. Note the channel/thread/DM you typed in for every test.

**3. You share the same 20-actions-per-hour budget as every other Fiona command** (rate
limiting is per user, counts every `/fiona` and `@fiona` invocation). This plan uses ~12.

**4. Pick a test channel Fiona is in, plus your Fiona DM and the agent panel.** Several tests
only make sense in one of those three surfaces.

---

## What this feature does, in one paragraph

`search <query>` returns a numbered list of source links and short snippets pulled from
Perplexity's Search API — no summarized answer, just "here's what's out there." It's reachable
four ways: the `/fiona search` slash command, `@fiona search <query>` in a channel, `@fiona
search <query>` or bare `search <query>` in a DM/thread, and bare `search <query>` typed
directly in the agent panel. Every response — including "no results" and error cases — carries
a 👍/👎 feedback control.

---

## A. Entry points and visibility

| # | Do this | Expect |
|---|---|---|
| **T1** | `/fiona search Ed-Fi Data Standard` | Reply visible **only to you** (ephemeral), with source results |
| **T2** | In a real channel: `@fiona search Ed-Fi Data Standard` | Reply visible **only to you** — post it, then check with a second person (or a second browser tab) that nothing appears in the channel for them |
| **T3** | In your Fiona DM: `@fiona search Ed-Fi Data Standard` | Reply visible in the thread, shared like a normal message |
| **T4** | In your Fiona DM: bare `search Ed-Fi Data Standard` (no `@fiona`) | Same shared reply as T3 |
| **T5** | In the agent panel: bare `search Ed-Fi Data Standard` | Same shared reply as T3/T4 |

> **T2 is the one to watch closely.** A channel `@`-mention search must stay private to the
> asker — that's the opposite of how a normal `@fiona` question behaves (those post to the
> whole channel), and it was broken and re-fixed twice on this branch (`098186a`, `005d3d7`).
> If you see search results appear for someone other than you in T2, that's a regression, not
> a nitpick.

## B. Query parsing

| # | Do this | Expect |
|---|---|---|
| **T6** | `/fiona search` with nothing after it | Falls back to the help message — not an empty search, not an error |
| **T7** | Bare keyword `search` with no query, in a DM | Not treated as a search command at all — it should fall through to Fiona's normal LLM answer for the literal word "search" |
| **T8** | `SEARCH ed-fi api`, `/search ed-fi api`, `fiona search ed-fi api` | All three resolve the same as `search ed-fi api` — case and the leading-slash/`fiona ` prefix habits don't matter |
| **T9** | `/fiona help` | Lists **`search <query>`** without any "(coming soon)" qualifier |

## C. Result rendering

| # | Do this | Expect |
|---|---|---|
| **T10** | A query likely to return results, e.g. `search Ed-Fi ODS API authentication` | Numbered list, each with a bold linked title and a short snippet underneath; no stray `**` or `#` characters in the snippet text |
| **T11** | A nonsense query unlikely to return anything, e.g. `search asdkfjhaskdjfh999` | *"🔍 No sources found for "..." Try rephrasing your query."* — not an error, not a blank reply |
| **T12** | A query containing `&`, `<`, `>`, e.g. `search foo & <bar>` | Renders cleanly in Slack — no broken formatting, no literal HTML-escaped junk visible |
| **T13** | Any successful search result | Links do **not** auto-unfurl (no preview card appears under the message) |
| **T14** | Any search response, including T11's no-results case | A 👍/👎 feedback control appears underneath |

---

## D. Error handling — only if someone can break config for you

Skip unless Steven or Robert can pull the Perplexity key or break connectivity for you; you
cannot trigger this from Slack alone.

| # | Condition | Expect |
|---|---|---|
| **T15** | Perplexity API unreachable or key invalid | *":warning: Search encountered an error. Please try again later."* — still with a 👍/👎 feedback control underneath, not a silent failure |

---

## E. Regression check — does this still work alongside ticketing?

This branch was just merged with `main`'s ticketing feature (AI-181/AI-201), and both features
share the same routing files (`command-dispatch.js`, `command-handler.js`, `fiona.js`,
`feedback_block.js`). If the merge went wrong, one feature could silently break the other.

| # | Do this | Expect |
|---|---|---|
| **T16** | `/fiona help` | Lists **both** `search <query>` and `ticket` in the same output |
| **T17** | `/fiona ticket` | Ticket modal still opens normally (unrelated to search, but shares the same dispatch code path) |
| **T18** | Do a search (T1) and a ticket (T17), and click 👍/👎 on each | Both feedback controls work independently — clicking one doesn't affect the other |

---

## Reporting back

For each failure, send: the test number, exactly what you typed, where you typed it (channel
vs. DM vs. thread vs. agent panel), and a screenshot of what Slack showed — including who else
could see it, for the visibility tests in section A. "The results looked wrong" is not
actionable; "T2, posted `@fiona search x` in #general, a teammate's browser also showed the
results" is.

Also worth reporting even though it's not a failure:

- Any copy that reads oddly or is ambiguous.
- Snippets that still contain stray markdown after "cleanup" (bold markers, headings).
- Whether the ephemeral-vs-shared behavior across section A surprised you.

---

## Known and expected — please don't file these

- Channel `@fiona search` is **ephemeral** even though a normal `@fiona <question>` in a
  channel posts for everyone. Deliberate — that's the fix this branch makes.
- Bare `search` with no query is not intercepted as a command; it's treated as a question for
  the LLM. Deliberate — `search` alone is ambiguous with someone asking "how do I search for
  X."
- `/fiona ask` still replies "not yet available." Different feature, not in scope here.
- No synthesized answer, ever — just a source list. That's the point of `/fiona search` versus
  the normal `@fiona` Q&A path.

---

*Drafted with AI assistance from the merged source; it has not itself been executed against a
running Slack workspace. Worth a read-through before you hand it over — if a step doesn't match
what the tester sees, the plan may be wrong rather than the code.*
