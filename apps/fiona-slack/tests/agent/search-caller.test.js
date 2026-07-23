// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the OpenAI module to prevent module init errors (llm-caller.js creates
// an OpenAI client on load when PERPLEXITY_API_KEY is set).
jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';

const { searchForSources, formatSearchResults, escapeMrkdwn, SEARCH_ERROR_TEXT } = await import(
  '../../src/agent/search-caller.js'
);

/**
 * Build a resolved fetch mock that returns the given results array.
 *
 * @param {Array<{url: string, title?: string, snippet?: string}>} results
 */
function mockFetchOk(results) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ results }),
  });
}

describe('searchForSources', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = jest.fn();
  });

  it('returns normalized sources from search results', async () => {
    mockFetchOk([
      { url: 'https://docs.ed-fi.org/assessment', title: 'Assessment API', snippet: 'Snippet text' },
      { url: 'https://www.ed-fi.org/guide', title: 'API Guide', snippet: null },
    ]);
    const sources = await searchForSources('assessment API');
    expect(sources).toHaveLength(2);
    expect(sources[0].url).toBe('https://docs.ed-fi.org/assessment');
    expect(sources[0].title).toBe('Assessment API');
    expect(sources[0].snippet).toBe('Snippet text');
    expect(sources[1].url).toBe('https://www.ed-fi.org/guide');
  });

  it('returns empty array when results array is empty', async () => {
    mockFetchOk([]);
    const sources = await searchForSources('nothing');
    expect(sources).toEqual([]);
  });

  it('returns empty array when results field is absent', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const sources = await searchForSources('nothing');
    expect(sources).toEqual([]);
  });

  it('returns empty array for empty query without calling the API', async () => {
    const sources = await searchForSources('');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sources).toEqual([]);
  });

  it('returns empty array for whitespace-only query without calling the API', async () => {
    const sources = await searchForSources('   ');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(sources).toEqual([]);
  });

  it('caps max_results at 10 even when maxSources exceeds 10', async () => {
    mockFetchOk([]);
    await searchForSources('query', { maxSources: 20 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.perplexity.ai/search',
      expect.objectContaining({
        body: expect.stringContaining('"max_results":10'),
      }),
    );
  });

  it('passes max_results to the API and caps results via normalizeSources', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      url: `https://docs.ed-fi.org/page-${i}`,
      title: `Page ${i}`,
      snippet: `Snippet ${i}`,
    }));
    mockFetchOk(manyResults);
    const sources = await searchForSources('query', { maxSources: 3 });
    expect(sources).toHaveLength(3);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.perplexity.ai/search',
      expect.objectContaining({
        body: expect.stringContaining('"max_results":3'),
      }),
    );
  });

  it('sends the correct authorization header', async () => {
    mockFetchOk([]);
    await searchForSources('query');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.perplexity.ai/search',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ' + process.env.PERPLEXITY_API_KEY,
        }),
      }),
    );
  });

  it('warns and returns empty array when the API throws', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network failure'));
    const logger = { warn: jest.fn() };
    const sources = await searchForSources('query', { logger });
    expect(sources).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Search failed'));
  });

  it('does not throw when the API throws', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(searchForSources('query')).resolves.toEqual([]);
  });

  it('warns and returns empty array on HTTP error response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    const logger = { warn: jest.fn() };
    const sources = await searchForSources('query', { logger });
    expect(sources).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Search failed'));
  });
});

