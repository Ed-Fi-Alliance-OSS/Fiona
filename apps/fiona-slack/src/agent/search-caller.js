// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Search abstraction layer for the `/fiona search` skill.
 * Wraps the LLM-layer search call and provides Slack-specific formatting.
 * Imported by fiona.js so the slash command handler never depends on llm-caller
 * directly (preserving the architectural separation of concerns).
 */

import { searchForSources } from './llm-caller.js';

export { searchForSources };

const SEARCH_NO_RESULTS_TEXT = '🔍 No sources found for _"{{query}}"_. Try rephrasing your query.';
// Exported so slash and say()-based handlers can share a single error string.
export const SEARCH_ERROR_TEXT = ':warning: Search encountered an error. Please try again later.';

// Read snippet max length from env so operators can tune it without code changes.
// Falls back to 150 when the env var is absent, non-numeric, or not a positive integer.
const _snippetMaxRaw = Number.parseInt(process.env.SEARCH_SNIPPET_MAX_CHARS ?? '', 10);
const SNIPPET_MAX_CHARS = Number.isFinite(_snippetMaxRaw) && _snippetMaxRaw > 0 ? _snippetMaxRaw : 150;

/**
 * Strip common markdown syntax from a snippet and truncate to SNIPPET_MAX_CHARS.
 * Perplexity Search API snippets can contain bold markers, headings, and multi-
 * paragraph text; stripping and truncating keeps the Slack source list compact.
 *
 * Only `**bold**` and `### heading` patterns are removed; single-asterisk italic
 * is intentionally left untouched to avoid false positives on maths/code notation
 * (e.g. `a * b`).
 *
 * @param {string} text
 * @returns {string}
 */
function truncateSnippet(text) {
  if (!text || typeof text !== 'string') return '';
  // Collapse newlines and runs of whitespace to a single space
  let cleaned = text
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Strip bold markers (**text**) and heading markers (## …)
  cleaned = cleaned.replace(/\*\*([^*]*?)\*\*/g, '$1').replace(/#{1,6}\s+/g, '');
  if (cleaned.length <= SNIPPET_MAX_CHARS) return cleaned;
  // Truncate at the last word boundary before the limit
  const truncated = cleaned.slice(0, SNIPPET_MAX_CHARS).replace(/\s+\S*$/, '');
  return `${truncated}…`;
}

/**
 * Escape user-supplied text before embedding it in a Slack mrkdwn message.
 * Only `&`, `<`, and `>` need HTML-entity encoding per the Slack API spec.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeMrkdwn(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Format a list of normalized sources into a Slack mrkdwn ephemeral message.
 *
 * @param {string} query - The original search query (unsanitized)
 * @param {Array<import('./llm-caller.js').NormalizedSource>} sources - Normalized source list
 * @returns {string} Slack mrkdwn-formatted search results string
 */
export function formatSearchResults(query, sources) {
  const safeQuery = escapeMrkdwn(query);

  if (!Array.isArray(sources) || sources.length === 0) {
    return SEARCH_NO_RESULTS_TEXT.replace('{{query}}', safeQuery);
  }

  const header = `🔍 *Search results for:* _"${safeQuery}"_`;

  const items = sources.map((source, i) => {
    const link = `*<${source.url}|${escapeMrkdwn(source.title || source.hostname)}>*`;
    const rawSnippet = truncateSnippet(source.snippet);
    const snippet = rawSnippet ? `\n_"${escapeMrkdwn(rawSnippet)}"_` : '';
    return `${i + 1}. ${link}${snippet}`;
  });

  return `${header}\n\n${items.join('\n\n')}`;
}
