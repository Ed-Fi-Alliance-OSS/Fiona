// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { urlKey } from './source-filter.js';
import { normalizeSource } from './source-normalizer.js';

function buildIndexToUrlMap(sourceIndexMap = {}, rawResults = []) {
  const indexToUrl = new Map();

  for (const [url, index] of Object.entries(sourceIndexMap)) {
    const normalizedIndex = Number(index);
    if (Number.isInteger(normalizedIndex) && normalizedIndex > 0 && !indexToUrl.has(normalizedIndex)) {
      indexToUrl.set(normalizedIndex, url);
    }
  }

  addDuplicateIdAliases(indexToUrl, sourceIndexMap, rawResults);

  return indexToUrl;
}

/**
 * Dedup keeps one source per URL, so a result repeating an earlier URL under a
 * new Agent API id drops out of `source_index_map`, and a marker citing that id
 * would stay bare. Alias each such id to the URL it shares. Only applies when
 * the map is keyed by API id — every result carries a unique id and each kept
 * URL is indexed by its first result's id — since positional numbering has no
 * relationship to the raw ids.
 */
function addDuplicateIdAliases(indexToUrl, sourceIndexMap, rawResults) {
  const results = rawResults.map(normalizeSource).filter(Boolean);
  const ids = results.map((result) => result.id);
  if (ids.length === 0 || ids.some((id) => id === undefined) || new Set(ids).size !== ids.length) {
    return;
  }

  const firstIdByUrl = new Map();
  for (const result of results) {
    if (!firstIdByUrl.has(result.url)) {
      firstIdByUrl.set(result.url, result.id);
    }
  }
  const keyedByApiId = Object.entries(sourceIndexMap).every(([url, index]) => firstIdByUrl.get(url) === index);
  if (!keyedByApiId) {
    return;
  }

  for (const result of results) {
    if (!indexToUrl.has(result.id) && sourceIndexMap[result.url] !== undefined) {
      indexToUrl.set(result.id, result.url);
    }
  }
}

export function linkifyCitationMarkers(text, indexToUrl) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  if (indexToUrl.size === 0) {
    return text;
  }

  return text.replace(/\[(\d+)\]/g, (full, rawIndex) => {
    const index = parseInt(rawIndex, 10);
    const url = indexToUrl.get(index);

    if (!url) {
      return full;
    }

    return `[[${index}]](${url})`;
  });
}

// A trailing, model-written source list: an optional "Sources" / "References"
// heading, then lines like "[1] Title: [label](https://...)" or "- [2] https://...".
const MODEL_LIST_HEADING = /^\s*(?:#{1,6}\s*)?\**\s*(?:sources|references|citations)\s*\**\s*:?\s*\**\s*$/i;
const MODEL_LIST_LINE = /^\s*(?:[-*]\s*)?\[(\d+)\]\s*\S/;
const URL_IN_TEXT = /https?:\/\/[^\s)<>\]]+/g;

/**
 * Build a function that maps a URL the model wrote to the search result it
 * names: an exact match first, else a loose (urlKey) match that is unique.
 * Returns undefined for a URL the search did not return, or one that loosely
 * matches several results, rather than guess.
 *
 * @param {Array<{url: string}>} sources - Normalized, deduplicated search results
 * @returns {(url: string) => string | undefined}
 */
function makeResultUrlResolver(sources) {
  const resultUrls = new Set(sources.map((source) => source.url));
  // null marks a key shared by several results, which cannot be resolved.
  const resultUrlByKey = new Map();
  for (const { url } of sources) {
    const key = urlKey(url);
    resultUrlByKey.set(key, resultUrlByKey.has(key) ? null : url);
  }
  return (url) => (resultUrls.has(url) ? url : (resultUrlByKey.get(urlKey(url)) ?? undefined));
}

/**
 * Find a source list the model appended to its answer, and cut it off.
 *
 * Measured against production: when the model writes its own list it numbers
 * its sources 1, 2, 3... itself instead of citing Agent API result ids, so
 * linking `[n]` to result id n pointed at the wrong page (0 of 4 correct in
 * one run). The list is the only record of what each number means.
 *
 * A list headed "Sources" / "References" / "Citations" is every `[n]` line
 * under the heading, blank lines between entries allowed; a line that names a
 * page without a URL is still part of it, and its marker stays unlinked. A
 * headed list with no URL at all is kept: it may be steps, and deleting it
 * would leave its markers unexplained. Unheaded, the whole trailing run of
 * `[n]` lines must carry URLs, every one of its numbers must be cited earlier
 * in the answer AND every one of its URLs must be a search result. A closing
 * list of numbered steps with links fails that (typically most step numbers
 * are never cited), so it is kept as content. When unsure, keeping text beats
 * deleting it: a missed list only falls back to result-id linking.
 *
 * @param {string} text - Raw answer text
 * @param {(url: string) => string | undefined} resolveResultUrl - From makeResultUrlResolver
 * @returns {{ text: string, urlByMarker: Map<number, string | null> } | null} Text without the list, and the model's marker -> URL (null for a line without one); null when there is no list
 */
