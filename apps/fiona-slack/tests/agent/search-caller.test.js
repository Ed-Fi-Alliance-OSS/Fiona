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

const { searchForSources, formatSearchResults, escapeMrkdwn, SEARCH_ERROR_TEXT } = await import(
  '../../src/agent/search-caller.js'
);

describe('searchForSources', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns normalized sources from search_results', async () => {
    mockCreate.mockResolvedValue({
      search_results: [
        { url: 'https://docs.ed-fi.org/assessment', title: 'Assessment API', snippet: 'Snippet text' },
        { url: 'https://www.ed-fi.org/guide', title: 'API Guide', snippet: null },
      ],
      citations: [],
    });
    const sources = await searchForSources('assessment API');
    expect(sources).toHaveLength(2);
    expect(sources[0].url).toBe('https://docs.ed-fi.org/assessment');
    expect(sources[0].title).toBe('Assessment API');
    expect(sources[0].snippet).toBe('Snippet text');
    expect(sources[1].url).toBe('https://www.ed-fi.org/guide');
  });

  it('falls back to citations when search_results is absent', async () => {
    mockCreate.mockResolvedValue({
      citations: ['https://docs.ed-fi.org/a', 'https://docs.ed-fi.org/b'],
    });
    const sources = await searchForSources('Ed-Fi ODS');
    expect(sources).toHaveLength(2);
    expect(sources[0].url).toBe('https://docs.ed-fi.org/a');
  });

  it('falls back to citations when search_results is empty', async () => {
    mockCreate.mockResolvedValue({
      search_results: [],
      citations: ['https://docs.ed-fi.org/c'],
    });
    const sources = await searchForSources('Ed-Fi ODS');
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('https://docs.ed-fi.org/c');
  });

  it('returns empty array when both search_results and citations are empty', async () => {
    mockCreate.mockResolvedValue({ search_results: [], citations: [] });
    const sources = await searchForSources('nothing');
    expect(sources).toEqual([]);
  });

  it('returns empty array for empty query without calling the API', async () => {
    const sources = await searchForSources('');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(sources).toEqual([]);
  });

  it('returns empty array for whitespace-only query without calling the API', async () => {
    const sources = await searchForSources('   ');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(sources).toEqual([]);
  });

  it('returns no more than maxSources results', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      url: `https://docs.ed-fi.org/page-${i}`,
      title: `Page ${i}`,
      snippet: `Snippet ${i}`,
    }));
    mockCreate.mockResolvedValue({ search_results: manyResults });
    const sources = await searchForSources('query', { maxSources: 3 });
    expect(sources).toHaveLength(3);
  });

  it('warns and returns empty array when the API throws', async () => {
    mockCreate.mockRejectedValue(new Error('network failure'));
    const logger = { warn: jest.fn() };
    const sources = await searchForSources('query', { logger });
    expect(sources).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Search failed'));
  });

  it('does not throw when the API throws', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    await expect(searchForSources('query')).resolves.toEqual([]);
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
