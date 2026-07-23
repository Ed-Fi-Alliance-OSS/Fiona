// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreate = jest.fn();
jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';
const { fetchSearchSources, formatSearchResults, escapeMrkdwn, SEARCH_MAX_SOURCES } =
  await import('../../src/agent/search.js');

// ─── escapeMrkdwn ────────────────────────────────────────────────────────────
describe('escapeMrkdwn', () => {
  it('escapes & < > * _ ~ `', () => {
    expect(escapeMrkdwn('a & b < c > d *e* _f_ ~g~ `h`')).toBe(
      'a &amp; b &lt; c &gt; d \\*e\\* \\_f\\_ \\~g\\~ \\`h\\`',
    );
  });

  it('escapes backslashes first to prevent double-escaping', () => {
    expect(escapeMrkdwn('a\\b')).toBe('a\\\\b');
    expect(escapeMrkdwn('\\*bold\\*')).toBe('\\\\\\*bold\\\\\\*');
  });

  it('returns empty string for falsy input', () => {
    expect(escapeMrkdwn('')).toBe('');
    expect(escapeMrkdwn(null)).toBe('');
    expect(escapeMrkdwn(undefined)).toBe('');
  });

  it('returns unchanged string when no special characters', () => {
    expect(escapeMrkdwn('plain text')).toBe('plain text');
  });
});

// ─── fetchSearchSources ───────────────────────────────────────────────────────
describe('fetchSearchSources', () => {
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns normalized sources from Perplexity citations and search_results', async () => {
    mockCreate.mockResolvedValue({
      citations: ['https://docs.ed-fi.org/api', 'https://www.ed-fi.org/standard'],
      search_results: [
        { url: 'https://docs.ed-fi.org/api', title: 'Assessment API', snippet: 'Provides endpoints…' },
        { url: 'https://www.ed-fi.org/standard', title: 'Data Standard', snippet: 'Defines data…' },
      ],
    });

    const sources = await fetchSearchSources('assessment API', { logger });
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ url: 'https://docs.ed-fi.org/api', title: 'Assessment API' });
    expect(sources[1]).toMatchObject({ url: 'https://www.ed-fi.org/standard', title: 'Data Standard' });
  });

  it('returns empty array when citations is missing', async () => {
    mockCreate.mockResolvedValue({ choices: [] });
    const sources = await fetchSearchSources('anything', { logger });
    expect(sources).toEqual([]);
  });

  it('returns empty array and warns when API call throws', async () => {
    mockCreate.mockRejectedValue(new Error('network error'));
    const sources = await fetchSearchSources('anything', { logger });
    expect(sources).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('search failed'));
  });

  it('respects maxSources option', async () => {
    const manyUrls = Array.from({ length: 10 }, (_, i) => `https://docs.ed-fi.org/page${i}`);
    mockCreate.mockResolvedValue({ citations: manyUrls, search_results: [] });
    const sources = await fetchSearchSources('query', { maxSources: 3, logger });
    expect(sources).toHaveLength(3);
  });

  it('defaults to SEARCH_MAX_SOURCES (5) when no maxSources given', async () => {
    const manyUrls = Array.from({ length: 10 }, (_, i) => `https://docs.ed-fi.org/page${i}`);
    mockCreate.mockResolvedValue({ citations: manyUrls, search_results: [] });
    const sources = await fetchSearchSources('query', { logger });
    expect(sources.length).toBeLessThanOrEqual(SEARCH_MAX_SOURCES);
  });

  it('deduplicates repeated citation URLs', async () => {
    mockCreate.mockResolvedValue({
      citations: ['https://docs.ed-fi.org/api', 'https://docs.ed-fi.org/api'],
      search_results: [],
    });
    const sources = await fetchSearchSources('query', { logger });
    expect(sources).toHaveLength(1);
  });

  it('passes search_domain_filter in the API call', async () => {
    mockCreate.mockResolvedValue({ citations: [], search_results: [] });
    await fetchSearchSources('query', { logger });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ search_domain_filter: expect.any(Array) }),
    );
  });

  it('makes a non-streaming call', async () => {
    mockCreate.mockResolvedValue({ citations: [], search_results: [] });
    await fetchSearchSources('query', { logger });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
  });

  it('attaches snippet from matching search_result', async () => {
    mockCreate.mockResolvedValue({
      citations: ['https://docs.ed-fi.org/api'],
      search_results: [{ url: 'https://docs.ed-fi.org/api', title: 'API', snippet: 'The API does…' }],
    });
    const sources = await fetchSearchSources('query', { logger });
    expect(sources[0].snippet).toBe('The API does…');
  });

  it('handles search_result without matching citation gracefully', async () => {
    mockCreate.mockResolvedValue({
      citations: ['https://docs.ed-fi.org/api'],
      search_results: [{ url: 'https://unrelated.example.com/', title: 'Other', snippet: 'x' }],
    });
    const sources = await fetchSearchSources('query', { logger });
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('https://docs.ed-fi.org/api');
    expect(sources[0].snippet).toBeUndefined();
  });
});

