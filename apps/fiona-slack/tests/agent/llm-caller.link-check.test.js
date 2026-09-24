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

const mockCreate = jest.fn();
jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: { create: mockCreate },
    search: { create: jest.fn() },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';

const { callPerplexityChat, NO_SOURCES_DECLINE_TEXT } = await import('../../src/agent/llm-caller.js');
const { clearLinkCheckCache } = await import('../../src/agent/utils/link-checker.js');

const LIVE_A = 'https://docs.ed-fi.org/live-a/';
const LIVE_B = 'https://docs.ed-fi.org/live-b/';
const DEAD = 'https://www.ed-fi.org/blog/gone/';
const RETIRED = 'https://www.ed-fi.org/what-is-ed-fi-old/mission/';

function makeStream(chunks, { terminal = 'response.completed' } = {}) {
  const events = [];
  for (const chunk of chunks) {
    if (chunk.text !== undefined) events.push({ type: 'response.output_text.delta', delta: chunk.text });
    if (chunk.searchResults !== undefined) {
      events.push({ type: 'response.reasoning.search_results', results: chunk.searchResults });
    }
  }
  events.push({
    type: terminal,
    response: {
      status: terminal === 'response.completed' ? 'completed' : 'incomplete',
      ...(terminal === 'response.incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    },
  });
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

/** Results with Agent API ids 1..n, in the order given. */
const results = (urls) => urls.map((url, i) => ({ id: i + 1, url, title: `T${i + 1}`, snippet: `S${i + 1}` }));

/** fetch mock: 404 for the given URLs, 200 for everything else. */
function mockFetchDead(...deadUrls) {
  globalThis.fetch = jest.fn(async (url) => ({ status: deadUrls.includes(url) ? 404 : 200 }));
}

const USER = [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'question' }];

beforeEach(() => {
  clearLinkCheckCache();
  mockCreate.mockReset();
  delete process.env.CITATION_LINK_CHECK_ENABLED;
});

afterEach(() => {
  globalThis.fetch = () => Promise.reject(new Error('Unexpected network call in a unit test; mock globalThis.fetch'));
});

describe('link check: no dead sources', () => {
  it('leaves the answer byte-identical to the unchecked path', async () => {
    const stream = () => makeStream([{ text: 'A [1] and B [2].', searchResults: results([LIVE_A, LIVE_B]) }]);

    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    mockCreate.mockResolvedValueOnce(stream());
    const off = makeStreamer(makeMetadata());
    await callPerplexityChat(off, USER);

    delete process.env.CITATION_LINK_CHECK_ENABLED;
    mockFetchDead();
    mockCreate.mockResolvedValueOnce(stream());
    const on = makeStreamer(makeMetadata());
    await callPerplexityChat(on, USER);

    expect(on._appended).toEqual(off._appended);
    expect(on.__citation_metadata.citation_index).toEqual(off.__citation_metadata.citation_index);
    expect(on.__citation_metadata.link_check).toEqual(
      expect.objectContaining({ checked: 2, dead: 0, unknown: 0, denylisted: 0, regenerated: false }),
    );
  });

  it('fetches nothing and records no link_check when the kill switch is off', async () => {
    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    globalThis.fetch = jest.fn();
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'A [1].', searchResults: results([DEAD]) }]));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(streamer.__citation_metadata.link_check).toBeUndefined();
    expect(streamer._appended[0]).toBe(`A [[1]](${DEAD}).`);
  });
});

describe('link check: dead or retired sources the answer does not cite', () => {
  it('drops them from sources and citation_index without rewriting', async () => {
    mockFetchDead(DEAD);
    mockCreate.mockResolvedValueOnce(
      makeStream([{ text: 'A [1].', searchResults: results([LIVE_A, DEAD, RETIRED]) }]),
    );
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);

    const metadata = streamer.__citation_metadata;
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(streamer._appended).toEqual([`A [[1]](${LIVE_A}).`]);
    expect(metadata.sources.map((s) => s.url)).toEqual([LIVE_A]);
    expect(Object.values(metadata.citation_index)).toEqual([LIVE_A]);
    expect(metadata.grounding).toBeUndefined();
    expect(metadata.link_check).toEqual(
      expect.objectContaining({ checked: 2, dead: 1, denylisted: 1, regenerated: false }),
    );
    // The retired path is never fetched.
    expect(globalThis.fetch.mock.calls.map(([url]) => url)).not.toContain(RETIRED);
  });

  it('keeps a source whose check is unknown', async () => {
    globalThis.fetch = jest.fn(async () => ({ status: 503 }));
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'A [1].', searchResults: results([LIVE_A]) }]));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([`A [[1]](${LIVE_A}).`]);
    expect(streamer.__citation_metadata.link_check.unknown).toBe(1);
  });

  it('declines with declined_no_results when every source is removed', async () => {
    mockFetchDead(DEAD);
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'Claim [1].', searchResults: results([DEAD, RETIRED]) }]));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([NO_SOURCES_DECLINE_TEXT]);
    expect(streamer.__citation_metadata.grounding).toBe('declined_no_results');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // Review Focus 2: a site outage must not strip or decline answers.
  it('sends the answer unchanged when every check fails', async () => {
    const stream = () => makeStream([{ text: 'A [1] and B [2].', searchResults: results([LIVE_A, DEAD]) }]);

    process.env.CITATION_LINK_CHECK_ENABLED = 'false';
    mockCreate.mockResolvedValueOnce(stream());
    const off = makeStreamer(makeMetadata());
    await callPerplexityChat(off, USER);

    delete process.env.CITATION_LINK_CHECK_ENABLED;
    globalThis.fetch = jest.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    mockCreate.mockResolvedValueOnce(stream());
    const on = makeStreamer(makeMetadata());
    await callPerplexityChat(on, USER);

    expect(on._appended).toEqual(off._appended);
    expect(on.__citation_metadata.sources).toEqual(off.__citation_metadata.sources);
    expect(on.__citation_metadata.grounding).toBeUndefined();
    expect(on.__citation_metadata.link_check).toEqual(expect.objectContaining({ unknown: 2, dead: 0 }));
    expect(mockCreate).toHaveBeenCalledTimes(2); // one per run: no rewrite
  });
});
