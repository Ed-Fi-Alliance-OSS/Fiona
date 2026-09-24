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

const { callPerplexityChat, NO_SOURCES_DECLINE_TEXT, buildRegenerateInput, regenerateFromSources } = await import(
  '../../src/agent/llm-caller.js'
);
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

const completed = (text) => ({ status: 'completed', output_text: text });

describe('link check: a cited source is dead', () => {
  it('rewrites the answer from live sources only, with no tools, keeping thread history', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(makeStream([{ text: 'Yes [2].', searchResults: results([LIVE_A, DEAD, LIVE_B]) }]))
      .mockResolvedValueOnce(completed('Could not confirm; see [1] and [3].'));
    const streamer = makeStreamer(makeMetadata());
    const prompts = [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'question' },
    ];
    await callPerplexityChat(streamer, prompts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const rewriteArgs = mockCreate.mock.calls[1][0];
    expect(rewriteArgs.tools).toBeUndefined();
    expect(rewriteArgs.tool_choice).toBeUndefined();
    expect(rewriteArgs.stream).toBe(false);
    expect(rewriteArgs.input.map((item) => item.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const system = rewriteArgs.input[0].content;
    expect(system.startsWith('SYS\n\n## Search results')).toBe(true);
    expect(system).toContain(`[1] T1\nURL: ${LIVE_A}\nS1`);
    expect(system).toContain(`[3] T3\nURL: ${LIVE_B}\nS3`);
    expect(system).not.toContain(DEAD);

    const metadata = streamer.__citation_metadata;
    expect(streamer._appended).toEqual([`Could not confirm; see [[1]](${LIVE_A}) and [[3]](${LIVE_B}).`]);
    expect(metadata.grounding).toBe('regenerated_dead_sources');
    expect(metadata.cited_markers).toEqual([1, 3]);
    expect(metadata.link_check.regenerated).toBe(true);
  });

  it('rewrites when the answer cites a denylisted source', async () => {
    mockFetchDead();
    mockCreate
      .mockResolvedValueOnce(makeStream([{ text: 'Old mission [2].', searchResults: results([LIVE_A, RETIRED]) }]))
      .mockResolvedValueOnce(completed('Current [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([`Current [[1]](${LIVE_A}).`]);
  });

  // Review Focus 3: one dead URL returned under two ids.
  it('treats citing either id of a duplicated dead URL as citing a removed source', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(
        makeStream([
          {
            text: 'Claim [3].',
            searchResults: [
              { id: 1, url: LIVE_A },
              { id: 2, url: DEAD },
              { id: 3, url: DEAD },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(completed('Live claim [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const index = streamer.__citation_metadata.citation_index;
    expect(index['2']).toBeUndefined();
    expect(index['3']).toBeUndefined();
  });

  // Review Focus 5: the rewrite still cites the dead source's id.
  it('leaves a marker for a removed id as plain text in the rewrite', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(makeStream([{ text: 'Yes [2].', searchResults: results([LIVE_A, DEAD]) }]))
      .mockResolvedValueOnce(completed('Live [1], stale [2].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer._appended).toEqual([`Live [[1]](${LIVE_A}), stale [2].`]);
    expect(Object.values(streamer.__citation_metadata.citation_index)).not.toContain(DEAD);
    expect(streamer.__citation_metadata.cited_markers).toEqual([1]);
  });

  it('rewrites when a model-written source list links a dead URL', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(
        makeStream([
          {
            text: `Claim [1].\n\nSources:\n[1] Gone ${DEAD}`,
            searchResults: results([LIVE_A, DEAD]),
          },
        ]),
      )
      .mockResolvedValueOnce(completed('Live [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(streamer._appended).toEqual([`Live [[1]](${LIVE_A}).`]);
  });

  it('applies the same rules to an incomplete run', async () => {
    mockFetchDead(DEAD);
    mockCreate
      .mockResolvedValueOnce(
        makeStream([{ text: 'Partial [2]', searchResults: results([LIVE_A, DEAD]) }], { terminal: 'response.incomplete' }),
      )
      .mockResolvedValueOnce(completed('Live [1].'));
    const streamer = makeStreamer(makeMetadata());
    await callPerplexityChat(streamer, USER);
    expect(streamer.__citation_metadata.grounding).toBe('regenerated_dead_sources');
  });

  it.each([
    ['an API error', () => mockCreate.mockRejectedValueOnce(new Error('boom'))],
    ['a failed status', () => mockCreate.mockResolvedValueOnce({ status: 'failed', error: { message: 'x' } })],
    ['a cancelled status', () => mockCreate.mockResolvedValueOnce({ status: 'cancelled' })],
    ['empty text', () => mockCreate.mockResolvedValueOnce(completed('   '))],
  ])('declines with declined_dead_sources when the rewrite fails with %s', async (_label, arrangeFailure) => {
    mockFetchDead(DEAD);
    mockCreate.mockResolvedValueOnce(makeStream([{ text: 'Yes [2].', searchResults: results([LIVE_A, DEAD]) }]));
    arrangeFailure();
    const streamer = makeStreamer(makeMetadata());
    const { botText } = await callPerplexityChat(streamer, USER);

    const metadata = streamer.__citation_metadata;
    expect(botText).toBe(NO_SOURCES_DECLINE_TEXT);
    expect(streamer._appended).toEqual([NO_SOURCES_DECLINE_TEXT]);
    expect(metadata.grounding).toBe('declined_dead_sources');
    // No Sources block under a decline: createSourcesBlocks renders from citation_index.
    expect(metadata.citation_index).toEqual({});
    expect(metadata.cited_markers).toEqual([]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

describe('buildRegenerateInput', () => {
  it('adds a system item when the prompts have none', () => {
    const input = buildRegenerateInput([{ role: 'user', content: 'q' }], [{ url: LIVE_A, title: 'A' }], {
      [LIVE_A]: 4,
    });
    expect(input[0]).toEqual(expect.objectContaining({ role: 'system' }));
    expect(input[0].content).toContain(`[4] A\nURL: ${LIVE_A}\n(no snippet)`);
  });

  it('leaves out a source with no result id, since nothing could link to it', () => {
    const input = buildRegenerateInput(USER, [{ url: LIVE_A, title: 'A' }, { url: LIVE_B, title: 'B' }], {
      [LIVE_A]: 1,
    });
    expect(input[0].content).not.toContain(LIVE_B);
  });
});

describe('regenerateFromSources', () => {
  it('passes a model override through, so a live evaluation can force a failure', async () => {
    mockCreate.mockResolvedValueOnce(completed('ok'));
    await regenerateFromSources(USER, [{ url: LIVE_A, title: 'A' }], { [LIVE_A]: 1 }, undefined, { model: 'x/y' });
    expect(mockCreate.mock.calls[0][0].model).toBe('x/y');
  });
});
