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
 * a path boundary (/, ?, or #), so ".../what-is-ed-fi-old" does not match
 * ".../what-is-ed-fi-older". Query strings and fragments are treated as boundaries.
 *
 * @param {string} url
 * @param {string[]} denylist - From parseDenylist
 * @returns {boolean}
 */
export function isDenylisted(url, denylist) {
  const key = urlKey(url);
  return denylist.some((prefix) => {
    if (key === prefix) return true;
    const nextChar = key.charAt(prefix.length);
    return ['/', '?', '#'].includes(nextChar) && key.startsWith(prefix);
  });
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
