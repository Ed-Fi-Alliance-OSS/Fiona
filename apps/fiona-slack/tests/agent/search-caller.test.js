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

// Mock the Perplexity SDK so tests control search results without hitting the API.
const mockSearchCreate = jest.fn();
jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    search: { create: mockSearchCreate },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';

const { searchForSources, formatSearchResults, escapeMrkdwn, SEARCH_ERROR_TEXT } = await import(
  '../../src/agent/search-caller.js'
);

/**
 * Configure mockSearchCreate to resolve with the given results array.
 *
 * @param {Array<{url: string, title?: string, snippet?: string}>} results
 */
function mockSearchOk(results) {
  mockSearchCreate.mockResolvedValue({ results });
}

describe('searchForSources', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns normalized sources from search results', async () => {
    mockSearchOk([
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
    mockSearchOk([]);
    const sources = await searchForSources('nothing');
    expect(sources).toEqual([]);
  });

  it('returns empty array when results field is absent', async () => {
    mockSearchCreate.mockResolvedValue({});
    const sources = await searchForSources('nothing');
    expect(sources).toEqual([]);
  });

  it('returns empty array for empty query without calling the API', async () => {
    const sources = await searchForSources('');
    expect(mockSearchCreate).not.toHaveBeenCalled();
    expect(sources).toEqual([]);
  });

  it('returns empty array for whitespace-only query without calling the API', async () => {
    const sources = await searchForSources('   ');
    expect(mockSearchCreate).not.toHaveBeenCalled();
    expect(sources).toEqual([]);
  });

  it('caps max_results at 10 even when maxSources exceeds 10', async () => {
    mockSearchOk([]);
    await searchForSources('query', { maxSources: 20 });
    expect(mockSearchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_results: 10 }),
    );
  });

  it('passes max_results to the SDK and caps results via normalizeSources', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      url: `https://docs.ed-fi.org/page-${i}`,
      title: `Page ${i}`,
      snippet: `Snippet ${i}`,
    }));
    mockSearchOk(manyResults);
    const sources = await searchForSources('query', { maxSources: 3 });
    expect(sources).toHaveLength(3);
    expect(mockSearchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_results: 3 }),
    );
  });

  it('passes search_domain_filter to the SDK', async () => {
    mockSearchOk([]);
    await searchForSources('query');
    expect(mockSearchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ search_domain_filter: expect.any(Array) }),
    );
  });

  it('warns and returns empty array when the SDK throws', async () => {
    mockSearchCreate.mockRejectedValue(new Error('network failure'));
    const logger = { warn: jest.fn() };
    const sources = await searchForSources('query', { logger });
    expect(sources).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Search failed'));
  });

  it('does not throw when the SDK throws', async () => {
    mockSearchCreate.mockRejectedValue(new Error('boom'));
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

  it('includes the query in the header text', () => {
    const { text } = formatSearchResults('assessment API', sampleSources);
    expect(text).toContain('assessment API');
  });

  it('includes source URLs in text fallback', () => {
    const { text } = formatSearchResults('query', sampleSources);
    expect(text).toContain('https://docs.ed-fi.org/assessment');
    expect(text).toContain('https://www.ed-fi.org/guide');
  });

  it('includes source titles in text fallback', () => {
    const { text } = formatSearchResults('query', sampleSources);
    expect(text).toContain('Assessment API');
    expect(text).toContain('API Guide');
  });

  it('includes snippet in text fallback when present', () => {
    const { text } = formatSearchResults('query', sampleSources);
    expect(text).toContain('The Assessment API provides endpoints for assessment metadata.');
  });

  it('returns no-results text and null blocks for empty sources array', () => {
    const { text, blocks } = formatSearchResults('unknown topic', []);
    expect(text).toContain('No sources found');
    expect(text).toContain('unknown topic');
    expect(blocks).toBeNull();
  });

  it('returns no-results text and null blocks for null/undefined sources', () => {
    expect(formatSearchResults('query', null).text).toContain('No sources found');
    expect(formatSearchResults('query', null).blocks).toBeNull();
    expect(formatSearchResults('query', undefined).text).toContain('No sources found');
  });

  it('numbers each result starting at 1 in text fallback', () => {
    const { text } = formatSearchResults('query', sampleSources);
    expect(text).toMatch(/1\./);
    expect(text).toMatch(/2\./);
  });

  it('escapes & < > characters in the query', () => {
    const { text } = formatSearchResults('search & <find> more', []);
    expect(text).not.toContain('&find');
    expect(text).toContain('&amp;');
    expect(text).toContain('&lt;');
    expect(text).toContain('&gt;');
  });

  it('returns blocks array for non-empty sources', () => {
    const { blocks } = formatSearchResults('query', sampleSources);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('blocks include a section with the header text', () => {
    const { blocks, text } = formatSearchResults('my query', sampleSources);
    const header = blocks.find((b) => b.type === 'section' && b.text?.text?.includes('my query'));
    expect(header).toBeDefined();
    expect(text).toContain('my query');
  });

  it('blocks include divider blocks between results', () => {
    const { blocks } = formatSearchResults('query', sampleSources);
    const dividers = blocks.filter((b) => b.type === 'divider');
    expect(dividers.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks include a section block with source link for each result', () => {
    const { blocks } = formatSearchResults('query', sampleSources);
    const sections = blocks.filter((b) => b.type === 'section' && b.text?.text?.includes('docs.ed-fi.org/assessment'));
    expect(sections.length).toBeGreaterThan(0);
  });

  it('blocks include a context block with snippet for sources with snippets', () => {
    const { blocks } = formatSearchResults('query', sampleSources);
    const contextBlocks = blocks.filter((b) => b.type === 'context');
    expect(contextBlocks.length).toBeGreaterThan(0);
    const snippetBlock = contextBlocks.find((b) =>
      b.elements?.some((el) => el.text?.includes('Assessment API provides')),
    );
    expect(snippetBlock).toBeDefined();
  });

  it('strips ** bold markers from snippet in blocks', () => {
    const sources = [
      {
        url: 'https://docs.ed-fi.org/a',
        title: 'A',
        hostname: 'docs.ed-fi.org',
        snippet: '**Ed-Fi API v8** is the next-generation platform.',
      },
    ];
    const { blocks } = formatSearchResults('query', sources);
    const contextBlocks = blocks.filter((b) => b.type === 'context');
    expect(contextBlocks.length).toBeGreaterThan(0);
    const blockText = contextBlocks.map((b) => b.elements?.map((el) => el.text).join('')).join('');
    expect(blockText).not.toContain('**');
    expect(blockText).toContain('Ed-Fi API v8');
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
    const { text, blocks } = formatSearchResults('query', sources);
    expect(text).not.toContain('###');
    expect(text).toContain('Important Epics');
    const contextBlocks = blocks.filter((b) => b.type === 'context');
    const blockText = contextBlocks.map((b) => b.elements?.map((el) => el.text).join('')).join('');
    expect(blockText).not.toContain('###');
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
    const { blocks } = formatSearchResults('query', sources);
    const contextBlocks = blocks.filter((b) => b.type === 'context');
    const blockText = contextBlocks.map((b) => b.elements?.map((el) => el.text).join('')).join('');
    expect(blockText).not.toContain('\n');
  });

  it('truncates long snippets to 160 words and appends ellipsis', () => {
    const longSnippet = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const sources = [
      {
        url: 'https://docs.ed-fi.org/a',
        title: 'A',
        hostname: 'docs.ed-fi.org',
        snippet: longSnippet,
      },
    ];
    const { blocks } = formatSearchResults('query', sources);
    const contextBlocks = blocks.filter((b) => b.type === 'context');
    const blockText = contextBlocks.map((b) => b.elements?.map((el) => el.text).join('')).join('');
    expect(blockText).toContain('…');
    // Extract the plain snippet text (strip the surrounding italic markers)
    const snippetContent = blockText.replace(/^_"/, '').replace(/"_$/, '');
    const wordCount = snippetContent.replace('…', '').trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(160);
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