function extractModelSourceList(text, resolveResultUrl) {
  const lines = text.split('\n');
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;

  const precedingCut = (index) => {
    let cut = index;
    while (cut > 0 && !lines[cut - 1].trim()) cut -= 1;
    return cut;
  };
  const listFrom = (start) => {
    const urlByMarker = new Map();
    for (const line of lines.slice(start, end).filter((entry) => MODEL_LIST_LINE.test(entry))) {
      urlByMarker.set(Number(line.match(MODEL_LIST_LINE)[1]), line.match(URL_IN_TEXT)?.at(-1) ?? null);
    }
    return urlByMarker;
  };

  let start = end;
  while (start > 0 && (MODEL_LIST_LINE.test(lines[start - 1]) || !lines[start - 1].trim())) start -= 1;
  const headingCut = precedingCut(start);
  const hasEntries = lines.slice(start, end).some((line) => MODEL_LIST_LINE.test(line));
  if (hasEntries && headingCut > 0 && MODEL_LIST_HEADING.test(lines[headingCut - 1])) {
    const urlByMarker = listFrom(start);
    if (![...urlByMarker.values()].some(Boolean)) {
      return null;
    }
    const answer = lines.slice(0, headingCut - 1).join('\n');
    return { text: answer.trimEnd(), urlByMarker };
  }

  start = end;
  while (start > 0 && MODEL_LIST_LINE.test(lines[start - 1]) && lines[start - 1].match(URL_IN_TEXT)) start -= 1;
  if (start === end || (start > 0 && MODEL_LIST_LINE.test(lines[start - 1]))) {
    return null;
  }
  const urlByMarker = listFrom(start);
  const answer = lines.slice(0, precedingCut(start)).join('\n');
  const allCited = [...urlByMarker.keys()].every((marker) => answer.includes(`[${marker}]`));
  const allResults = [...urlByMarker.values()].every((url) => resolveResultUrl(url) !== undefined);
  if (!allCited || !allResults) {
    return null;
  }

  return { text: answer.trimEnd(), urlByMarker };
}

/**
 * Marker -> URL built from the model's own list. Each listed URL is matched to
 * a search result (see makeResultUrlResolver), so only retrieved pages are
 * ever linked; an unmatched or missing URL leaves its marker as plain text.
 * The results the model did not list follow, numbered from just after the
 * highest listed marker and skipping every number the answer uses, so they
 * can never collide with a marker in the text, and a stray "[2026]" does not
 * push them to [2027].
 *
 * @param {Map<number, string | null>} urlByMarker - The model's marker -> URL
 * @param {Array<{url: string}>} sources - Normalized, deduplicated search results
 * @param {(url: string) => string | undefined} resolveResultUrl - From makeResultUrlResolver
 * @param {string} text - Answer text with the list removed
 * @returns {Map<number, string>}
 */
function buildModelListIndex(urlByMarker, sources, resolveResultUrl, text) {
  const indexToUrl = new Map();
  for (const [marker, url] of [...urlByMarker].sort(([a], [b]) => a - b)) {
    const resultUrl = url && resolveResultUrl(url);
    if (resultUrl) indexToUrl.set(marker, resultUrl);
  }

  const taken = new Set([...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  let next = Math.max(0, ...urlByMarker.keys()) + 1;
  const listed = new Set(indexToUrl.values());
  for (const source of sources) {
    if (listed.has(source.url)) continue;
    while (taken.has(next)) next += 1;
    indexToUrl.set(next++, source.url);
  }
  return indexToUrl;
}

/**
 * Work out what each [n] marker in the text links to. When the model appended
 * its own source list, its numbers are its own, so link by the list and drop it
 * (only the Sources block lists sources); otherwise link by result id.
 *
 * @param {string} text - Raw answer text
 * @param {Array<import('./source-normalizer.js').NormalizedSource>} sources
 * @param {Object} sourceIndexMap - URL -> result id
 * @param {Array<Object>} rawResults - Raw search results (for duplicate-id aliases)
 * @returns {{ text: string, indexToUrl: Map<number, string>, citedMarkers: number[] }}
 */
export function resolveCitations(text, sources, sourceIndexMap, rawResults) {
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
