# AI-227 Dead-Link Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Fiona emitting citations to dead pages, and stop it making claims whose only support is a dead page.

**Architecture:** After the Agent API stream ends, and before the single `streamer.append`, `callPerplexityChat`:

1. drops denylisted sources and link-checks the rest (dead = 404/410)
2. prunes dead sources from the metadata
3. if a *cited* source was dead, rewrites the answer once with a no-tools call over the live sources only, and declines if that call fails

The inline links and the Sources block are both still built from the one `citation_index` map. `/fiona search` gets the same filtering.

**Tech Stack:**
- Node 24 ESM, with the built-in global `fetch`
- `@perplexity-ai/perplexity_ai` ^0.37.0
- Jest 29 in ESM mode (`jest.unstable_mockModule`)
- Biome lint

**Spec:** `docs/superpowers/specs/2026-09-24-ai227-dead-link-validation-design.md`. Read it before starting. §3.8's outcome table is the behavioural contract.

**Working directory for every command:** `C:\DEV\Ed-Fi\Fiona\.worktrees\ai-227-outdated-citations\apps\fiona-slack`, unless a step says otherwise. Branch `ai-227-outdated-citations`, stacked on `ai-231-citations` (#118).

## Global Constraints

- Every new `.js` file starts with the 4-line SPDX Apache-2.0 header used by every file in `src/` (copy from any existing file).
- Dead = HTTP **404 or 410** only. Live = final 2xx after following redirects (a 3xx that isn't followed also counts as live). Everything else (5xx, timeout, network error, other 4xx) = **unknown, and kept**.
- Only hosts in `PERPLEXITY_DOMAIN_FILTER` are fetched (matching ignores a leading `www.`). Any other host → `unknown`, not fetched.
- `User-Agent` on every check: exactly `Fiona-LinkCheck/1.0 (+https://www.ed-fi.org/contact/)`.
- Cache: in-memory, at most 2,000 entries (oldest removed first); live kept 1h, dead kept 24h; `unknown` never cached.
- `CITATION_LINK_CHECK_ENABLED`: on unless exactly `'false'`. `CITATION_LINK_CHECK_TIMEOUT_MS` defaults to `2000`. `CITATION_PATH_DENYLIST` defaults to `www.ed-fi.org/what-is-ed-fi-old/`.
- The rewrite gets **one attempt**. On failure → `NO_SOURCES_DECLINE_TEXT`, `grounding = 'declined_dead_sources'`. No fallback to removing sentences.
- New `grounding` values: `regenerated_dead_sources`, `declined_dead_sources`. `declined_no_results` is unchanged.
- No dates may be added to the Sources block (AI-242 owns dates).
- With the kill switch off, behaviour must be **exactly** today's, and nothing is fetched.
- Unit tests make no network calls (Task 1 adds a guard).
- Commit messages: `[AI-227] <type>: <summary>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by explicit path, never `git add -A`.

## Review Focus

1. **Denylist prefix boundary.** The prefix `www.ed-fi.org/what-is-ed-fi-old/` must not match `www.ed-fi.org/what-is-ed-fi-older/…`. Pinned in Task 3.
2. **The docs site is down, or every check times out.** Every source comes back `unknown`. The answer must go out exactly as it would without link checking: all sources kept, no rewrite, no decline. Pinned in Task 5.
3. **Duplicate-id aliases.** One dead URL returned under two result ids (e.g. `[2]` and `[5]`). Citing *either* id must count as citing a removed source, and neither marker may stay linked. Pinned in Task 6.
4. **`www.` on the allowlist.** A result on `ed-fi.org` (no `www.`) with the allowlist `www.ed-fi.org` must be fetched, not left `unknown`. Pinned in Task 2.
5. **A rewrite that cites a removed id.** If the rewritten text still contains `[n]` for a dead source's id, that marker must stay plain text and the dead URL must not appear in `citation_index`. Pinned in Task 6.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/agent/deployment-flags.js` | modify | Add `isCitationLinkCheckEnabled()` |
| `src/agent/utils/link-checker.js` | create | `checkUrls`, `clearLinkCheckCache`, `LINK_CHECK_USER_AGENT` |
| `src/agent/utils/source-filter.js` | create | `urlKey` (moved here), `parseDenylist`, `isDenylisted`, `filterSources` |
| `src/agent/llm-caller.js` | modify | Config, `resolveCitations`, `validateSources`, `buildRegenerateInput`, `regenerateFromSources`, the new tail of `callPerplexityChat`, and `searchForSources` filtering |
| `src/listeners/assistant/message.js`, `src/listeners/events/app_mention.js` | modify | `[citations]` log line |
| `jest.config.js`, `tests/setup-network-guard.js` | modify / create | Block real network calls in tests |
| `tests/agent/deployment-flags.test.js` | modify | Kill switch tests |
| `tests/agent/utils/link-checker.test.js`, `tests/agent/utils/source-filter.test.js` | create | Unit tests |
| `tests/agent/llm-caller.link-check.test.js` | create | Integration tests of the answer path |
| `tests/agent/search-caller.test.js` | modify | Pin old behaviour with the switch off; add link-check tests |
| `tests/listeners/assistant/message.test.js`, `tests/listeners/events/app-mention.test.js` | modify | Log-line tests |
| `.env.sample`, `docs/fiona-slack-prd.md` (repo root `docs/`) | modify | Docs |

---

### Task 1: Kill switch and network guard for tests

**Files:**
- Modify: `src/agent/deployment-flags.js` (append after `isEscalationEnabled`)
- Modify: `jest.config.js`
- Create: `tests/setup-network-guard.js`
- Test: `tests/agent/deployment-flags.test.js`

**Interfaces:**
- Produces: `isCitationLinkCheckEnabled(): boolean`, exported from `src/agent/deployment-flags.js`.
- Produces: in every test file, `globalThis.fetch` rejects unless the test replaces it.

- [ ] **Step 1: Write the failing test.** Append to `tests/agent/deployment-flags.test.js`, and change its import line to also import `isCitationLinkCheckEnabled`:

```js
const { isCitationLinkCheckEnabled, isEscalationEnabled, isTicketingFeatureEnabled } = await import(
  '../../src/agent/deployment-flags.js'
);
```

```js
describe('isCitationLinkCheckEnabled', () => {
  beforeEach(() => {
    delete process.env.CITATION_LINK_CHECK_ENABLED;
  });

  // Unlike the AI-217 flags, off is the unsafe direction here: it lets dead
  // links back into answers. So it defaults on.
  it('is true when CITATION_LINK_CHECK_ENABLED is unset', () => {
    expect(isCitationLinkCheckEnabled()).toBe(true);
  });

  it('is false only for the exact string "false"', () => {
    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    expect(isCitationLinkCheckEnabled()).toBe(false);
  });

  it.each(['', 'FALSE', '0', 'no', 'true'])('stays on for %p', (value) => {
    process.env.CITATION_LINK_CHECK_ENABLED = value;
    expect(isCitationLinkCheckEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**
  - Run: `npm test -- tests/agent/deployment-flags.test.js`
  - Expected: FAIL, `isCitationLinkCheckEnabled is not a function`.

- [ ] **Step 3: Implement.** Append to `src/agent/deployment-flags.js`:

```js
/**
 * True unless citation link checking is switched off for this deployment
 * (AI-227). This one defaults ON, the reverse of the flags above: for them off
 * is the safe direction, but switching link checking off lets dead links back
 * into answers. Only the exact string 'false' turns it off.
 */
export function isCitationLinkCheckEnabled() {
  return process.env.CITATION_LINK_CHECK_ENABLED !== 'false';
}
```

- [ ] **Step 4: Add the network guard.**
  1. Create `tests/setup-network-guard.js`:

```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Citation link checking (AI-227) is on by default and uses the global fetch.
// Unit tests must never reach the network, so any test that does not install
// its own fetch mock gets one that rejects. The link checker treats a rejected
// fetch as "unknown" and keeps the source, so tests that don't care about link
// checking see today's behaviour.
globalThis.fetch = () => Promise.reject(new Error('Unexpected network call in a unit test; mock globalThis.fetch'));
```

  2. In `jest.config.js`, add `setupFiles: ['<rootDir>/tests/setup-network-guard.js'],` after `testMatch`.

- [ ] **Step 5: Run the whole suite to verify it passes.**
  - Run: `npm test`
  - Expected: PASS, with the same test count as before plus the 7 new tests. Nothing in `src/` calls `fetch` yet.

- [ ] **Step 6: Commit.**

```bash
git add src/agent/deployment-flags.js tests/agent/deployment-flags.test.js tests/setup-network-guard.js jest.config.js
git commit -m "[AI-227] feat: add the citation link-check kill switch and a test network guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Link checker

**Files:**
- Create: `src/agent/utils/link-checker.js`
- Test: `tests/agent/utils/link-checker.test.js`

**Interfaces:**
- Produces:
  - `checkUrls(urls: string[], { timeoutMs: number, allowedHosts: string[], fetchImpl?: typeof fetch, now?: () => number }): Promise<Map<string, 'live'|'dead'|'unknown'>>`
  - `clearLinkCheckCache(): void`
  - `LINK_CHECK_USER_AGENT: string`

  `fetchImpl` defaults to `globalThis.fetch`, read at call time. `now` defaults to `Date.now`.

- [ ] **Step 1: Write the failing tests.** Create `tests/agent/utils/link-checker.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const { checkUrls, clearLinkCheckCache, LINK_CHECK_USER_AGENT } = await import(
  '../../../src/agent/utils/link-checker.js'
);

const ALLOWED = ['www.ed-fi.org', 'docs.ed-fi.org'];
const DOCS = 'https://docs.ed-fi.org';

/** fetch mock: `routes` maps "METHOD url" (or url, for any method) to a status or an Error to throw. */
function fakeFetch(routes) {
  return jest.fn(async (url, init) => {
    const route = routes[`${init.method} ${url}`] ?? routes[url];
    if (route instanceof Error) throw route;
    return { status: route ?? 200, body: { cancel: jest.fn() } };
  });
}

const check = (urls, fetchImpl, extra = {}) =>
  checkUrls(urls, { timeoutMs: 2000, allowedHosts: ALLOWED, fetchImpl, ...extra });

beforeEach(() => clearLinkCheckCache());

describe('checkUrls verdicts', () => {
  it.each([
    [200, 'live'],
    [204, 'live'],
    [301, 'live'],
    [404, 'dead'],
    [410, 'dead'],
    [500, 'unknown'],
    [503, 'unknown'],
    [401, 'unknown'],
    [429, 'unknown'],
  ])('maps HTTP %i to %s', async (status, verdict) => {
    const verdicts = await check([`${DOCS}/a`], fakeFetch({ [`${DOCS}/a`]: status }));
    expect(verdicts.get(`${DOCS}/a`)).toBe(verdict);
  });

  it('treats a network error as unknown', async () => {
    const verdicts = await check([`${DOCS}/a`], fakeFetch({ [`${DOCS}/a`]: new TypeError('fetch failed') }));
    expect(verdicts.get(`${DOCS}/a`)).toBe('unknown');
  });

  it('sends HEAD with redirects followed and the Fiona User-Agent', async () => {
    const fetchImpl = fakeFetch({});
    await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DOCS}/a`,
      expect.objectContaining({
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': LINK_CHECK_USER_AGENT },
      }),
    );
    expect(LINK_CHECK_USER_AGENT).toBe('Fiona-LinkCheck/1.0 (+https://www.ed-fi.org/contact/)');
  });

  it.each([403, 405, 501])('falls back to GET when HEAD returns %i', async (status) => {
    const fetchImpl = fakeFetch({ [`HEAD ${DOCS}/a`]: status, [`GET ${DOCS}/a`]: 404 });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].method).toBe('GET');
    expect(verdicts.get(`${DOCS}/a`)).toBe('dead');
  });

  it('checks each URL once when the input repeats it', async () => {
    const fetchImpl = fakeFetch({});
    await check([`${DOCS}/a`, `${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('checkUrls host allowlist', () => {
  it('does not fetch a host outside the allowlist, and reports it unknown', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['https://evil.example.com/x'], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdicts.get('https://evil.example.com/x')).toBe('unknown');
  });

  // Review Focus 4: the allowlist names www.ed-fi.org, but results also use the bare host.
  it('matches the allowlist with or without a leading www.', async () => {
    const fetchImpl = fakeFetch({ 'https://ed-fi.org/gone/': 404 });
    const verdicts = await check(['https://ed-fi.org/gone/'], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get('https://ed-fi.org/gone/')).toBe('dead');
  });

  it('reports a malformed URL as unknown without fetching', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['not a url'], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdicts.get('not a url')).toBe('unknown');
  });
});

describe('checkUrls time budget', () => {
  it('reports checks still running when the budget ends as unknown', async () => {
    const fetchImpl = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const verdicts = await check([`${DOCS}/slow`], fetchImpl, { timeoutMs: 20 });
    expect(verdicts.get(`${DOCS}/slow`)).toBe('unknown');
  });
});

describe('checkUrls cache', () => {
  it('serves a live verdict from cache within 1h', async () => {
    let clock = 0;
    const now = () => clock;
    const fetchImpl = fakeFetch({});
    await check([`${DOCS}/a`], fetchImpl, { now });
    clock = 59 * 60 * 1000;
    await check([`${DOCS}/a`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock = 61 * 60 * 1000;
    await check([`${DOCS}/a`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps a dead verdict for 24h', async () => {
    let clock = 0;
    const now = () => clock;
    const fetchImpl = fakeFetch({ [`${DOCS}/gone`]: 404 });
    await check([`${DOCS}/gone`], fetchImpl, { now });
    clock = 23 * 60 * 60 * 1000;
    const verdicts = await check([`${DOCS}/gone`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get(`${DOCS}/gone`)).toBe('dead');
    clock = 25 * 60 * 60 * 1000;
    await check([`${DOCS}/gone`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never caches unknown', async () => {
    const fetchImpl = fakeFetch({ [`${DOCS}/flaky`]: 503 });
    await check([`${DOCS}/flaky`], fetchImpl);
    await check([`${DOCS}/flaky`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('holds at most 2000 entries, evicting the oldest', async () => {
    const fetchImpl = fakeFetch({});
    const urls = Array.from({ length: 2001 }, (_, i) => `${DOCS}/p${i}`);
    await check(urls, fetchImpl);
    fetchImpl.mockClear();
    await check([`${DOCS}/p0`, `${DOCS}/p2000`], fetchImpl);
    // p0 was evicted and is fetched again; p2000 is still cached.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${DOCS}/p0`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
  - Run: `npm test -- tests/agent/utils/link-checker.test.js`
  - Expected: FAIL, `Cannot find module '../../../src/agent/utils/link-checker.js'`.

- [ ] **Step 3: Implement.** Create `src/agent/utils/link-checker.js`:

```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Checks that cited pages still exist (AI-227). Perplexity's index still holds
 * ed-fi.org pages that now return 404, so a retrieved source can be dead.
 *
 * Only 404 and 410 count as dead. Anything the check cannot confirm (a 5xx, a
 * timeout, a network error, another 4xx) is "unknown" and the caller keeps the
 * source: a slow or unreachable site must not strip every source from every
 * answer.
 *
 * Imports nothing from the agent layer, so it can be tested on its own.
 */

export const LINK_CHECK_USER_AGENT = 'Fiona-LinkCheck/1.0 (+https://www.ed-fi.org/contact/)';

const LIVE_TTL_MS = 60 * 60 * 1000;
const DEAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
// Servers that refuse HEAD answer with one of these; GET gets the real status.
const HEAD_REFUSED = new Set([403, 405, 501]);

/** url -> { verdict, expiresAt }. Map keeps insertion order, so the first key is the oldest. */
const cache = new Map();

/** Empty the verdict cache. For tests. */
export function clearLinkCheckCache() {
  cache.clear();
}

function remember(url, verdict, now) {
  if (verdict === 'unknown') return;
  cache.delete(url);
  cache.set(url, { verdict, expiresAt: now + (verdict === 'dead' ? DEAD_TTL_MS : LIVE_TTL_MS) });
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

function isAllowedHost(url, allowedHosts) {
  try {
    return allowedHosts.map(bareHost).includes(bareHost(new URL(url).hostname));
  } catch {
    return false;
  }
}

function verdictFor(status) {
  if (status === 404 || status === 410) return 'dead';
  if (status >= 200 && status < 400) return 'live';
  return 'unknown';
}

async function probe(url, signal, fetchImpl) {
  const init = { redirect: 'follow', signal, headers: { 'User-Agent': LINK_CHECK_USER_AGENT } };
  let response = await fetchImpl(url, { ...init, method: 'HEAD' });
  if (HEAD_REFUSED.has(response.status)) {
    response = await fetchImpl(url, { ...init, method: 'GET' });
    // Only the status is needed; release the connection instead of reading the page.
    await response.body?.cancel?.();
  }
  return verdictFor(response.status);
}

/**
 * Check each URL once, in parallel, within one shared time budget.
 *
 * @param {string[]} urls
 * @param {Object} options
 * @param {number} options.timeoutMs - Budget for the whole batch; checks still running when it ends are "unknown"
 * @param {string[]} options.allowedHosts - Only these hosts are fetched (a leading www. is ignored); others are "unknown"
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @returns {Promise<Map<string, 'live' | 'dead' | 'unknown'>>}
 */
export async function checkUrls(urls, { timeoutMs, allowedHosts, fetchImpl = globalThis.fetch, now = Date.now }) {
  const verdicts = new Map();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  const pending = [];
  for (const url of new Set(urls)) {
    if (!isAllowedHost(url, allowedHosts)) {
      verdicts.set(url, 'unknown');
      continue;
    }
    const hit = cache.get(url);
    if (hit && hit.expiresAt > now()) {
      verdicts.set(url, hit.verdict);
      continue;
    }
    pending.push(
      probe(url, controller.signal, fetchImpl)
        .catch(() => 'unknown')
        .then((verdict) => {
          verdicts.set(url, verdict);
          remember(url, verdict, now());
        }),
    );
  }

  try {
    await Promise.all(pending);
  } finally {
    clearTimeout(timer);
  }
  return verdicts;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
  - Run: `npm test -- tests/agent/utils/link-checker.test.js`
  - Expected: PASS.

- [ ] **Step 5: Lint.**
  - Run: `npm run lint`
  - Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/agent/utils/link-checker.js tests/agent/utils/link-checker.test.js
git commit -m "[AI-227] feat: add a cached, budgeted link checker for cited sources" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Source filter and denylist

**Files:**
- Create: `src/agent/utils/source-filter.js`
- Modify: `src/agent/llm-caller.js` (delete the private `urlKey` at about lines 567–580; import it instead)
- Test: `tests/agent/utils/source-filter.test.js`

**Interfaces:**
- Consumes: the verdict map produced by Task 2's `checkUrls`.
- Produces:
  - `urlKey(url: string): string`, moved unchanged from `llm-caller.js`
  - `parseDenylist(raw: string): string[]`, returning prefixes as `urlKey`-style keys
  - `isDenylisted(url: string, denylist: string[]): boolean`
  - `filterSources(sources: NormalizedSource[], verdicts: Map<string,string>, denylist: string[]): { kept: NormalizedSource[], removed: Array<{ url: string, id?: number, reason: 'dead'|'denylisted' }> }`

- [ ] **Step 1: Write the failing tests.** Create `tests/agent/utils/source-filter.test.js`:

```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';

const { filterSources, isDenylisted, parseDenylist, urlKey } = await import(
  '../../../src/agent/utils/source-filter.js'
);

describe('urlKey', () => {
  it('ignores scheme, host case, www. and trailing slashes, but keeps path case', () => {
    expect(urlKey('https://WWW.Ed-Fi.org/Getting-Started/')).toBe('ed-fi.org/Getting-Started');
    expect(urlKey('http://ed-fi.org/Getting-Started')).toBe('ed-fi.org/Getting-Started');
  });
});

describe('parseDenylist / isDenylisted', () => {
  const denylist = parseDenylist('www.ed-fi.org/what-is-ed-fi-old/, https://docs.ed-fi.org/retired , ,');

  it('parses comma-separated prefixes, with or without a scheme, and skips blanks', () => {
    expect(denylist).toEqual(['ed-fi.org/what-is-ed-fi-old', 'docs.ed-fi.org/retired']);
  });

  it('matches the prefix itself and paths below it', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-old/', denylist)).toBe(true);
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-old/mission/', denylist)).toBe(true);
    expect(isDenylisted('https://ed-fi.org/what-is-ed-fi-old/mission', denylist)).toBe(true);
  });

  // Review Focus 1: a prefix must end at a path boundary.
  it('does not match a sibling path that merely starts with the same characters', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-older/page/', denylist)).toBe(false);
  });

  it('keeps path case significant', () => {
    expect(isDenylisted('https://www.ed-fi.org/What-Is-Ed-Fi-Old/mission/', denylist)).toBe(false);
  });

  it('matches nothing when the denylist is empty', () => {
    expect(isDenylisted('https://www.ed-fi.org/anything/', parseDenylist(''))).toBe(false);
  });
});

describe('filterSources', () => {
  const sources = [
    { id: 1, url: 'https://docs.ed-fi.org/live/' },
    { id: 2, url: 'https://www.ed-fi.org/gone/' },
    { id: 4, url: 'https://www.ed-fi.org/what-is-ed-fi-old/mission/' },
    { id: 5, url: 'https://docs.ed-fi.org/slow/' },
  ];
  const verdicts = new Map([
    ['https://docs.ed-fi.org/live/', 'live'],
    ['https://www.ed-fi.org/gone/', 'dead'],
    ['https://docs.ed-fi.org/slow/', 'unknown'],
  ]);

  it('keeps live and unknown sources in order, with their original ids', () => {
    const { kept } = filterSources(sources, verdicts, parseDenylist('www.ed-fi.org/what-is-ed-fi-old/'));
    expect(kept).toEqual([sources[0], sources[3]]);
  });

  it('records each removed source with its reason', () => {
    const { removed } = filterSources(sources, verdicts, parseDenylist('www.ed-fi.org/what-is-ed-fi-old/'));
    expect(removed).toEqual([
      { url: 'https://www.ed-fi.org/gone/', id: 2, reason: 'dead' },
      { url: 'https://www.ed-fi.org/what-is-ed-fi-old/mission/', id: 4, reason: 'denylisted' },
    ]);
  });

  it('reports denylisted, not dead, when a URL is both', () => {
    const both = new Map([['https://www.ed-fi.org/what-is-ed-fi-old/mission/', 'dead']]);
    const { removed } = filterSources([sources[2]], both, parseDenylist('www.ed-fi.org/what-is-ed-fi-old/'));
    expect(removed[0].reason).toBe('denylisted');
  });

  it('keeps a source that has no verdict', () => {
    const { kept } = filterSources([sources[0]], new Map(), []);
    expect(kept).toEqual([sources[0]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
  - Run: `npm test -- tests/agent/utils/source-filter.test.js`
  - Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement.** Create `src/agent/utils/source-filter.js`:

```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Drops sources Fiona must not cite (AI-227): pages the link check found dead,
 * and retired paths named in CITATION_PATH_DENYLIST. The search domain filter
 * is domain-level only (and capped at 20 entries), so retired paths are
 * excluded here, after retrieval.
 */

/**
 * Loose comparison key: ignores the scheme, host case, a leading www. and
 * trailing slashes. Path, query and fragment keep their case, since paths are
 * case-sensitive.
 *
 * @param {string} url
 * @returns {string}
 */
export function urlKey(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/**
 * Parse CITATION_PATH_DENYLIST: comma-separated URL prefixes, with or without a
 * scheme. Returns them as urlKey-style keys.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parseDenylist(raw) {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => urlKey(/^https?:\/\//i.test(entry) ? entry : `https://${entry}`));
}

/**
 * True when the URL is a denylisted prefix or sits below one. A prefix ends at
 * a path boundary, so ".../what-is-ed-fi-old" does not match ".../what-is-ed-fi-older".
 *
 * @param {string} url
 * @param {string[]} denylist - From parseDenylist
 * @returns {boolean}
 */
export function isDenylisted(url, denylist) {
  const key = urlKey(url);
  return denylist.some((prefix) => key === prefix || key.startsWith(`${prefix}/`));
}

/**
 * Split sources into those Fiona may cite and those it must drop. Order and
 * original ids are preserved, because inline [n] markers refer to those ids.
 * A source with no verdict, or an "unknown" one, is kept.
 *
 * @param {Array<{url: string, id?: number}>} sources
 * @param {Map<string, 'live' | 'dead' | 'unknown'>} verdicts
 * @param {string[]} denylist - From parseDenylist
 * @returns {{ kept: Array<Object>, removed: Array<{ url: string, id?: number, reason: 'dead' | 'denylisted' }> }}
 */
export function filterSources(sources, verdicts, denylist) {
  const kept = [];
  const removed = [];
  for (const source of sources) {
    if (isDenylisted(source.url, denylist)) {
      removed.push({ url: source.url, id: source.id, reason: 'denylisted' });
    } else if (verdicts.get(source.url) === 'dead') {
      removed.push({ url: source.url, id: source.id, reason: 'dead' });
    } else {
      kept.push(source);
    }
  }
  return { kept, removed };
}
```

- [ ] **Step 4: Move `urlKey` out of `llm-caller.js`.**
  1. Delete the private `urlKey` function and its doc comment (about lines 567–580).
  2. Add `import { urlKey } from './utils/source-filter.js';` beside the other `./utils/` imports.
  3. Check that nothing else defines it: `grep -n "function urlKey" src/agent/llm-caller.js` must print nothing.

- [ ] **Step 5: Run the tests to verify they pass.**
  - Run: `npm test`
  - Expected: PASS. The model-list tests in `tests/agent/llm-caller.aggregate-perplexity.test.js` exercise `urlKey` through `makeResultUrlResolver` and must stay green.

- [ ] **Step 6: Lint, then commit.**

```bash
npm run lint
git add src/agent/utils/source-filter.js tests/agent/utils/source-filter.test.js src/agent/llm-caller.js
git commit -m "[AI-227] feat: add the source filter and retired-path denylist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Extract `resolveCitations` (refactor, no behaviour change)

**Files:**
- Modify: `src/agent/llm-caller.js`, in `callPerplexityChat`, the block from `const metadata = streamer?.__citation_metadata;` to the end of the `metadata.cited_markers` assignment (about lines 830–845 on the #118 head)

**Interfaces:**
- Produces a private `resolveCitations(text: string, sources: NormalizedSource[], sourceIndexMap: Object, rawResults: Object[]): { text: string, indexToUrl: Map<number,string>, citedMarkers: number[] }`, used by Tasks 5 and 6.

- [ ] **Step 1: Confirm the baseline.**
  - Run: `npm test`
  - Expected: PASS. Note the count.

- [ ] **Step 2: Add the helper.** Put this directly above `buildWebSearchTool`:

```js
/**
 * Work out what each [n] marker in the text links to. When the model appended
 * its own source list, its numbers are its own, so link by the list and drop it
 * (only the Sources block lists sources); otherwise link by result id.
 *
 * @param {string} text - Raw answer text
 * @param {Array<import('./utils/source-normalizer.js').NormalizedSource>} sources
 * @param {Object} sourceIndexMap - URL -> result id
 * @param {Array<Object>} rawResults - Raw search results (for duplicate-id aliases)
 * @returns {{ text: string, indexToUrl: Map<number, string>, citedMarkers: number[] }}
 */
function resolveCitations(text, sources, sourceIndexMap, rawResults) {
  const resolveResultUrl = makeResultUrlResolver(sources);
  const modelList = rawResults.length > 0 ? extractModelSourceList(text, resolveResultUrl) : null;
  let answer = text;
  let indexToUrl;
  if (modelList) {
    answer = modelList.text;
    indexToUrl = buildModelListIndex(modelList.urlByMarker, sources, resolveResultUrl, answer);
  } else {
    indexToUrl = buildIndexToUrlMap(sourceIndexMap, rawResults);
  }
  const citedMarkers = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((marker) => indexToUrl.has(marker))
    .sort((a, b) => a - b);
  return { text: answer, indexToUrl, citedMarkers };
}
```

- [ ] **Step 3: Use it in `callPerplexityChat`.** Replace the block from `const metadata = streamer?.__citation_metadata;` through the end of the `if (metadata) { metadata.citation_index = …; metadata.cited_markers = …; }` block, and the `botText` section below it, with:

```js
  const metadata = streamer?.__citation_metadata;
  const sources = metadata?.sources ?? normalizeSources(searchResults).sources;
  const resolved = resolveCitations(textBuffer, sources, metadata?.source_index_map || {}, searchResults);
  if (metadata) {
    metadata.citation_index = Object.fromEntries(resolved.indexToUrl);
    metadata.cited_markers = resolved.citedMarkers;
  }

  let botText = '';
  if (sources.length === 0) {
    // Never show an answer with nothing behind it. Counting normalized
    // sources, not raw results, also catches results whose URLs were all
    // rejected. The escalation summary does not come through here, so it
    // still summarizes without sources.
    if (metadata) metadata.grounding = 'declined_no_results';
    botText = NO_SOURCES_DECLINE_TEXT;
    await streamer.append({ markdown_text: botText });
  } else if (resolved.text) {
    botText = linkifyCitationMarkers(resolved.text, resolved.indexToUrl);
    await streamer.append({ markdown_text: botText });
  }
```

  Keep the comment that sits above the old block ("Resolve marker number -> URL once, …"), moving it above the `resolveCitations` call.

- [ ] **Step 4: Run the tests to verify nothing changed.**
  - Run: `npm test`
  - Expected: PASS, with the same count as Step 1.

- [ ] **Step 5: Lint, then commit.**

```bash
npm run lint
git add src/agent/llm-caller.js
git commit -m "[AI-227] refactor: extract citation resolution from callPerplexityChat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Validate sources and prune dead ones (no rewrite yet)

**Files:**
- Modify: `src/agent/llm-caller.js` (imports, config near `PERPLEXITY_DOMAIN_FILTER`, a new `validateSources`, the tail of `callPerplexityChat`)
- Create: `tests/agent/llm-caller.link-check.test.js`

**Interfaces:**
- Consumes:
  - `isCitationLinkCheckEnabled` (Task 1)
  - `checkUrls` (Task 2)
  - `parseDenylist`, `isDenylisted`, `filterSources` (Task 3)
  - `resolveCitations` (Task 4)
- Produces:
  - a private `validateSources(sources, logger): Promise<{ kept, removed, stats: { checked, dead, unknown, denylisted } }>`
  - `metadata.link_check = { checked, dead, unknown, denylisted, regenerated, ms }`

  Task 6 extends the same tail.

- [ ] **Step 1: Write the failing tests.** Create `tests/agent/llm-caller.link-check.test.js`. `makeStream` and `makeStreamer` are copied from `tests/agent/llm-caller.aggregate-perplexity.test.js`.

```js
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/agent/utils/citation-telemetry.js', () => ({
  recordMetadataWaitDuration: jest.fn(),
  recordSourceCount: jest.fn(),
  incrementDegradedNoMetadataCount: jest.fn(),
  incrementTotalResponseCount: jest.fn(),
}));

const mockCreate = jest.fn();
jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: { create: mockCreate },
    search: { create: jest.fn() },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';

const { callPerplexityChat, NO_SOURCES_DECLINE_TEXT } = await import('../../src/agent/llm-caller.js');
const { clearLinkCheckCache } = await import('../../src/agent/utils/link-checker.js');

const LIVE_A = 'https://docs.ed-fi.org/live-a/';
const LIVE_B = 'https://docs.ed-fi.org/live-b/';
const DEAD = 'https://www.ed-fi.org/blog/gone/';
const RETIRED = 'https://www.ed-fi.org/what-is-ed-fi-old/mission/';

function makeStream(chunks, { terminal = 'response.completed' } = {}) {
  const events = [];
  for (const chunk of chunks) {
    if (chunk.text !== undefined) events.push({ type: 'response.output_text.delta', delta: chunk.text });
    if (chunk.searchResults !== undefined) {
      events.push({ type: 'response.reasoning.search_results', results: chunk.searchResults });
    }
  }
  events.push({
    type: terminal,
    response: {
      status: terminal === 'response.completed' ? 'completed' : 'incomplete',
      ...(terminal === 'response.incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    },
  });
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: async () => (i >= events.length ? { done: true } : { done: false, value: events[i++] }) };
    },
  };
}

function makeMetadata() {
  return { sources: [], source_index_map: Object.create(null), search_results: [], finalize_state: 'streaming_text' };
}

function makeStreamer(metadata) {
  const appended = [];
  return {
    __citation_metadata: metadata,
    append: jest.fn(async ({ markdown_text }) => appended.push(markdown_text)),
    _appended: appended,
  };
}

/** Results with Agent API ids 1..n, in the order given. */
const results = (urls) => urls.map((url, i) => ({ id: i + 1, url, title: `T${i + 1}`, snippet: `S${i + 1}` }));

/** fetch mock: 404 for the given URLs, 200 for everything else. */
function mockFetchDead(...deadUrls) {
  globalThis.fetch = jest.fn(async (url) => ({ status: deadUrls.includes(url) ? 404 : 200 }));
}

const USER = [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'question' }];

beforeEach(() => {
  clearLinkCheckCache();
  mockCreate.mockReset();
  delete process.env.CITATION_LINK_CHECK_ENABLED;
});

afterEach(() => {
  globalThis.fetch = () => Promise.reject(new Error('Unexpected network call in a unit test; mock globalThis.fetch'));
});

describe('link check: no dead sources', () => {
  it('leaves the answer byte-identical to the unchecked path', async () => {
    const stream = () => makeStream([{ text: 'A [1] and B [2].', searchResults: results([LIVE_A, LIVE_B]) }]);

    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    mockCreate.mockResolvedValueOnce(stream());
    const off = makeStreamer(makeMetadata());
    await callPerplexityChat(off, USER);

    delete process.env.CITATION_LINK_CHECK_ENABLED;
    mockFetchDead();
    mockCreate.mockResolvedValueOnce(stream());
    const on = makeStreamer(makeMetadata());
    await callPerplexityChat(on, USER);

    expect(on._appended).toEqual(off._appended);
    expect(on.__citation_metadata.citation_index).toEqual(off.__citation_metadata.citation_index);
    expect(on.__citation_metadata.link_check).toEqual(
      expect.objectContaining({ checked: 2, dead: 0, unknown: 0, denylisted: 0, regenerated: false }),
    );
  });

  it('fetches nothing and records no link_check when the kill switch is off', async () => {
    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    globalThis.fetch = jest.fn();
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'A [1].', searchResults: results([DEAD]) }]));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(streamer.__citation_metadata.link_check).toBeUndefined();
    expect(streamer._appended[0]).toBe(`A [[1]](${DEAD}).`);
  });
});

