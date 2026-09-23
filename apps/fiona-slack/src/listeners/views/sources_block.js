// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { MetadataLifecycleState } from '../../agent/llm-caller.js';

// Slack rejects a section block whose text exceeds 3000 characters.
export const SLACK_SECTION_TEXT_LIMIT = 3000;

// Most sections the Sources block may use: a deliberate product limit, not a
// Slack one (Slack allows 50 blocks per message). It keeps the list from
// dwarfing the answer and leaves room for the rest of the message; ~10 entries
// pack into each section, so it holds ~100 ordinary sources. Raising it is safe
// up to Slack's limit if a larger list is ever needed.
export const SOURCES_BLOCK_BUDGET = 10;

// Headings: one "Sources" list when the cited markers are unknown or the
// answer cites nothing; otherwise cited sources first, then the rest.
const SOURCES_HEADING = '*Sources*';
const CITED_HEADING = '*Cited in this answer*';
const RETRIEVED_HEADING = '*Also retrieved*';
const MAX_TITLE_LENGTH = 150;
const MAX_DATE_LENGTH = 40;
// Longest entry that still fits in a section after the longest heading, since
// a heading is always packed together with the entry that follows it.
const MAX_LINE_LENGTH = SLACK_SECTION_TEXT_LIMIT - CITED_HEADING.length - 1;