// ─── formatSearchResults ──────────────────────────────────────────────────────
describe('formatSearchResults', () => {
  it('returns a "no results" message for an empty sources array', () => {
    const text = formatSearchResults('assessment API', []);
    expect(text).toMatch(/no matching sources/i);
    expect(text).toMatch('assessment API');
  });

  it('returns a "no results" message for null sources', () => {
    const text = formatSearchResults('assessment API', null);
    expect(text).toMatch(/no matching sources/i);
  });

  it('formats a source list with title links', () => {
    const sources = [
      { url: 'https://docs.ed-fi.org/api', title: 'Assessment API', snippet: 'Provides endpoints…' },
      { url: 'https://www.ed-fi.org/standard', title: 'Data Standard' },
    ];
    const text = formatSearchResults('assessment API', sources);
    expect(text).toContain('<https://docs.ed-fi.org/api|Assessment API>');
    expect(text).toContain('<https://www.ed-fi.org/standard|Data Standard>');
  });

  it('includes a snippet when present', () => {
    const sources = [{ url: 'https://docs.ed-fi.org/', title: 'Docs', snippet: 'Provides endpoints…' }];
    const text = formatSearchResults('query', sources);
    expect(text).toContain('Provides endpoints…');
  });

  it('escapes mrkdwn special characters in the query', () => {
    const text = formatSearchResults('*bold* _query_', []);
    expect(text).not.toContain('*bold*');
    expect(text).not.toContain('_query_');
    expect(text).toContain('\\*bold\\*');
    expect(text).toContain('\\_query\\_');
  });

  it('escapes mrkdwn special characters in source titles', () => {
    const sources = [{ url: 'https://docs.ed-fi.org/', title: 'ODS/API *Title*' }];
    const text = formatSearchResults('query', sources);
    expect(text).toContain('\\*Title\\*');
  });

  it('truncates long snippets', () => {
    const longSnippet = 'x'.repeat(300);
    const sources = [{ url: 'https://docs.ed-fi.org/', title: 'Docs', snippet: longSnippet }];
    const text = formatSearchResults('query', sources);
    // Snippet should be truncated to ≤ 200 chars + ellipsis
    expect(text).toContain('…');
    // Should NOT include the full 300-char snippet
    expect(text).not.toContain(longSnippet);
  });

  it('includes a search emoji header', () => {
    const sources = [{ url: 'https://docs.ed-fi.org/', title: 'Docs' }];
    const text = formatSearchResults('query', sources);
    expect(text).toContain(':mag:');
  });

  it('numbers sources starting from 1', () => {
    const sources = [
      { url: 'https://docs.ed-fi.org/a', title: 'A' },
      { url: 'https://docs.ed-fi.org/b', title: 'B' },
    ];
    const text = formatSearchResults('query', sources);
    expect(text).toContain('1. ');
    expect(text).toContain('2. ');
  });
});
