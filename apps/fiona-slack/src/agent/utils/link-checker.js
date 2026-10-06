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
 * Redirects are followed one hop at a time (at most 5), and each target must
 * also be an allowed host; a redirect off the allowlist is "unknown".
 *
 * Imports nothing from the agent layer, so it can be tested on its own.
 */

export const LINK_CHECK_USER_AGENT = 'Fiona-LinkCheck/1.0 (+https://www.ed-fi.org/contact/)';

const LIVE_TTL_MS = 60 * 60 * 1000;
const DEAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
// Servers that refuse HEAD answer with one of these; GET gets the real status.
const HEAD_REFUSED = new Set([403, 405, 501]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

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

/** @param {string[]} allowedBases - Allowlisted hosts already passed through bareHost */
function isAllowedHost(url, allowedBases) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = bareHost(parsed.hostname);
    return allowedBases.some((base) => host === base || host.endsWith(`.${base}`));
  } catch {
    return false;
  }
}

function verdictFor(status) {
  if (status === 404 || status === 410) return 'dead';
  if (status >= 200 && status < 400) return 'live';
  return 'unknown';
}

/**
 * Fetch `url` and return the final status, following redirects by hand so
 * every hop is held to the allowlist: a page redirecting off the allowed hosts
 * (or looping) is never fetched, and returns null ("unknown").
 */
async function finalStatus(url, method, signal, fetchImpl, allowedBases) {
  const init = { method, redirect: 'manual', signal, headers: { 'User-Agent': LINK_CHECK_USER_AGENT } };
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, init);
    // Only the status is needed; release the connection instead of reading the
    // page. Best effort: a failed release must not override the status.
    try {
      await response.body?.cancel?.();
    } catch {
      // Ignored: the status is already known.
    }
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers?.get?.('location') : null;
    if (!location) return response.status;
    current = new URL(location, current).href;
    if (!isAllowedHost(current, allowedBases)) return null;
  }
  return null;
}

async function probe(url, signal, fetchImpl, allowedBases) {
  let status = await finalStatus(url, 'HEAD', signal, fetchImpl, allowedBases);
  if (HEAD_REFUSED.has(status)) {
    status = await finalStatus(url, 'GET', signal, fetchImpl, allowedBases);
  }
  return status === null ? 'unknown' : verdictFor(status);
}

/**
 * Check each URL once, in parallel, within one shared time budget.
 *
 * @param {string[]} urls
 * @param {Object} options
 * @param {number} options.timeoutMs - Budget for the whole batch, a hard deadline; checks still running when it ends are "unknown"
 * @param {string[]} options.allowedHosts - Only these hosts and their subdomains are fetched (a leading www. is ignored), redirect targets included; others are "unknown"
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @returns {Promise<Map<string, 'live' | 'dead' | 'unknown'>>}
 */
export async function checkUrls(urls, { timeoutMs, allowedHosts, fetchImpl = globalThis.fetch, now = Date.now }) {
  const verdicts = new Map();
  const allowedBases = allowedHosts.map(bareHost);
  const controller = new AbortController();
  // The budget is a hard deadline: when it ends, requests are aborted and the
  // batch returns at once, even if a request ignores the abort.
  let endBudget;
  const budgetEnded = new Promise((resolve) => {
    endBudget = resolve;
  });
  const timer = setTimeout(() => {
    controller.abort();
    endBudget();
  }, timeoutMs);
  timer.unref?.();

  let returned = false;
  const checking = [];
  const pending = [];
  for (const url of new Set(urls)) {
    if (!isAllowedHost(url, allowedBases)) {
      verdicts.set(url, 'unknown');
      continue;
    }
    const hit = cache.get(url);
    if (hit && hit.expiresAt > now()) {
      verdicts.set(url, hit.verdict);
      continue;
    }
    checking.push(url);
    pending.push(
      probe(url, controller.signal, fetchImpl, allowedBases)
        .catch(() => 'unknown')
        .then((verdict) => {
          remember(url, verdict, now());
          // A check that finishes after the batch returned must not change the
          // verdicts the caller already has.
          if (!returned) verdicts.set(url, verdict);
        }),
    );
  }

  try {
    await Promise.race([Promise.all(pending), budgetEnded]);
  } finally {
    clearTimeout(timer);
  }
  returned = true;
  for (const url of checking) {
    if (!verdicts.has(url)) verdicts.set(url, 'unknown');
  }
  return verdicts;
}
