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

// These patterns parse the exact header formats produced by formatSearchResults()
// above, so they live here as the single source of truth for both feedback.js
// (click-time capture) and feedback_reason.js (fallback message-text lookup).
const SEARCH_QUERY_PATTERN = /^🔍 \*Search results for:\* _"([\s\S]+)"_(?:\n\n|$)/;
const SEARCH_NO_RESULTS_QUERY_PATTERN = /^🔍 No sources found for _"([\s\S]+)"_\. Try rephrasing your query\.$/;

/**
 * Extract the original query from a formatted Fiona search response.
 *
 * @param {string} messageText
 * @returns {string|null}
 */
export function extractSearchQuery(messageText) {
  if (typeof messageText !== 'string') return null;
  const match = messageText.match(SEARCH_QUERY_PATTERN) ?? messageText.match(SEARCH_NO_RESULTS_QUERY_PATTERN);
  return match?.[1] ?? null;
}

// Read snippet max word count from SEARCH_SNIPPET_MAX_WORDS env var.
// Falls back to 160 when the env var is absent, non-numeric, or not a positive integer.
const _snippetMaxRaw = Number.parseInt(process.env.SEARCH_SNIPPET_MAX_WORDS ?? '', 10);
const SNIPPET_MAX_WORDS = Number.isFinite(_snippetMaxRaw) && _snippetMaxRaw > 0 ? _snippetMaxRaw : 160;

/**
 * Strip common markdown syntax from a snippet and truncate to the configured
 * maximum word count (SNIPPET_MAX_WORDS).
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
  const cleaned = text
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/(^|\n)#{1,6}\s+/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/);
  if (words.length <= SNIPPET_MAX_WORDS) return cleaned;
  return `${words.slice(0, SNIPPET_MAX_WORDS).join(' ')}…`;
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
 * Percent-encode literal pipe characters in a URL before it's embedded in
 * Slack's `<url|label>` link syntax, where an unencoded `|` would otherwise
 * split the URL from its label.
 *
 * @param {string} url
 * @returns {string}
 */
function safeSlackLinkUrl(url) {
  return typeof url === 'string' ? url.replace(/\|/g, '%7C') : url;
}

/**
 * Format a list of normalized sources into a Slack Block Kit message with
 * a mrkdwn plain-text fallback. Each result is rendered as a section block
 * (title link) and an optional context block (snippet), separated by dividers.
 *
 * @param {string} query - The original search query (unsanitized)
 * @param {Array<import('./llm-caller.js').NormalizedSource>} sources - Normalized source list
 * @returns {{ text: string, blocks: Array<object> | null }} Slack message payload
 */
export function formatSearchResults(query, sources) {
  const safeQuery = escapeMrkdwn(query);

  if (!Array.isArray(sources) || sources.length === 0) {
    // Split/join instead of String#replace so `$`-sequences in safeQuery (e.g. `$&`)
    // are inserted literally rather than interpreted as replacement patterns.
    const [before, after] = SEARCH_NO_RESULTS_TEXT.split('{{query}}');
    return { text: `${before}${safeQuery}${after}`, blocks: null };
  }

  const headerText = `🔍 *Search results for:* _"${safeQuery}"_`;

  // ── Block Kit layout ───────────────────────────────────────────────────────
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: headerText } }, { type: 'divider' }];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const link = `*<${safeSlackLinkUrl(source.url)}|${escapeMrkdwn(source.title || source.hostname)}>*`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${i + 1}. ${link}` } });

    const rawSnippet = truncateSnippet(source.snippet);
    if (rawSnippet) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_"${escapeMrkdwn(rawSnippet)}"_` }],
      });
    }

    if (i < sources.length - 1) {
      blocks.push({ type: 'divider' });
    }
  }

  // ── Plain-text fallback (used by Slack notifications / accessibility) ──────
  const items = sources.map((source, i) => {
    const rawSnippet = truncateSnippet(source.snippet);
    const snippet = rawSnippet ? `\n${rawSnippet}` : '';
    return `${i + 1}. ${source.title || source.hostname} — ${source.url}${snippet}`;
  });
  const text = `${headerText}\n\n${items.join('\n\n')}`;

  return { text, blocks };
}
