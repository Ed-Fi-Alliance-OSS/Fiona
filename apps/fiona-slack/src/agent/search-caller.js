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

export { searchForSources } from './llm-caller.js';

const SEARCH_NO_RESULTS_TEXT = '🔍 No sources found for _"{{query}}"_. Try rephrasing your query.';
// Exported so slash and say()-based handlers can share a single error string.
export const SEARCH_ERROR_TEXT = ':warning: Search encountered an error. Please try again later.';

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
    const snippet = source.snippet ? `\n_"${escapeMrkdwn(source.snippet.trim())}"_` : '';
    return `${i + 1}. ${link}${snippet}`;
  });

  return `${header}\n\n${items.join('\n\n')}`;
}