describe('formatSearchResults', () => {
  const sampleSources = [
    {
      url: 'https://docs.ed-fi.org/assessment',
      title: 'Assessment API',
      hostname: 'docs.ed-fi.org',
      snippet: 'The Assessment API provides endpoints for assessment metadata.',
    },
    {
      url: 'https://www.ed-fi.org/guide',
      title: 'API Guide',
      hostname: 'www.ed-fi.org',
      snippet: null,
    },
  ];

  it('includes the query in the header', () => {
    const result = formatSearchResults('assessment API', sampleSources);
    expect(result).toContain('assessment API');
  });

  it('includes source URLs as hyperlinks', () => {
    const result = formatSearchResults('query', sampleSources);
    expect(result).toContain('https://docs.ed-fi.org/assessment');
    expect(result).toContain('https://www.ed-fi.org/guide');
  });

  it('includes source titles', () => {
    const result = formatSearchResults('query', sampleSources);
    expect(result).toContain('Assessment API');
    expect(result).toContain('API Guide');
  });

  it('includes snippet when present', () => {
    const result = formatSearchResults('query', sampleSources);
    expect(result).toContain('The Assessment API provides endpoints for assessment metadata.');
  });

  it('returns no-results message for empty sources array', () => {
    const result = formatSearchResults('unknown topic', []);
    expect(result).toContain('No sources found');
    expect(result).toContain('unknown topic');
  });

  it('returns no-results message for null/undefined sources', () => {
    expect(formatSearchResults('query', null)).toContain('No sources found');
    expect(formatSearchResults('query', undefined)).toContain('No sources found');
  });

  it('numbers each result starting at 1', () => {
    const result = formatSearchResults('query', sampleSources);
    expect(result).toMatch(/1\./);
    expect(result).toMatch(/2\./);
  });

  it('escapes & < > characters in the query', () => {
    const result = formatSearchResults('search & <find> more', []);
    expect(result).not.toContain('&find');
    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });

  it('strips ** bold markers from snippet', () => {
    const sources = [
      {
        url: 'https://docs.ed-fi.org/a',
        title: 'A',
        hostname: 'docs.ed-fi.org',
        snippet: '**Ed-Fi API v8** is the next-generation platform.',
      },
    ];
    const result = formatSearchResults('query', sources);
    expect(result).not.toContain('**');
    expect(result).toContain('Ed-Fi API v8');
  });

  it('strips markdown heading markers from snippet', () => {
    const sources = [
      {
        url: 'https://docs.ed-fi.org/a',
        title: 'A',
        hostname: 'docs.ed-fi.org',
        snippet: '### Important Epics\n- DMS-928 - Relational storage model',
      },
    ];
    const result = formatSearchResults('query', sources);
    expect(result).not.toContain('###');
    expect(result).toContain('Important Epics');
  });

  it('collapses newlines in snippet to a single line', () => {
    const sources = [
      {
        url: 'https://docs.ed-fi.org/a',
        title: 'A',
        hostname: 'docs.ed-fi.org',
        snippet: 'Line one.\nLine two.\nLine three.',
      },
    ];
    const result = formatSearchResults('query', sources);
    // The snippet section of the output should not contain raw newlines
    const snippetMatch = result.match(/_"(.+?)"_/s);
    expect(snippetMatch).not.toBeNull();
    expect(snippetMatch[1]).not.toContain('\n');
  });

  it('truncates long snippets and appends ellipsis', () => {
    const longSnippet = 'A word '.repeat(40); // well over 150 chars
    const sources = [
      {
        url: 'https://docs.ed-fi.org/a',
        title: 'A',
        hostname: 'docs.ed-fi.org',
        snippet: longSnippet,
      },
    ];
    const result = formatSearchResults('query', sources);
    expect(result).toContain('…');
    // Extract the snippet content and verify it is ≤ 150 chars + ellipsis
    const snippetMatch = result.match(/_"(.+?)"_/s);
    expect(snippetMatch).not.toBeNull();
    expect(snippetMatch[1].replace('…', '').length).toBeLessThanOrEqual(150);
  });
});

describe('escapeMrkdwn', () => {
  it('escapes & to &amp;', () => {
    expect(escapeMrkdwn('a & b')).toBe('a &amp; b');
  });

  it('escapes < to &lt;', () => {
    expect(escapeMrkdwn('a < b')).toBe('a &lt; b');
  });

  it('escapes > to &gt;', () => {
    expect(escapeMrkdwn('a > b')).toBe('a &gt; b');
  });

  it('handles empty string', () => {
    expect(escapeMrkdwn('')).toBe('');
  });

  it('returns empty string for non-string input', () => {
    expect(escapeMrkdwn(null)).toBe('');
    expect(escapeMrkdwn(undefined)).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeMrkdwn('hello world')).toBe('hello world');
  });
});

describe('SEARCH_ERROR_TEXT', () => {
  it('is a non-empty string', () => {
    expect(typeof SEARCH_ERROR_TEXT).toBe('string');
    expect(SEARCH_ERROR_TEXT.length).toBeGreaterThan(0);
  });
});
