// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/agent/utils/citation-telemetry.js', () => ({
  recordMetadataWaitDuration: jest.fn(),
  recordSourceCount: jest.fn(),
  incrementDegradedNoMetadataCount: jest.fn(),
  incrementTotalResponseCount: jest.fn(),
}));

// Forces validateSources() to throw without a throwing fetch: checkUrls()
// swallows every fetch error itself, so the throw has to come from downstream.
jest.unstable_mockModule('../../src/agent/utils/source-filter.js', () => ({
  filterSources: () => {
    throw new Error('source-filter exploded');
  },
  isDenylisted: () => false,
  parseDenylist: () => [],
  urlKey: (url) => url,
}));

const mockCreate = jest.fn();
jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: { create: mockCreate },
    search: { create: jest.fn() },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';

const { callPerplexityChat } = await import('../../src/agent/llm-caller.js');
const { clearLinkCheckCache } = await import('../../src/agent/utils/link-checker.js');

const LIVE_A = 'https://docs.ed-fi.org/live-a/';
const LIVE_B = 'https://docs.ed-fi.org/live-b/';

function makeStream(chunks) {
  const events = [];
  for (const chunk of chunks) {
    if (chunk.text !== undefined) events.push({ type: 'response.output_text.delta', delta: chunk.text });
    if (chunk.searchResults !== undefined) {
      events.push({ type: 'response.reasoning.search_results', results: chunk.searchResults });
    }
  }
  events.push({ type: 'response.completed', response: { status: 'completed' } });
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: async () => (i >= events.length ? { done: true } : { done: false, value: events[i++] }) };
    },
  };
}

function makeMetadata() {
  return { sources: [], source_index_map: Object.create(null), search_results: [], finalize_state: 'streaming_text' };
}

function makeStreamer(metadata) {
  const appended = [];
  return {
    __citation_metadata: metadata,
    append: jest.fn(async ({ markdown_text }) => appended.push(markdown_text)),
    _appended: appended,
  };
}

const results = (urls) => urls.map((url, i) => ({ id: i + 1, url, title: `T${i + 1}`, snippet: `S${i + 1}` }));

const USER = [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'question' }];

beforeEach(() => {
  clearLinkCheckCache();
  mockCreate.mockReset();
  delete process.env.CITATION_LINK_CHECK_ENABLED;
});

afterEach(() => {
  globalThis.fetch = () => Promise.reject(new Error('Unexpected network call in a unit test; mock globalThis.fetch'));
});

describe('link check: fails open when link checking itself throws', () => {
  it('sends the answer unchanged, with no rewrite, and records link_check.error', async () => {
    const stream = () => makeStream([{ text: 'A [1] and B [2].', searchResults: results([LIVE_A, LIVE_B]) }]);

    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    mockCreate.mockResolvedValueOnce(stream());
    const off = makeStreamer(makeMetadata());
    await callPerplexityChat(off, USER);

    delete process.env.CITATION_LINK_CHECK_ENABLED;
    globalThis.fetch = jest.fn(async () => ({ status: 200 }));
    mockCreate.mockResolvedValueOnce(stream());
    const on = makeStreamer(makeMetadata());
    await callPerplexityChat(on, USER);

    expect(on._appended).toEqual(off._appended);
    expect(on.__citation_metadata.citation_index).toEqual(off.__citation_metadata.citation_index);
    expect(mockCreate).toHaveBeenCalledTimes(2); // one per run: no rewrite call
    expect(on.__citation_metadata.link_check).toEqual(
      expect.objectContaining({ checked: 0, dead: 0, unknown: 0, denylisted: 0, regenerated: false, error: true }),
    );
  });
});
