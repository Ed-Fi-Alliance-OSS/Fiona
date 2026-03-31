/*
 * SPDX-License-Identifier: Apache-2.0
 * Licensed to the Ed-Fi Alliance under one or more agreements.
 * The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
 * See the LICENSE and NOTICES files in the project root for more information.
 */

import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('@azure/ai-projects', () => ({ AIProjectClient: jest.fn() }));
jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.unstable_mockModule('openai', () => ({ OpenAI: jest.fn(), AzureOpenAI: jest.fn() }));
jest.unstable_mockModule('../../src/agent/utils/citation-telemetry.js', () => ({
  recordMetadataWaitDuration: jest.fn(),
  recordSourceCount: jest.fn(),
  incrementDegradedNoMetadataCount: jest.fn(),
  incrementTotalResponseCount: jest.fn(),
}));

const { aggregatePerplexityMetadata } = await import('../../src/agent/llm-caller.js');

function makeMetadata() {
  return {
    sources: [],
    source_index_map: Object.create(null),
    search_results: [],
    finalize_state: 'streaming_text',
  };
}

describe('aggregatePerplexityMetadata — web search citation filter', () => {
  it('excludes web search results not present in citations', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      citations: ['https://cited.example.com'],
      web_search_results: [
        { url: 'https://cited.example.com', title: 'Cited Page' },
        { url: 'https://uncited.example.com', title: 'Uncited Page' },
      ],
    });

    const urls = metadata.sources.map((s) => s.url);
    expect(urls).toContain('https://cited.example.com');
    expect(urls).not.toContain('https://uncited.example.com');
  });

  it('includes all citations even when no web_search_results provided', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      citations: ['https://a.example.com', 'https://b.example.com'],
    });

    const urls = metadata.sources.map((s) => s.url);
    expect(urls).toContain('https://a.example.com');
    expect(urls).toContain('https://b.example.com');
  });

  it('uses title and snippet from web_search_results to enrich cited sources', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      citations: ['https://cited.example.com'],
      web_search_results: [{ url: 'https://cited.example.com', title: 'Rich Title', snippet: 'Some context' }],
    });

    const source = metadata.sources.find((s) => s.url === 'https://cited.example.com');
    expect(source).toBeDefined();
    expect(source.title).toBe('Rich Title');
    expect(source.snippet).toBe('Some context');
  });

  it('produces no sources when citations is empty', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      citations: [],
      web_search_results: [{ url: 'https://uncited.example.com', title: 'Uncited' }],
    });

    expect(metadata.sources).toHaveLength(0);
  });

  it('handles web_search_results with no matching citations gracefully', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      citations: ['https://other.example.com'],
      web_search_results: [{ url: 'https://no-match.example.com', title: 'No Match' }],
    });

    const urls = metadata.sources.map((s) => s.url);
    expect(urls).toContain('https://other.example.com');
    expect(urls).not.toContain('https://no-match.example.com');
  });

  it('is a no-op when perplexityResponse is null', () => {
    const metadata = makeMetadata();
    expect(() => aggregatePerplexityMetadata(metadata, null)).not.toThrow();
    expect(metadata.sources).toHaveLength(0);
  });
});
