# AI-227: Dead-Link Validation for Citations – Design Document

**Date:** 2026-09-24
**Status:** Approved design, ready for an implementation plan
**Ticket:** [AI-227](https://edfi.atlassian.net/browse/AI-227) (dead links only; the stale-content and date half was split to [AI-242](https://edfi.atlassian.net/browse/AI-242))
**Branch:** `ai-227-outdated-citations`, stacked on `ai-231-citations` (PR #118 → #117 → #102)

## 1. Problem

Perplexity's index still holds ed-fi.org pages that return 404. Fiona cites them. The link then breaks, and the claim it
supports may no longer be true. Broken links were the most-repeated complaint of the 2026-08-26 SME review.

After #118 (grounding), dead pages are the main source of remaining false claims. Two live runs of "Is Colorado using
Ed-Fi?" both answered "Yes", citing only `www.ed-fi.org/blog/ed-fi-gains-momentum-k-12-education-sector/`, which
returns 404.

### Acceptance criteria (from AI-227)

- No citation is emitted that does not resolve.
- A claim supported only by a dead link is not made.
- Known-retired paths are excluded after retrieval; the domain filter stays within its 20-entry budget.
- No date is reintroduced in the Sources block (the date criterion now belongs to AI-242).
- Re-running the ticket's test prompts produces only working links.
- A follow-up `check-citations` sweep shows citation health above the 93.94% baseline.

### Constraint that shapes the design

Search and generation happen in **one** Agent API call, so the model has already read a dead page's snippet before
Fiona can check the link. Removing the link alone leaves the claim in the answer, now with no citation.

## 2. Evidence: design spikes (2026-09-24)

Two throwaway live spikes on the #118 head (`4ba6e39`), using `perplexity/sonar`.

**Spike 1: check links after generation, then remove sentences whose only citations are dead (10 runs).**

- 8 of 10 runs retrieved dead pages (2–8 of 15), and 11 of 31 cited URLs were dead. The prompts were chosen because
  they hit dead pages, so this is a worst case.
- Link checks typically took 176ms per URL and at most 1.8s, with no timeouts or unknown results.
- **Rejected.** Uncited verdicts survive. Colorado kept "Yes.", now resting on a weaker live source. Q-001 was left
  choppy, with a dangling reference to bodies that had been removed. Removing sentences cannot enforce "claim not made".

**Spike 2: rewrite the answer from the live results only (8 runs).**

- The rewrite was a no-tools call with the production prompt plus the live results (original ids, title, URL,
  snippet). Snippets were short, typically 150–500 characters.
- 8 of 8 rewrites cited only live ids, and each call took 1.4–3.6s.
- **Colorado:** both runs said Fiona couldn't confirm, noting that a product's statewide availability isn't the
  state's implementation status. This is the answer the SMEs wanted.
- **Licensing:** stayed hedged, with the contact link.
- **Q-001:** coherent but thinner, because claims that came only from dead pages were gone (intended).
- **Q-011:** unchanged.

**Chosen:** check every link; rewrite only when a *cited* source is dead.

## 3. Architecture

All changes sit in `callPerplexityChat` (`apps/fiona-slack/src/agent/llm-caller.js`), after the stream ends and before
the single `streamer.append`. The answer is already held back until the stream ends, so users see nothing new. The
Sources block renderer, the listeners (apart from the log line) and the metadata lifecycle states don't change.

```
stream ends (answer held back, as today)
  │
  ├─ 1. path denylist ── drop results whose URL matches a retired-path prefix
  ├─ 2. link check ───── check the remaining URLs in parallel (cached)
  │                      404/410 → dead · 2xx/3xx → live · timeout/5xx/error → unknown (kept)
  ├─ 3. remove dead + denylisted from metadata.sources / source_index_map
  │
  ├─ 4. did the answer cite a removed source?
  │      no  → carry on as today (model-list check, linkify, send)
  │      yes → rewrite: one call, no search tool, same system prompt + thread history,
  │            plus a "Search results" block of live sources (original ids, title, URL, snippet)
  │            → the rewritten text replaces textBuffer, then carries on as today
  │            → if the rewrite fails: decline (NO_SOURCES_DECLINE_TEXT)
  │
  └─ 5. #118's no-sources guard still runs last: if nothing survived, decline
```

### 3.1 New and changed units

| Unit | Kind | Responsibility |
|---|---|---|
| `src/agent/utils/link-checker.js` | new | `checkUrls(urls, { timeoutMs, allowedHosts, logger })` returns `Map<url, 'live' \| 'dead' \| 'unknown'>`. Imports nothing from the agent layer. |
| `src/agent/utils/source-filter.js` | new, pure | `filterSources(sources, verdicts, denylist)` returns `{ kept, removed: [{ url, id, reason: 'dead' \| 'denylisted' }] }`. Preserves original ids. |
| `regenerateFromSources(prompts, liveSources, logger)` | new, in `llm-caller.js` | Non-streaming `responses.create` with no tools. Returns text, or `null` on failure. Sits beside `summarizeForEscalation`. |
| `isCitationLinkCheckEnabled()` | new, in `deployment-flags.js` | Kill switch. |
| `callPerplexityChat` | changed | Runs steps 1–5 above. |
| `searchForSources` | changed | Filters `/fiona search` results (§3.6). |
| `message.js`, `app_mention.js` | changed | Log line only (§3.7). |

### 3.2 Link checking (`link-checker.js`)

- **Method:** HEAD first, falling back to GET on 403/405/501. Redirects are followed.
- **Verdicts:**
  - 404 or 410 → `dead`.
  - A final 2xx (after following any 3xx) → `live`.
  - 5xx, a timeout, or a network error → `unknown`.
- **Unknown counts as live.** A docs outage or a slow site must not drop every source and decline every answer.
- **Host allowlist:** only hosts on `PERPLEXITY_DOMAIN_FILTER` (matching `www.` either way) are fetched. Any other
  host is not fetched and counts as `unknown`. This guarantees Fiona can't be steered into fetching arbitrary hosts.
- **Time limit:** each request has its own abort timer, and the whole batch shares one budget
  (`CITATION_LINK_CHECK_TIMEOUT_MS`, default 2000). Anything unfinished when the budget runs out counts as `unknown`.
- **The link keeps the original URL.** A redirect works for the user as well, so nothing is rewritten.
- **Cache:** in-memory, in the process, at most 2,000 entries with the oldest removed first.
  - Live results are kept 1h and dead results 24h.
  - `unknown` is never cached, so it's retried next time.
- **`User-Agent`:** `Fiona-LinkCheck/1.0 (+https://www.ed-fi.org/contact/)`. This exact string is shared with the web
  team (§6).

### 3.3 Denylist (`source-filter.js`)

- `CITATION_PATH_DENYLIST` holds comma-separated URL prefixes. Matching ignores scheme, host case, a leading `www.`
  and trailing slashes, the same looseness as the existing `urlKey`. Path case is kept.
- The default is seeded with `www.ed-fi.org/what-is-ed-fi-old/`.
- There's no 20-entry budget here, unlike the domain filter.
- Denylisted URLs are never fetched.

### 3.4 Deciding to rewrite, and the final map

1. Today's marker-to-URL mapping runs first, over **all** sources. This includes the model-written-list safety net,
   because a model's own list uses its own numbers rather than result ids.
2. The cited URLs are those of `cited_markers` under that mapping. If any cited URL was removed (dead or denylisted),
   Fiona rewrites the answer.
3. Uncited removed sources are simply dropped: they leave *Also retrieved*, and no rewrite runs.
4. The final `citation_index` and `cited_markers` are rebuilt from the **filtered** sources, and from the rewritten text
   when there is one. The inline links and the Sources block stay built from that one map (the #117 invariant).

### 3.5 The rewrite call

- **Input:**
  - The same `SYSTEM_PROMPT` value as the first call, so a production override still applies. It gets an appended
    section:
    > ## Search results
    > Search has already been run for this question. These are the only results you may use; cite them by their [n]
    > number exactly as given.
  - Then each live source as `[id] title`, `URL: …` and its snippet, under its **original result id**, so there are
    gaps (for example `[1] [2] [4]`).
  - The same thread history (`prompts`) as the first call, so multi-turn context is kept.
- **No tools, not streamed.**
- **Output** goes through the same pipeline as a first answer: the model-list safety net, `linkifyCitationMarkers` and
  `cited_markers`. A marker for an id that isn't live stays plain text, which is the existing rule for invented
  markers.
- **Failure:** an API error, a status other than `completed` or `incomplete`, or empty text returns `null`. Fiona then
  declines (§3.8).

### 3.6 `/fiona search`

- `searchForSources` requests `min(requested + 3, SEARCH_ABSOLUTE_MAX)` results, applies the denylist and
  `checkUrls`, removes dead results, then trims to the requested count.
- `unknown` results are kept.
- If every result is removed, the command's existing no-results message is shown.
- The kill switch covers it.

### 3.7 Observability

- `metadata.link_check = { checked, dead, unknown, denylisted, regenerated, ms }`.
- `metadata.grounding` gains `regenerated_dead_sources` and `declined_dead_sources`. `declined_no_results` is
  unchanged.
- The `[citations]` log line in `message.js` and `app_mention.js` gains `dead=N regenerated=true|false`, following
  the `grounding=` precedent from #118.

### 3.8 Outcomes

| Case | Result | `grounding` |
|---|---|---|
| Nothing cited was removed | Today's path; removed uncited sources are dropped from the Sources block | unchanged |
| A cited source was removed; the rewrite succeeds | Rewritten answer, live sources only | `regenerated_dead_sources` |
| The rewrite fails | `NO_SOURCES_DECLINE_TEXT` | `declined_dead_sources` |
| Every source was removed | #118's guard declines | `declined_no_results` (the `dead` count shows why) |
| No citations at all (chit-chat) | No rewrite; removed sources are only dropped from the list | unchanged |
| Incomplete run (`max_output_tokens`) | Same rules as a complete run | as above |
| Kill switch off | Exactly today's behaviour; nothing fetched | unchanged |

The rewrite gets **one attempt** (a decision made during design). If it fails, Fiona declines rather than falling back
to sentence removal (rejected in spike 1) or sending the original answer (which fails "claim not made").

### 3.9 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CITATION_LINK_CHECK_ENABLED` | on | Kill switch. Off **only** when set to exactly `'false'`. AI-217's flags are the reverse (off unless exactly `'true'`) because for them off is safe; here, off brings dead links back. A comment in `deployment-flags.js` explains the difference. |
| `CITATION_LINK_CHECK_TIMEOUT_MS` | `2000` | The shared time budget for one batch of checks. |
| `CITATION_PATH_DENYLIST` | `www.ed-fi.org/what-is-ed-fi-old/` | Retired-path prefixes. |

All three go in `.env.sample`. Changing any of them requires a restart.

### 3.10 Latency

| Case | Added time |
|---|---|
| Typical answer | ~0.2–2s (link check; near zero when cached) |
| An answer that cited a dead page | Plus ~1.5–3.5s for the rewrite |
| Cold cache | At most the 2s budget for the checks |

## 4. Testing

The suite is Jest (`npm test`) with a mocked `fetch` and a mocked Perplexity client. Unit tests use no network.

- **`link-checker.test.js`:**
  - Every verdict mapping.
  - The HEAD-to-GET fallback.
  - Followed redirects.
  - Off-allowlist hosts not fetched.
  - The shared budget turning unfinished checks into `unknown`.
  - Cache: a hit, TTL expiry, `unknown` not cached, the 2,000-entry limit.
  - The `User-Agent` header.
- **`source-filter.test.js`:**
  - Prefix matching with the `urlKey` looseness (path case kept).
  - Removal reasons.
  - Original ids preserved.
- **`llm-caller` (new file, `llm-caller.link-check.test.js`):**
  - No dead sources → output **byte-identical** to today (regression guard).
  - Dead uncited → removed from `sources` and `citation_index`, no rewrite.
  - Dead cited → rewrite called with:
    - no `tools`
    - the `SYSTEM_PROMPT` value (including an override)
    - the thread history
    - only live results under their original ids
  - Rewrite output linked against the live map only; non-live markers left as plain text.
  - Rewrite fails on an API error, a failed or cancelled status, or empty text → decline with `declined_dead_sources`.
  - Every source removed → `declined_no_results`.
  - A model-written list citing a dead source → rewrite.
  - An incomplete run follows the same rules.
  - Kill switch off → nothing fetched, and output identical to today.
  - `metadata.link_check` is filled in.
- **Listeners:** `dead=` and `regenerated=` appear on the `[citations]` line on both answer paths.
- **`search-caller.test.js`:**
  - Dead results removed.
  - The extra results trimmed to the requested count.
  - All results dead → empty.
  - Kill switch off.
- **`deployment-flags.test.js`:** on by default, off only for exactly `'false'`.

### 4.1 Live evaluation (results go in the PR)

- **AI-227's prompts, 2 runs each:**
  - Q-001, Q-010, Q-011/012
  - "Is Colorado using Ed-Fi?"
  - "Can I use the Ed-Fi ODS/API in a commercial product I sell?"
- **Multi-turn case, 2 runs:** "Is Colorado using Ed-Fi?" as a follow-up in a thread whose earlier Fiona turn said
  "Yes". This checks that the rewrite, given the thread history, doesn't repeat the earlier claim.
- **Pass:**
  - Every URL in the final `citation_index` and Sources block resolves.
  - Colorado is not answered "Yes" on the strength of a dead page.
- **Recorded:** how often the rewrite runs, the added latency, and the `unknown` count.
- **#118 regression checks:**
  - Q-005 uses the case-study label.
  - The capital-of-France question is declined as out of scope.
  - Ed-Fi coding questions are answered with citations.
  - Chit-chat isn't declined.
- **Slack (the ticket owner):** desktop and mobile, covering a normal answer, a rewritten answer and `/fiona search`.
  A rewrite failure is forced locally through a test hook, not an env var.
- **After merge:** a `check-citations` sweep in `fiona-eval`, compared with the 93.94% baseline. That baseline predates
  the migration, so the first post-migration sweep is a new reference point.

## 5. Out of scope

- Stale-but-live content, and showing any date → AI-242 (blocked on DOC-316).
- Redirects at source → DOC-315 (docs.ed-fi.org) and AI-237 (www.ed-fi.org).
- Re-searching when sources are dead → AI-235 (thorough mode).
- Checking soft-404s. The citation sweep found none on these hosts.

## 6. Operations

- **Docs:** PRD §2.2.2 (`docs/fiona-slack-prd.md`) describes the validation step, the rewrite and the new `grounding`
  values.
- **Rollback:** `CITATION_LINK_CHECK_ENABLED=false`, then restart.
- **Web team (posted on AI-237):**
  - `www.ed-fi.org/robots.txt` has `Crawl-delay: 10` **above** any `User-agent:` line, outside Yoast's
    `User-agent: * / Disallow:` block, so many parsers ignore it.
  - Fiona's checks are HEAD requests triggered by a user's question, not a crawl: up to ~15 per answer on a cold cache,
    fewer once cached.
  - The web team may want to allowlist Fiona's `User-Agent` in the firewall or rate limiter, and fix or confirm the
    stray `Crawl-delay` line.
  - `docs.ed-fi.org` has no crawl delay (`Allow: /`).

## 7. Risks

| Risk | Mitigation |
|---|---|
| The www.ed-fi.org firewall or rate limiter blocks Fiona's checks | They come back `unknown`, which counts as live (fail-open); the web team is told in advance (§6) |
| A rewritten answer is thinner | Intended: only claims from dead pages are removed. The durable fix is DOC-315 and AI-237 |
| Snippets are too short for some questions | Spike 2 showed them sufficient in 8 of 8 runs; the live evaluation re-checks this |
| A rewrite contradicts the thread | The thread history is passed through; the live evaluation includes a multi-turn case |
| The cache is lost on restart | Acceptable: only cold-cache latency, capped by the 2s budget |

_Design produced with AI assistance (Claude Code) and reviewed section by section with the ticket owner. The spike
data comes from 18 live runs on one model._
