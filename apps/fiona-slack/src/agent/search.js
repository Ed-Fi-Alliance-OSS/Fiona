// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { OpenAI } from 'openai';
import { normalizeSources } from './utils/source-normalizer.js';

// ─── Perplexity Configuration ────────────────────────────────────────────────
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_API_MODEL = process.env.PERPLEXITY_API_MODEL || 'sonar';
const PERPLEXITY_DOMAIN_FILTER = process.env.PERPLEXITY_DOMAIN_FILTER
  ? process.env.PERPLEXITY_DOMAIN_FILTER.split(',').map((d) => d.trim())
  : ['www.ed-fi.org', 'docs.ed-fi.org'];

/** @type {OpenAI | undefined} */
let perplexityClient;
if (PERPLEXITY_API_KEY) {
  perplexityClient = new OpenAI({
    apiKey: PERPLEXITY_API_KEY,
    baseURL: 'https://api.perplexity.ai',
  });
}

// Maximum number of sources returned by /fiona search (PRD §2.3: 3–5)
export const SEARCH_MAX_SOURCES = 5;

// Snippet character cap — keeps Slack ephemeral messages readable
const SNIPPET_MAX_LENGTH = 200;

const SEARCH_SYSTEM_PROMPT =
  'You are a search assistant for the Ed-Fi Alliance community. ' +
  'Find the most relevant Ed-Fi documentation sources for the user query. ' +
  'Do not synthesize or summarize an answer. Return only factual, relevant results.';

/**
 * Escape Slack mrkdwn special characters so that user-supplied text
 * (query strings, titles, snippets) is rendered literally.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeMrkdwn(text) {
  if (!text || typeof text !== 'string') return '';
  // Escape backslash first to avoid double-escaping; then escape Slack mrkdwn
  // special characters: & < > * _ ~ `
  return text
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`');
}

/**
 * Truncate a string to a maximum length, appending "…" when truncated.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * Call the Perplexity API in non-streaming mode and return the top matching
 * source objects for the query. No synthesized answer is returned.
 *
 * @param {string} query - The user search query (already validated as non-empty).
 * @param {Object} [options]
 * @param {number} [options.maxSources] - Maximum number of sources to return.
 * @param {import('@slack/logger').Logger} [options.logger]
 * @returns {Promise<Array<import('./utils/source-normalizer.js').NormalizedSource>>}
 */
export async function fetchSearchSources(query, { maxSources = SEARCH_MAX_SOURCES, logger } = {}) {
  if (!perplexityClient) {
    logger?.warn?.('Perplexity client not configured; /fiona search unavailable');
    return [];
  }

  try {
    const response = await perplexityClient.chat.completions.create({
      model: PERPLEXITY_API_MODEL,
      messages: [
        { role: 'system', content: SEARCH_SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      search_domain_filter: PERPLEXITY_DOMAIN_FILTER,
      stream: false,
    });

    // Perplexity sonar models return:
    //   citations       — flat array of URL strings
    //   search_results  — array of { url, title, date, snippet } objects
    const citations = Array.isArray(response?.citations) ? response.citations : [];
    const searchResults = Array.isArray(response?.search_results) ? response.search_results : [];

    // Merge citation URLs with the richer search_results metadata (matched by URL)
    const rawSources = citations.map((url) => {
      const sr = searchResults.find((r) => r?.url === url);
      return {
        url,
        title: sr?.title,
        snippet: sr?.snippet,
        published_date: sr?.date,
      };
    });

    const { sources } = normalizeSources(rawSources, { maxSources });
    return sources;
  } catch (err) {
    logger?.warn?.(`/fiona search failed: ${err.message}`);
    return [];
  }
}

/**
 * Format a list of normalized sources as a Slack mrkdwn ephemeral message.
 * Returns a "no results" message when the sources list is empty.
 *
 * @param {string} query - The original search query.
 * @param {Array<import('./utils/source-normalizer.js').NormalizedSource>} sources
 * @returns {string} Slack mrkdwn text.
 */
export function formatSearchResults(query, sources) {
  const escapedQuery = escapeMrkdwn(query);

  if (!sources || sources.length === 0) {
    return (
      `:mag: No matching sources found for *"${escapedQuery}"*. ` +
      `Try rephrasing your query or use a broader search term.`
    );
  }

  const header = `:mag: *Search results for:* "${escapedQuery}"`;

  const items = sources.map((source, i) => {
    const title = escapeMrkdwn(source.title || source.hostname || source.url);
    const link = `<${source.url}|${title}>`;
    const rawSnippet = source.snippet ? truncate(source.snippet, SNIPPET_MAX_LENGTH) : '';
    const snippetLine = rawSnippet ? `\n   _"${escapeMrkdwn(rawSnippet)}"_` : '';
    return `${i + 1}. *${link}*${snippetLine}`;
  });

  return `${header}\n\n${items.join('\n\n')}`;
}
