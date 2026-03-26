// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * @typedef {Object} CitationMetadata
 * @property {string[]} urls - Ordered array of source URLs returned by the Perplexity Sonar API.
 *   Indices are 1-based in formatted output; the first URL is [1], the second is [2], etc.
 * @property {string} model - The Perplexity model that produced the citations (e.g. 'sonar').
 */

/**
 * Formats an array of citation URLs into a numbered Slack-markdown source list.
 *
 * Citations are appended **after** the full streamed response has been received so that
 * the list is always complete and deterministic (strict consistency over speed).
 *
 * Slack auto-links bare `<URL>` angle-bracket syntax without requiring separate link text,
 * which keeps the output readable while remaining clickable.
 *
 * @param {string[]} urls - Ordered source URLs from the Perplexity response.
 *   Empty or non-array values produce an empty string (no sources section).
 * @returns {string} Formatted markdown block, or an empty string when there are no citations.
 *
 * @example
 * formatCitations(['https://docs.ed-fi.org/a', 'https://www.ed-fi.org/b'])
 * // Returns:
 * // "\n\n*Sources:*\n1. <https://docs.ed-fi.org/a>\n2. <https://www.ed-fi.org/b>"
 */
export function formatCitations(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return '';
  const lines = urls.map((url, i) => `${i + 1}. <${url}>`);
  return `\n\n*Sources:*\n${lines.join('\n')}`;
}
