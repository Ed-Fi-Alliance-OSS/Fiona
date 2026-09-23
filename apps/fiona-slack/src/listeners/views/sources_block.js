// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { MetadataLifecycleState } from '../../agent/llm-caller.js';

// Slack rejects a section block whose text exceeds 3000 characters.
export const SLACK_SECTION_TEXT_LIMIT = 3000;

// Most sections the Sources block may use. Slack rejects a message with more
// than 50 blocks; ~10 entries pack into each section, so this holds ~100
// ordinary sources while leaving ample room for the rest of the message.
export const SOURCES_BLOCK_BUDGET = 10;

const SOURCES_HEADING = '*Sources*';
const MAX_TITLE_LENGTH = 150;

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
 * A URL can be arbitrarily long, so an entry too long for one section drops
 * its link and names the host instead; the inline [n] marker still links.
 */
function formatSourceLine(markers, url, source) {
  const label = `*[${markers.join(', ')}]*`;
  const title = escapeMrkdwn(truncate(source?.title || url, MAX_TITLE_LENGTH));
  const date = source?.date ? ` · ${escapeMrkdwn(String(source.date))}` : '';

  const linked = `${label} <${url}|${title}>${date}`;
  if (SOURCES_HEADING.length + 1 + linked.length <= SLACK_SECTION_TEXT_LIMIT) {
    return linked;
  }
  return `${label} ${title} (${escapeMrkdwn(truncate(hostnameOf(url), MAX_TITLE_LENGTH))})${date}`;
}

/** Pack lines into as few sections as fit, the first headed "Sources". */
function packSections(lines) {
  const sections = [{ text: SOURCES_HEADING, lineCount: 0 }];
  for (const line of lines) {
    const current = sections[sections.length - 1];
    if (current.text.length + 1 + line.length <= SLACK_SECTION_TEXT_LIMIT) {
      current.text = `${current.text}\n${line}`;
      current.lineCount += 1;
    } else {
      sections.push({ text: line, lineCount: 1 });
    }
  }
  return sections;
}

/**
 * Build the numbered Sources blocks shown before the feedback block.
 *
 * Numbering comes from `metadata.citation_index` — the same marker -> URL map
 * the inline `[n]` links were built from — so every linked marker has a
 * matching entry. Every resolvable source is listed; nothing is truncated,
 * since a cut-off list would leave some markers without an entry. Long lists
 * are split across section blocks to stay within Slack's text limit, up to
 * SOURCES_BLOCK_BUDGET sections; only entries too long to pack can overflow
 * that, and the overflow is summarised in a final note.
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
  const lines = [...markersByUrl].map(([url, markers]) => formatSourceLine(markers, url, sourcesByUrl.get(url)));

  let sections = packSections(lines);
  if (sections.length > SOURCES_BLOCK_BUDGET) {
    // Only reachable when entries are too long to pack; ordinary lists fit
    // many times over. Every omitted source is still linked inline.
    sections = sections.slice(0, SOURCES_BLOCK_BUDGET - 1);
    const listed = sections.reduce((sum, section) => sum + section.lineCount, 0);
    sections.push({ text: `_+${lines.length - listed} more sources, linked inline in the answer above_` });
  }

  return sections.map(({ text }) => ({ type: 'section', text: { type: 'mrkdwn', text } }));
}