function escapeMrkdwn(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Group marker numbers by the URL they resolve to, ordered by lowest number.
 * A duplicate-URL result aliases the shared URL, so one URL can carry several.
 */
function groupMarkersByUrl(citationIndex) {
  const markersByUrl = new Map();
  const entries = Object.entries(citationIndex)
    .map(([marker, url]) => [Number(marker), url])
    .sort(([a], [b]) => a - b);

  for (const [marker, url] of entries) {
    if (!markersByUrl.has(url)) markersByUrl.set(url, []);
    markersByUrl.get(url).push(marker);
  }
  return markersByUrl;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Format sorted marker numbers, collapsing runs of three or more into a range
 * ([1, 2, 3, 5] -> "1–3, 5") so a URL repeated under many ids stays short.
 */
function formatMarkers(markers) {
  const parts = [];
  for (let start = 0; start < markers.length; ) {
    let end = start;
    while (end + 1 < markers.length && markers[end + 1] === markers[end] + 1) end += 1;
    if (end - start >= 2) {
      parts.push(`${markers[start]}–${markers[end]}`);
    } else {
      parts.push(...markers.slice(start, end + 1));
    }
    start = end + 1;
  }
  return parts.join(', ');
}

function entryParts({ markers, url, source }) {
  return {
    label: `*[${formatMarkers(markers)}]*`,
    title: escapeMrkdwn(truncate(source?.title || url, MAX_TITLE_LENGTH)),
    date: source?.date ? ` · ${escapeMrkdwn(truncate(String(source.date), MAX_DATE_LENGTH))}` : '',
  };
}

/**
 * Unlinked form: names the host instead of linking, so its length does not
 * depend on the URL. Hard-capped as a last resort (e.g. a huge marker list),
 * so no entry can push a section past Slack's limit.
 */
function formatCompactLine(entry) {
  const { label, title, date } = entryParts(entry);
  const host = escapeMrkdwn(truncate(hostnameOf(entry.url), MAX_TITLE_LENGTH));
  return truncate(`${label} ${title} (${host})${date}`, MAX_LINE_LENGTH);
}

/** Linked form, falling back to the compact form when it would not fit. */
function formatSourceLine(entry) {
  const { label, title, date } = entryParts(entry);
  const linked = `${label} <${entry.url}|${title}>${date}`;
  return linked.length <= MAX_LINE_LENGTH ? linked : formatCompactLine(entry);
}

/**
 * Prefix a group's first entry with its heading, so the two are packed as one
 * unit and a heading can never be left at the bottom of a section on its own.
 */
function withHeading(heading, lines) {
  return lines.length > 0 ? [`${heading}\n${lines[0]}`, ...lines.slice(1)] : [];
}

/** Pack entry lines into as few sections as fit; lineCount counts entries. */
function packSections(lines) {
  const sections = [];
  for (const line of lines) {
    const current = sections.at(-1);
    if (current && current.text.length + 1 + line.length <= SLACK_SECTION_TEXT_LIMIT) {
      current.text = `${current.text}\n${line}`;
      current.lineCount += 1;
    } else {
      sections.push({ text: line, lineCount: 1 });
    }
  }
  return sections;
}

/**
 * Split entries into those the answer cites and the rest. An unknown or empty
 * cited list means there is nothing to split on, so every entry counts as
 * cited and the list keeps its single "Sources" heading.
 */
function splitByCitation(entries, citedMarkers) {
  if (!citedMarkers?.length) {
    return { heading: SOURCES_HEADING, cited: entries, uncited: [] };
  }
  const citedSet = new Set(citedMarkers);
  const isCited = (entry) => entry.markers.some((marker) => citedSet.has(marker));
  const cited = entries.filter(isCited);
  if (cited.length === 0) {
    return { heading: SOURCES_HEADING, cited: entries, uncited: [] };
  }
  return { heading: CITED_HEADING, cited, uncited: entries.filter((entry) => !isCited(entry)) };
}

/**
 * Build the numbered Sources blocks shown before the feedback block.
 *
 * Sources the answer cites (`metadata.cited_markers`) are listed first under
 * "Cited in this answer", and the other retrieved sources follow under "Also
 * retrieved". When the answer cites nothing, or the cited markers are unknown,
 * everything is listed under a single "Sources" heading.
 *
 * Numbering comes from `metadata.citation_index` — the same marker -> URL map
 * the inline `[n]` links were built from — so the list and the links cannot
 * disagree. Whenever the list fits SOURCES_BLOCK_BUDGET, every resolvable source is
 * listed and every linked marker has a matching entry. That covers every real
 * answer: a typical one has 15 sources, which use one or two sections.
 *
 * Long lists are split across section blocks to stay within Slack's text
 * limit, up to SOURCES_BLOCK_BUDGET sections. Only entries too long to pack
 * can overflow that. The overflow path (fitCitedEntries) then drops uncited
 * sources first. Past about 130 cited sources (at maximum title length) the
 * budget cannot hold them all, and the final note counts exactly what is left
 * out — a deliberate limit for inputs no real answer produces.
 *
 * Returns no blocks unless metadata reached READY_TO_FINALIZE, so a degraded
 * or still-collecting response never shows an empty or partial list.
 *
 * @param {import('../../agent/llm-caller.js').MetadataEnvelope | null | undefined} metadata
 * @returns {Array<Object>} Slack section blocks (empty when there is nothing to show)
 */
export function createSourcesBlocks(metadata) {
  if (metadata?.finalize_state !== MetadataLifecycleState.READY_TO_FINALIZE) {
    return [];
  }

  const markersByUrl = groupMarkersByUrl(metadata.citation_index ?? {});
  if (markersByUrl.size === 0) {
    return [];
  }

  const sourcesByUrl = new Map((metadata.sources ?? []).map((source) => [source.url, source]));
  const entries = [...markersByUrl].map(([url, markers]) => ({ url, markers, source: sourcesByUrl.get(url) }));

  const split = splitByCitation(entries, metadata.cited_markers);
  let sections = packSections([
    ...withHeading(split.heading, split.cited.map(formatSourceLine)),
    ...withHeading(RETRIEVED_HEADING, split.uncited.map(formatSourceLine)),
  ]);
  if (sections.length > SOURCES_BLOCK_BUDGET) {
    sections = fitCitedEntries(split);
  }

  return sections.map(({ text }) => ({ type: 'section', text: { type: 'mrkdwn', text } }));
}

/**
 * Overflow path, only reachable when entries are too long to pack; ordinary
 * lists fit the budget many times over. Keeps every source the answer cites
 * and drops uncited ones first, since those have no marker a reader could be
 * looking up. Cited sources that still do not fit switch to the compact form;
 * past about 130 of them, the rest are left out and counted in the note, so the
 * matching-entry guarantee no longer holds for those markers.
 * When the cited markers are unknown or empty, every source is treated as cited.
 */
function fitCitedEntries({ heading, cited: citedEntries, uncited }) {
  const uncitedCount = uncited.length;
  const budget = uncitedCount > 0 ? SOURCES_BLOCK_BUDGET - 1 : SOURCES_BLOCK_BUDGET;

  let sections = packSections(withHeading(heading, citedEntries.map(formatSourceLine)));
  if (sections.length > budget) {
    sections = packSections(withHeading(heading, citedEntries.map(formatCompactLine)));
  }

  if (sections.length > budget) {
    // Past ~130 cited sources even the compact form overflows the budget.
    // Deliberately not raised for inputs no real answer produces (measured:
    // 15 results); count exactly what is left out instead.
    sections = sections.slice(0, SOURCES_BLOCK_BUDGET - 1);
    const shown = sections.reduce((sum, section) => sum + section.lineCount, 0);
    const uncitedNote = uncitedCount > 0 ? `, plus ${uncitedCount} not cited in this answer` : '';
    sections.push({ text: `_+${citedEntries.length - shown} more cited sources not shown${uncitedNote}_` });
  } else if (uncitedCount > 0) {
    sections.push({ text: `_+${uncitedCount} more sources not cited in this answer_` });
  }
  return sections;
}