describe('link check: dead or retired sources the answer does not cite', () => {
  it('drops them from sources and citation_index without rewriting', async () => {
    mockFetchDead(DEAD);
    mockCreate.mockResolvedValueOnce(
      makeStream([{ text: 'A [1].', searchResults: results([LIVE_A, DEAD, RETIRED]) }]),
    );
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);

    const metadata = streamer.__citation_metadata;
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(streamer._appended).toEqual([`A [[1]](${LIVE_A}).`]);
    expect(metadata.sources.map((s) => s.url)).toEqual([LIVE_A]);
    expect(Object.values(metadata.citation_index)).toEqual([LIVE_A]);
    expect(metadata.grounding).toBeUndefined();
    expect(metadata.link_check).toEqual(
      expect.objectContaining({ checked: 2, dead: 1, denylisted: 1, regenerated: false }),
    );
    // The retired path is never fetched.
    expect(globalThis.fetch.mock.calls.map(([url]) => url)).not.toContain(RETIRED);
  });

  it('keeps a source whose check is unknown', async () => {
    globalThis.fetch = jest.fn(async () => ({ status: 503 }));
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'A [1].', searchResults: results([LIVE_A]) }]));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([`A [[1]](${LIVE_A}).`]);
    expect(streamer.__citation_metadata.link_check.unknown).toBe(1);
  });

  it('declines with declined_no_results when every source is removed', async () => {
    mockFetchDead(DEAD);
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'Claim [1].', searchResults: results([DEAD, RETIRED]) }]));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([NO_SOURCES_DECLINE_TEXT]);
    expect(streamer.__citation_metadata.grounding).toBe('declined_no_results');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // Review Focus 2: a site outage must not strip or decline answers.
  it('sends the answer unchanged when every check fails', async () => {
    const stream = () => makeStream([{ text: 'A [1] and B [2].', searchResults: results([LIVE_A, DEAD]) }]);

    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    mockCreate.mockResolvedValueOnce(stream());
    const off = makeStreamer(makeMetadata());
    await callPerplexityChat(off, USER);

    delete process.env.CITATION_LINK_CHECK_ENABLED;
    globalThis.fetch = jest.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    mockCreate.mockResolvedValueOnce(stream());
    const on = makeStreamer(makeMetadata());
    await callPerplexityChat(on, USER);

    expect(on._appended).toEqual(off._appended);
    expect(on.__citation_metadata.sources).toEqual(off.__citation_metadata.sources);
    expect(on.__citation_metadata.grounding).toBeUndefined();
    expect(on.__citation_metadata.link_check).toEqual(expect.objectContaining({ unknown: 2, dead: 0 }));
    expect(mockCreate).toHaveBeenCalledTimes(2); // one per run: no rewrite
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
  - Run: `npm test -- tests/agent/llm-caller.link-check.test.js`
  - Expected: FAIL. The dead sources are still in `metadata.sources`, and `link_check` is undefined.

- [ ] **Step 3: Add the imports and config.**
  1. Add to the imports in `src/agent/llm-caller.js`:

```js
import { isCitationLinkCheckEnabled } from './deployment-flags.js';
import { checkUrls } from './utils/link-checker.js';
import { filterSources, isDenylisted, parseDenylist, urlKey } from './utils/source-filter.js';
```

     This merges with Task 3's `urlKey` import. Confirm `deployment-flags.js` imports nothing, so no cycle forms; `tests/agent/layering.test.js` checks this.

  2. After the `PERPLEXITY_DOMAIN_FILTER` definition, add:

```js
// ─── Citation Link Checking (AI-227) ────────────────────────────────────────
// Time budget for checking one answer's sources; unfinished checks keep the source.
const CITATION_LINK_CHECK_TIMEOUT_MS = parsePositiveIntEnv(process.env.CITATION_LINK_CHECK_TIMEOUT_MS, 2000);
// Retired-path prefixes the domain-level search filter cannot express.
const CITATION_PATH_DENYLIST = parseDenylist(
  process.env.CITATION_PATH_DENYLIST ?? 'www.ed-fi.org/what-is-ed-fi-old/',
);
```

     `parsePositiveIntEnv` is a function declaration, so it's hoisted and safe to call here.

- [ ] **Step 4: Add `validateSources`.** Put it directly above `resolveCitations`:

```js
/**
 * Drop sources Fiona must not cite: retired paths (never fetched) and pages
 * that return 404 or 410. Pages the check cannot confirm are kept.
 *
 * @param {Array<import('./utils/source-normalizer.js').NormalizedSource>} sources
 * @param {{ warn?: (msg: string) => void }} [logger]
 */
async function validateSources(sources, logger) {
  const toCheck = sources.filter((source) => !isDenylisted(source.url, CITATION_PATH_DENYLIST)).map((s) => s.url);
  const verdicts = await checkUrls(toCheck, {
    timeoutMs: CITATION_LINK_CHECK_TIMEOUT_MS,
    allowedHosts: PERPLEXITY_DOMAIN_FILTER,
  });
  const { kept, removed } = filterSources(sources, verdicts, CITATION_PATH_DENYLIST);
  const count = (verdict) => [...verdicts.values()].filter((v) => v === verdict).length;
  const stats = {
    checked: toCheck.length,
    dead: count('dead'),
    unknown: count('unknown'),
    denylisted: removed.filter((entry) => entry.reason === 'denylisted').length,
  };
  if (removed.length > 0) {
    logger?.warn?.(`[citations] removed ${removed.length} source(s): ${removed.map((r) => `${r.reason} ${r.url}`).join(', ')}`);
  }
  return { kept, removed, stats };
}
```

- [ ] **Step 5: Wire it into the tail of `callPerplexityChat`.**
  1. Change `const sources = …` to `let sources = …`.
  2. Replace the `const resolved = resolveCitations(…)` line with:

```js
  let sourceIndexMap = metadata?.source_index_map || {};
  let resolved = resolveCitations(textBuffer, sources, sourceIndexMap, searchResults);

  if (sources.length > 0 && isCitationLinkCheckEnabled()) {
    const started = Date.now();
    const { kept, removed, stats } = await validateSources(sources, logger);
    if (removed.length > 0) {
      const removedUrls = new Set(removed.map((entry) => entry.url));
      sources = kept;
      sourceIndexMap = Object.fromEntries(Object.entries(sourceIndexMap).filter(([url]) => !removedUrls.has(url)));
      // Compare normalized URLs: the normalizer re-encodes some characters, so a
      // raw result URL can differ from its source URL.
      searchResults = searchResults.filter((result) => !removedUrls.has(normalizeSource(result)?.url));
      if (metadata) {
        metadata.sources = sources;
        metadata.source_index_map = sourceIndexMap;
      }
      resolved = resolveCitations(textBuffer, sources, sourceIndexMap, searchResults);
    }
    if (metadata) metadata.link_check = { ...stats, regenerated: false, ms: Date.now() - started };
  }
```

     `searchResults` is already declared with `let` near the top of the function. If `normalizeSource` isn't already imported there, add it to the existing `./utils/source-normalizer.js` import; it is already imported for `addDuplicateIdAliases`.

- [ ] **Step 6: Run the tests to verify they pass.**
  - Run: `npm test -- tests/agent/llm-caller.link-check.test.js`, then `npm test`
  - Expected: all PASS. The existing suites are unchanged because the network guard makes every check `unknown`, and unknown sources are kept.

- [ ] **Step 7: Lint, then commit.**

```bash
npm run lint
git add src/agent/llm-caller.js tests/agent/llm-caller.link-check.test.js
git commit -m "[AI-227] feat: drop dead and retired sources before building citation_index" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rewrite from live sources when a cited source is dead

**Files:**
- Modify: `src/agent/llm-caller.js` (a new `buildRegenerateInput` and `regenerateFromSources` next to `summarizeForEscalation`; the tail of `callPerplexityChat`)
- Test: `tests/agent/llm-caller.link-check.test.js` (append)

**Interfaces:**
- Consumes: `validateSources` and `resolveCitations` (Tasks 4–5), and the private `promptsToInputItems`.
- Produces:
  - `export function buildRegenerateInput(prompts, liveSources, sourceIndexMap): Array<InputItem>`
  - `export async function regenerateFromSources(prompts, liveSources, sourceIndexMap, logger, { model } = {}): Promise<string|null>`

  Both are exported for tests and for the live evaluation, where `model` is how a failure is forced.
- Produces the `grounding` values `regenerated_dead_sources` and `declined_dead_sources`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/agent/llm-caller.link-check.test.js`, and add `buildRegenerateInput, regenerateFromSources` to its import from `llm-caller.js`:

```js
const completed = (text) => ({ status: 'completed', output_text: text });

describe('link check: a cited source is dead', () => {
  it('rewrites the answer from live sources only, with no tools, keeping thread history', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(makeStream([{ text: 'Yes [2].', searchResults: results([LIVE_A, DEAD, LIVE_B]) }]))
      .mockResolvedValueOnce(completed('Could not confirm; see [1] and [3].'));
    const streamer = makeStreamer(makeMetadata());
    const prompts = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'question' },
    ];
    await callPerplexityChat(streamer, prompts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const rewriteArgs = mockCreate.mock.calls[1][0];
    expect(rewriteArgs.tools).toBeUndefined();
    expect(rewriteArgs.tool_choice).toBeUndefined();
    expect(rewriteArgs.stream).toBe(false);
    expect(rewriteArgs.input.map((item) => item.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const system = rewriteArgs.input[0].content;
    expect(system.startsWith('SYS\n\n## Search results')).toBe(true);
    expect(system).toContain(`[1] T1\nURL: ${LIVE_A}\nS1`);
    expect(system).toContain(`[3] T3\nURL: ${LIVE_B}\nS3`);
    expect(system).not.toContain(DEAD);

    const metadata = streamer.__citation_metadata;
    expect(streamer._appended).toEqual([`Could not confirm; see [[1]](${LIVE_A}) and [[3]](${LIVE_B}).`]);
    expect(metadata.grounding).toBe('regenerated_dead_sources');
    expect(metadata.cited_markers).toEqual([1, 3]);
    expect(metadata.link_check.regenerated).toBe(true);
  });

  it('rewrites when the answer cites a denylisted source', async () => {
    mockFetchDead();
    mockCreate
      .mockResolvedValueOnce(makeStream([{ text: 'Old mission [2].', searchResults: results([LIVE_A, RETIRED]) }]))
      .mockResolvedValueOnce(completed('Current [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([`Current [[1]](${LIVE_A}).`]);
  });

  // Review Focus 3: one dead URL returned under two ids.
  it('treats citing either id of a duplicated dead URL as citing a removed source', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(
        makeStream([
          {
            text: 'Claim [3].',
            searchResults: [
              { id: 1, url: LIVE_A },
              { id: 2, url: DEAD },
              { id: 3, url: DEAD },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(completed('Live claim [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const index = streamer.__citation_metadata.citation_index;
    expect(index['2']).toBeUndefined();
    expect(index['3']).toBeUndefined();
  });

  // Review Focus 5: the rewrite still cites the dead source's id.
  it('leaves a marker for a removed id as plain text in the rewrite', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(makeStream([{ text: 'Yes [2].', searchResults: results([LIVE_A, DEAD]) }]))
      .mockResolvedValueOnce(completed('Live [1], stale [2].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([`Live [[1]](${LIVE_A}), stale [2].`]);
    expect(Object.values(streamer.__citation_metadata.citation_index)).not.toContain(DEAD);
    expect(streamer.__citation_metadata.cited_markers).toEqual([1]);
  });

  it('rewrites when a model-written source list links a dead URL', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(
        makeStream([
          {
            text: `Claim [1].\n\nSources:\n[1] Gone ${DEAD}`,
            searchResults: results([LIVE_A, DEAD]),
          },
        ]),
      )
      .mockResolvedValueOnce(completed('Live [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(streamer._appended).toEqual([`Live [[1]](${LIVE_A}).`]);
  });

  it('applies the same rules to an incomplete run', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(
        makeStream([{ text: 'Partial [2]', searchResults: results([LIVE_A, DEAD]) }], { terminal: 'response.incomplete' }),
      )
      .mockResolvedValueOnce(completed('Live [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer.__citation_metadata.grounding).toBe('regenerated_dead_sources');
  });

  it.each([
    ['an API error', () => mockCreate.mockRejectedValueOnce(new Error('boom'))],
    ['a failed status', () => mockCreate.mockResolvedValueOnce({ status: 'failed', error: { message: 'x' } })],
    ['a cancelled status', () => mockCreate.mockResolvedValueOnce({ status: 'cancelled' })],
    ['empty text', () => mockCreate.mockResolvedValueOnce(completed('   '))],
  ])('declines with declined_dead_sources when the rewrite fails with %s', async (_label, arrangeFailure) => {
    mockFetchDead(DEAD);
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'Yes [2].', searchResults: results([LIVE_A, DEAD]) }]));
    arrangeFailure();
    const streamer = makeStreamer(makeMetadata());
    const { botText } = await callPerplexityChat(streamer, USER);

    const metadata = streamer.__citation_metadata;
    expect(botText).toBe(NO_SOURCES_DECLINE_TEXT);
    expect(streamer._appended).toEqual([NO_SOURCES_DECLINE_TEXT]);
    expect(metadata.grounding).toBe('declined_dead_sources');
    // No Sources block under a decline: createSourcesBlocks renders from citation_index.
    expect(metadata.citation_index).toEqual({});
    expect(metadata.cited_markers).toEqual([]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

describe('buildRegenerateInput', () => {
  it('adds a system item when the prompts have none', () => {
    const input = buildRegenerateInput([{ role: 'user', content: 'q' }], [{ url: LIVE_A, title: 'A' }], {
      [LIVE_A]: 4,
    });
    expect(input[0]).toEqual(expect.objectContaining({ role: 'system' }));
    expect(input[0].content).toContain(`[4] A\nURL: ${LIVE_A}\n(no snippet)`);
  });

  it('leaves out a source with no result id, since nothing could link to it', () => {
    const input = buildRegenerateInput(USER, [{ url: LIVE_A, title: 'A' }, { url: LIVE_B, title: 'B' }], {
      [LIVE_A]: 1,
    });
    expect(input[0].content).not.toContain(LIVE_B);
  });
});

describe('regenerateFromSources', () => {
  it('passes a model override through, so a live evaluation can force a failure', async () => {
    mockCreate.mockResolvedValueOnce(completed('ok'));
    await regenerateFromSources(USER, [{ url: LIVE_A, title: 'A' }], { [LIVE_A]: 1 }, undefined, { model: 'x/y' });
    expect(mockCreate.mock.calls[0][0].model).toBe('x/y');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
  - Run: `npm test -- tests/agent/llm-caller.link-check.test.js`
  - Expected: FAIL, because `buildRegenerateInput` is not exported and no rewrite runs.

- [ ] **Step 3: Implement the rewrite call.** Add directly above the `// ─── Escalation Summary` banner:

```js
// ─── Rewrite From Live Sources (AI-227) ────────────────────────────────────
const REGENERATE_RESULTS_HEADER =
  '## Search results\n' +
  'Search has already been run for this question. These are the only results you may use; ' +
  'cite them by their [n] number exactly as given.';

/**
 * Input for rewriting an answer after a cited source proved dead: the same
 * prompts (system prompt and thread history), with the live results appended
 * to the system prompt under their original result ids. Sources with no id in
 * the map are left out, since a marker for them could not be linked.
 *
 * @param {Array} prompts - The prompts sent on the first call, system prompt first
 * @param {Array<import('./utils/source-normalizer.js').NormalizedSource>} liveSources
 * @param {Object} sourceIndexMap - URL -> result id, dead sources already removed
 */
export function buildRegenerateInput(prompts, liveSources, sourceIndexMap) {
  const entries = liveSources
    .filter((source) => sourceIndexMap[source.url] !== undefined)
    .map((source) => `[${sourceIndexMap[source.url]}] ${source.title}\nURL: ${source.url}\n${source.snippet?.trim() || '(no snippet)'}`);
  const block = `${REGENERATE_RESULTS_HEADER}\n\n${entries.join('\n\n')}`;

  const input = promptsToInputItems(prompts);
  const system = input.find((item) => item.role === 'system');
  if (system) {
    system.content = `${system.content}\n\n${block}`;
  } else {
    input.unshift({ type: 'message', role: 'system', content: block });
  }
  return input;
}

/**
 * Rewrite an answer from live sources only, with no search tool. One attempt:
 * returns null on any failure, and the caller declines rather than sending an
 * answer built on a dead page.
 *
 * @param {Array} prompts
 * @param {Array<import('./utils/source-normalizer.js').NormalizedSource>} liveSources
 * @param {Object} sourceIndexMap
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @param {{ model?: string }} [options] - model override, used by the live evaluation to force a failure
 * @returns {Promise<string | null>}
 */
export async function regenerateFromSources(prompts, liveSources, sourceIndexMap, logger, { model = PERPLEXITY_API_MODEL } = {}) {
  if (!perplexityClient) return null;
  try {
    const response = await perplexityClient.responses.create({
      model,
      input: buildRegenerateInput(prompts, liveSources, sourceIndexMap),
      stream: false,
    });
    // Failed and cancelled runs arrive over HTTP 200, as in summarizeForEscalation.
    if (response?.status && response.status !== 'completed' && response.status !== 'incomplete') {
      logger?.warn?.(`Rewrite from live sources ended with ${response.status}: ${response.error?.message || 'no error detail'}`);
      return null;
    }
    const text = response?.output_text;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch (error) {
    logger?.warn?.(`Rewrite from live sources failed: ${error.message}`);
    return null;
  }
}
```

  Check `promptsToInputItems` for a `system` role. It maps each prompt to a new `{ type: 'message', role, content }` object (see about line 480), so mutating `system.content` doesn't touch the caller's prompts.

- [ ] **Step 4: Wire it into the tail of `callPerplexityChat`.** Inside the `if (removed.length > 0) { … }` block from Task 5, replace the single `resolved = resolveCitations(textBuffer, …)` line with:

```js
      const citedRemoved = resolved.citedMarkers.some((marker) => removedUrls.has(resolved.indexToUrl.get(marker)));
      let answerText = textBuffer;
      if (citedRemoved && sources.length > 0) {
        const rewritten = await regenerateFromSources(prompts, sources, sourceIndexMap, logger);
        if (rewritten) {
          answerText = rewritten;
          regenerated = true;
          if (metadata) metadata.grounding = 'regenerated_dead_sources';
        } else {
          declinedDeadSources = true;
        }
      }
      resolved = resolveCitations(answerText, sources, sourceIndexMap, searchResults);
```

  Then make these edits:
  1. Declare `let regenerated = false;` right after `const started = Date.now();`, and change `regenerated: false` in the `link_check` assignment to `regenerated`.
  2. Declare `let declinedDeadSources = false;` just before the `if (sources.length > 0 && isCitationLinkCheckEnabled())` line.
  3. Replace the `citation_index` / `cited_markers` assignment and the `botText` section with:

```js
  if (metadata) {
    metadata.citation_index = declinedDeadSources ? {} : Object.fromEntries(resolved.indexToUrl);
    metadata.cited_markers = declinedDeadSources ? [] : resolved.citedMarkers;
  }

  let botText = '';
  if (sources.length === 0) {
    // Never show an answer with nothing behind it. Counting normalized
    // sources, not raw results, also catches results whose URLs were all
    // rejected or found dead. The escalation summary does not come through
    // here, so it still summarizes without sources.
    if (metadata) metadata.grounding = 'declined_no_results';
    botText = NO_SOURCES_DECLINE_TEXT;
    await streamer.append({ markdown_text: botText });
  } else if (declinedDeadSources) {
    // The answer relied on a dead page and could not be rewritten without it.
    if (metadata) metadata.grounding = 'declined_dead_sources';
    botText = NO_SOURCES_DECLINE_TEXT;
    await streamer.append({ markdown_text: botText });
  } else if (resolved.text) {
    botText = linkifyCitationMarkers(resolved.text, resolved.indexToUrl);
    await streamer.append({ markdown_text: botText });
  }
```

  `prompts` is `callPerplexityChat`'s own parameter, which already includes the system prompt that `callLLM` prepends. A production `SYSTEM_PROMPT` override therefore carries into the rewrite automatically.

- [ ] **Step 5: Run the tests to verify they pass.**
  - Run: `npm test -- tests/agent/llm-caller.link-check.test.js`, then `npm test`
  - Expected: all PASS.

- [ ] **Step 6: Lint, then commit.**

```bash
npm run lint
git add src/agent/llm-caller.js tests/agent/llm-caller.link-check.test.js
git commit -m "[AI-227] feat: rewrite answers from live sources when a cited source is dead" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Filter `/fiona search` results

**Files:**
- Modify: `src/agent/llm-caller.js` (`searchForSources`, about lines 954–978)
- Test: `tests/agent/search-caller.test.js`

**Interfaces:**
- Consumes: `validateSources` (Task 5) and `isCitationLinkCheckEnabled` (Task 1).
- Produces: `searchForSources(query, { maxSources, logger })`, same signature. It returns at most `maxSources` sources, none dead or denylisted.

- [ ] **Step 1: Pin the existing tests to today's behaviour.** Near the top of `tests/agent/search-caller.test.js`, before the dynamic import, add:

```js
// The describe blocks below predate link checking (AI-227) and assert the
// exact max_results sent; link checking asks for a few extra results. Its own
// block turns it back on.
process.env.CITATION_LINK_CHECK_ENABLED = 'false';
```

  After the existing `await import('../../src/agent/search-caller.js')` statement, add a top-level import. Jest `describe` callbacks can't be `async`, so this can't go inside the block:

```js
const { clearLinkCheckCache } = await import('../../src/agent/utils/link-checker.js');
```

  Also add `afterEach` to the file's `@jest/globals` import.

  Then run `npm test -- tests/agent/search-caller.test.js`. Expected: PASS.

- [ ] **Step 2: Write the failing tests.** Append to `tests/agent/search-caller.test.js`:

```js
describe('searchForSources link checking (AI-227)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearLinkCheckCache();
    delete process.env.CITATION_LINK_CHECK_ENABLED;
  });

  afterEach(() => {
    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    globalThis.fetch = () => Promise.reject(new Error('Unexpected network call in a unit test; mock globalThis.fetch'));
  });

  const page = (n) => ({ url: `https://docs.ed-fi.org/p${n}/`, title: `P${n}` });

  it('asks for 3 extra results, removes dead ones, and trims to the requested count', async () => {
    mockSearchOk([page(1), page(2), page(3), page(4), page(5)]);
    globalThis.fetch = jest.fn(async (url) => ({ status: url.endsWith('/p2/') ? 404 : 200 }));

    const sources = await searchForSources('q', { maxSources: 3 });

    expect(mockSearchCreate).toHaveBeenCalledWith(expect.objectContaining({ max_results: 6 }));
    expect(sources.map((s) => s.url)).toEqual([page(1).url, page(3).url, page(4).url]);
  });

  it('never asks for more than 10', async () => {
    mockSearchOk([page(1)]);
    globalThis.fetch = jest.fn(async () => ({ status: 200 }));
    await searchForSources('q', { maxSources: 9 });
    expect(mockSearchCreate).toHaveBeenCalledWith(expect.objectContaining({ max_results: 10 }));
  });

  it('removes denylisted results without fetching them', async () => {
    mockSearchOk([{ url: 'https://www.ed-fi.org/what-is-ed-fi-old/mission/' }, page(1)]);
    globalThis.fetch = jest.fn(async () => ({ status: 200 }));
    const sources = await searchForSources('q', { maxSources: 5 });
    expect(sources.map((s) => s.url)).toEqual([page(1).url]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when every result is dead', async () => {
    mockSearchOk([page(1)]);
    globalThis.fetch = jest.fn(async () => ({ status: 404 }));
    expect(await searchForSources('q', { maxSources: 5 })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**
  - Run: `npm test -- tests/agent/search-caller.test.js`
  - Expected: the new block FAILS, because `max_results` is still 3 and the dead result is returned.

- [ ] **Step 4: Implement.** In `searchForSources`, replace the body from `const cappedMaxSources = …` through the `return [];` that follows the results check with:

```js
  const cappedMaxSources = clampSearchMaxSources(maxSources);
  // Ask for a few extra when link checking is on, so removing dead results
  // does not leave the command short (AI-227).
  const linkCheck = isCitationLinkCheckEnabled();
  const fetchCount = linkCheck ? Math.min(cappedMaxSources + 3, SEARCH_ABSOLUTE_MAX) : cappedMaxSources;

  try {
    const response = await perplexityClient.search.create({
      query,
      max_results: fetchCount,
      search_domain_filter: PERPLEXITY_DOMAIN_FILTER,
    });

    const rawResults = response?.results;

    if (Array.isArray(rawResults) && rawResults.length > 0) {
      const { sources } = normalizeSources(rawResults, { maxSources: fetchCount });
      if (!linkCheck) return sources;
      const { kept } = await validateSources(sources, logger);
      return kept.slice(0, cappedMaxSources);
    }

    return [];
```

  Leave the existing `catch` block as it is.

- [ ] **Step 5: Run the tests to verify they pass.**
  - Run: `npm test -- tests/agent/search-caller.test.js`, then `npm test`
  - Expected: all PASS.

- [ ] **Step 6: Lint, then commit.**

```bash
npm run lint
git add src/agent/llm-caller.js tests/agent/search-caller.test.js
git commit -m "[AI-227] feat: remove dead and retired results from /fiona search" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Log line on both answer paths

**Files:**
- Modify: `src/listeners/assistant/message.js` (the `[citations]` `logger.info`, about line 260)
- Modify: `src/listeners/events/app_mention.js` (the same log line, about line 138)
- Test: `tests/listeners/assistant/message.test.js`, `tests/listeners/events/app-mention.test.js`

**Interfaces:**
- Consumes: `metadata.link_check.dead` and `metadata.link_check.regenerated` (Tasks 5–6).

- [ ] **Step 1: Write the failing tests.** In `tests/listeners/assistant/message.test.js`, after the test `'logs when the answer was declined for having no sources'`, add:

```js
  it('logs the dead-source count and whether the answer was rewritten', async () => {
    callLLM.mockResolvedValueOnce({
      metadata: {
        finalize_state: 'ready_to_finalize',
        sources: [{ url: 'https://a.com' }],
        source_index_map: { 'https://a.com': 1 },
        grounding: 'regenerated_dead_sources',
        link_check: { checked: 3, dead: 2, unknown: 0, denylisted: 0, regenerated: true, ms: 40 },
      },
      botText: 'rewritten',
      systemPromptVersion: 'v3',
    });

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('dead=2 regenerated=true'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('grounding=regenerated_dead_sources'));
  });
```

  In `tests/listeners/events/app-mention.test.js`, add the equivalent test after its `grounding=declined_no_results` test. Copy that test's handler invocation exactly, and use the same `callLLM.mockResolvedValueOnce` payload and the same two `expect` lines as above.

- [ ] **Step 2: Run the tests to verify they fail.**
  - Run: `npm test -- tests/listeners`
  - Expected: FAIL, because `dead=2 regenerated=true` isn't in the log.

- [ ] **Step 3: Implement.** In both files, extend the log expression to:

```js
          `[citations] state=${metadata.finalize_state} sources=${metadata.sources?.length ?? 0}` +
            (metadata.grounding ? ` grounding=${metadata.grounding}` : '') +
            (metadata.link_check
              ? ` dead=${metadata.link_check.dead} regenerated=${metadata.link_check.regenerated}`
              : ''),
```

  Keep each file's existing indentation.

- [ ] **Step 4: Run the tests to verify they pass.**
  - Run: `npm test`
  - Expected: PASS.

- [ ] **Step 5: Lint, then commit.**

```bash
npm run lint
git add src/listeners/assistant/message.js src/listeners/events/app_mention.js tests/listeners/assistant/message.test.js tests/listeners/events/app-mention.test.js
git commit -m "[AI-227] feat: log dead sources and rewrites on the [citations] line" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs

**Files:**
- Modify: `apps/fiona-slack/.env.sample` (after the `PERPLEXITY_DOMAIN_FILTER` lines)
- Modify: `docs/fiona-slack-prd.md` (repo root; §2.2.2, after the paragraph that ends "…only the prompt prevents a guess.")

- [ ] **Step 1: Update `.env.sample`.** Insert after `# PERPLEXITY_DOMAIN_FILTER=www.ed-fi.org,docs.ed-fi.org`:

```
# Optional, citation link checking (AI-227). Each answer's sources are checked,
# and pages returning 404/410 are dropped; an answer that cited one is rewritten
# from the live sources. On unless set to exactly "false".
# CITATION_LINK_CHECK_ENABLED=true
# Time budget in ms for checking one answer's sources (default 2000). Checks
# still running when it ends keep their source.
# CITATION_LINK_CHECK_TIMEOUT_MS=2000
# Comma-separated URL prefixes of retired pages to drop from search results.
# CITATION_PATH_DENYLIST=www.ed-fi.org/what-is-ed-fi-old/
```

- [ ] **Step 2: Update the PRD.** Insert this paragraph in `docs/fiona-slack-prd.md` §2.2.2, after "…only the prompt prevents a guess.":

```markdown
**Dead links (AI-227).** Perplexity's index still holds pages that now return
404, so after the answer is written, and before it is sent, Fiona checks every
source. Pages under a retired prefix (`CITATION_PATH_DENYLIST`) are dropped
without being fetched. The rest get a HEAD request (GET if HEAD is refused),
sent with the `User-Agent` `Fiona-LinkCheck/1.0 (+https://www.ed-fi.org/contact/)`
and only to hosts in `PERPLEXITY_DOMAIN_FILTER`. A 404 or 410 drops the
source. Any result the check cannot confirm, such as a timeout or a 5xx, keeps
the source. Results are cached: live pages for 1 hour and dead pages for 24
hours. If the answer cited a dropped source, it is rewritten once, with no
search tool, from the live sources only, and the metadata records
`grounding: 'regenerated_dead_sources'`. If that rewrite fails, the fixed
decline is sent, with `grounding: 'declined_dead_sources'`. If every source
was dropped, the no-results decline above applies. `/fiona search` drops dead
results the same way. The `[citations]` log line gains `dead=` and
`regenerated=`. Setting `CITATION_LINK_CHECK_ENABLED=false` restores the
previous behaviour.
```

- [ ] **Step 3: Commit.** Run this from the repo root, `C:\DEV\Ed-Fi\Fiona\.worktrees\ai-227-outdated-citations`:

```bash
git add apps/fiona-slack/.env.sample docs/fiona-slack-prd.md
git commit -m "[AI-227] docs: describe citation link checking in the PRD and env sample" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Full verification and live evaluation

**Files:**
- Create (throwaway, **outside the repo**): `%TEMP%\ai227-eval\eval.mjs`. Do not commit it.

- [ ] **Step 1: Run the full suite and lint.**
  - Run: `npm test` then `npm run lint`
  - Expected: all tests PASS and lint is clean. Record the test and suite counts for the PR.

- [ ] **Step 2: Write the evaluation script.** Create `%TEMP%\ai227-eval\eval.mjs`:

```js
// THROWAWAY live evaluation for AI-227. Not product code; do not commit.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const APP = 'C:/DEV/Ed-Fi/Fiona/.worktrees/ai-227-outdated-citations/apps/fiona-slack';
const env = readFileSync(`${APP}/.env`, 'utf8');
// Load only the API key; this worktree's .env may carry settings for other experiments.
process.env.PERPLEXITY_API_KEY = env.match(/^PERPLEXITY_API_KEY=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');

const { callLLM, regenerateFromSources } = await import(pathToFileURL(`${APP}/src/agent/llm-caller.js`).href);

const PROMPTS = {
  'Q-001': "Help me better understand Ed-Fi's governance structure",
  'Q-010': 'is there a document available on Recommended SEA Process Changes for API-based Data Collection?',
  'Q-011': 'What are the required fields for the Student resource?',
  colorado: 'Is Colorado using Ed-Fi?',
  licensing: 'Can I use the Ed-Fi ODS/API in a commercial product I sell?',
  'Q-005': 'Which states implement Ed-Fi?',
  scope: 'What is the capital of France?',
  coding: 'How do I get an OAuth token for the Ed-Fi ODS/API in Python?',
  chitchat: 'thanks!',
};
const MULTI_TURN = [
  { role: 'user', content: 'Which states use Ed-Fi?' },
  { role: 'assistant', content: 'Colorado uses Ed-Fi, among others.' },
  { role: 'user', content: 'Is Colorado using Ed-Fi?' },
];

const logger = { error: console.error, warn: console.warn, info: () => {}, debug: () => {} };
async function status(url) {
  try {
    return (await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) })).status;
  } catch {
    return 'error';
  }
}

const rows = [];
async function run(id, prompts) {
  for (let n = 1; n <= 2; n++) {
    const t0 = Date.now();
    const { metadata, botText } = await callLLM({ append: async () => {} }, prompts, logger);
    const shown = [...new Set([...Object.values(metadata.citation_index), ...metadata.sources.map((s) => s.url)])];
    const broken = [];
    for (const url of shown) if ([404, 410].includes(await status(url))) broken.push(url);
    rows.push({ id, n, ms: Date.now() - t0, grounding: metadata.grounding, link_check: metadata.link_check, broken, botText });
    console.log(`${id} #${n}: ${Date.now() - t0}ms grounding=${metadata.grounding} ${JSON.stringify(metadata.link_check)} broken=${broken.length}`);
  }
}

for (const [id, prompt] of Object.entries(PROMPTS)) await run(id, [{ role: 'user', content: prompt }]);
await run('colorado-multi-turn', MULTI_TURN);

// Forced rewrite failure: an invalid model slug makes the second call fail.
const failed = await regenerateFromSources([{ role: 'user', content: 'q' }], [{ url: 'https://docs.ed-fi.org/', title: 'Docs' }], { 'https://docs.ed-fi.org/': 1 }, logger, { model: 'invalid/model' });
console.log('forced rewrite failure returns null:', failed === null);

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(rows, null, 2));
```

- [ ] **Step 3: Run it.**
  - Run: `node "%TEMP%\ai227-eval\eval.mjs"`. It takes about 5 minutes.
  - Expected:
    - `broken=0` on every row.
    - `forced rewrite failure returns null: true`.
    - Colorado never answers "Yes" from a dead page (read `botText` in `results.json`).
    - Q-005 uses the case-study label.
    - The scope question is declined as out of scope.
    - The coding question is answered with citations.
    - Chit-chat isn't declined.
  - Record, for the PR: the rewrite rate, per-row latency, and the `unknown` counts.

- [ ] **Step 4: Hand over for Slack verification.** Report the eval results to the ticket owner, who checks in Slack on desktop and mobile: a normal answer, a rewritten answer (Colorado), and `/fiona search`. The decline text renders the same way as #118's decline, which is already verified in Slack.

---

## Self-Review Notes

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §3.2 link checking | 2 |
  | §3.3 denylist | 3 |
  | §3.4 rewrite decision | 5–6 |
  | §3.5 rewrite call | 6 |
  | §3.6 `/fiona search` | 7 |
  | §3.7 observability | 5, 6, 8 |
  | §3.8 outcomes | 5–6 tests |
  | §3.9 config | 1, 5, 9 |
  | §4 tests | per task |
  | §4.1 live evaluation | 10 |
  | §6 docs | 9 |

- **One deviation from the spec.** §4.1 says a forced rewrite failure would be tested in Slack through a test hook. The plan instead uses `regenerateFromSources`'s `model` option, called from the eval script (Task 10), because the decline's Slack rendering is identical to #118's and is already verified. Raise this with the ticket owner at review.
