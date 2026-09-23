// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { MetadataLifecycleState } from '../../agent/llm-caller.js';

// Slack rejects a section block whose text exceeds 3000 characters.
export const SLACK_SECTION_TEXT_LIMIT = 3000;

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

function formatSourceLine(markers, url, source) {
  const title = escapeMrkdwn(truncate(source?.title || url, MAX_TITLE_LENGTH));
  const date = source?.date ? ` · ${escapeMrkdwn(String(source.date))}` : '';
  return `*[${markers.join(', ')}]* <${url}|${title}>${date}`;
}

/**
 * Build the numbered Sources blocks shown before the feedback block.
 *
 * Numbering comes from `metadata.citation_index` — the same marker -> URL map
 * the inline `[n]` links were built from — so every linked marker has a
 * matching entry. Every resolvable source is listed; nothing is truncated,
 * since a cut-off list would leave some markers without an entry. Long lists
 * are split across section blocks to stay within Slack's text limit.
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

  const chunks = [SOURCES_HEADING];
  for (const line of lines) {
    const current = chunks[chunks.length - 1];
    if (current.length + 1 + line.length <= SLACK_SECTION_TEXT_LIMIT) {
      chunks[chunks.length - 1] = `${current}\n${line}`;
    } else {
      chunks.push(line);
    }
  }

  return chunks.map((text) => ({ type: 'section', text: { type: 'mrkdwn', text } }));
}
