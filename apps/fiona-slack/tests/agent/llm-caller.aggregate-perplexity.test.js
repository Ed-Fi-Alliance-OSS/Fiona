// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/agent/utils/citation-telemetry.js', () => ({
  recordMetadataWaitDuration: jest.fn(),
  recordSourceCount: jest.fn(),
  incrementDegradedNoMetadataCount: jest.fn(),
  incrementTotalResponseCount: jest.fn(),
}));

// Capture the create mock so tests can set their own resolved value.
const mockCreate = jest.fn();

jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: { create: mockCreate },
    search: { create: jest.fn() },
  })),
}));

// Set the env var BEFORE the dynamic import so the module-level initializer
// picks it up and assigns `perplexityClient`.
process.env.PERPLEXITY_API_KEY = 'test-key';

const { aggregatePerplexityMetadata, callPerplexityChat, callLLM, assertLLMConfigured, NO_SOURCES_DECLINE_TEXT } =
  await import('../../src/agent/llm-caller.js');
const { incrementDegradedNoMetadataCount } = await import('../../src/agent/utils/citation-telemetry.js');

describe('assertLLMConfigured', () => {
  it('does not throw when PERPLEXITY_API_KEY is set at module load', () => {
    expect(() => assertLLMConfigured()).not.toThrow();
  });
});

function toAsyncIterable(events) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= events.length) return { done: true, value: undefined };
          return { done: false, value: events[i++] };
        },
      };
    },
  };
}

function makeMetadata() {
  return {
    sources: [],
    source_index_map: Object.create(null),
    search_results: [],
    finalize_state: 'streaming_text',
  };
}

describe('aggregatePerplexityMetadata', () => {
  it('adds all results from the search_results output item as sources', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'answer' }] },
        {
          type: 'search_results',
          results: [
            { url: 'https://a.example.com', title: 'A' },
            { url: 'https://b.example.com', title: 'B' },
          ],
        },
      ],
    });

    const urls = metadata.sources.map((s) => s.url);
    expect(urls).toContain('https://a.example.com');
    expect(urls).toContain('https://b.example.com');
  });

  it('maps inline markers to the Agent API result id, not the post-dedup position', () => {
    // Measured against production the ids are contiguous 1..N, so id equals
    // position on the happy path. Dedup is what breaks that: dropping the
    // repeat of id 1 shifts id 3 into position 2, and positional numbering
    // would then link the model's [3] to the id-2 URL.
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      search_results: [
        { id: 1, url: 'https://a.example.com', title: 'A' },
        { id: 2, url: 'https://a.example.com', title: 'A again' },
        { id: 3, url: 'https://c.example.com', title: 'C' },
      ],
    });

    expect(metadata.source_index_map['https://a.example.com']).toBe(1);
    expect(metadata.source_index_map['https://c.example.com']).toBe(3);
  });

  it('prefers the title supplied by the Agent API over one derived from the URL', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      search_results: [{ url: 'https://docs.ed-fi.org/reference/data-exchange', title: 'Data Exchange' }],
    });

    expect(metadata.sources[0].title).toBe('Data Exchange');
  });

  it('produces no sources when the search_results item is empty', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, { output: [{ type: 'search_results', results: [] }] });

    expect(metadata.sources).toHaveLength(0);
  });

  it('produces no sources when the response carries no search_results item', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ungrounded' }] }],
    });

    expect(metadata.sources).toHaveLength(0);
  });

  it('ignores results without a URL', () => {
    const metadata = makeMetadata();
    aggregatePerplexityMetadata(metadata, {
      search_results: [{ title: 'No URL here' }, { url: 'https://ok.example.com' }],
    });

    expect(metadata.sources.map((s) => s.url)).toEqual(['https://ok.example.com']);
  });

  it('is a no-op when perplexityResponse is null', () => {
    const metadata = makeMetadata();
    expect(() => aggregatePerplexityMetadata(metadata, null)).not.toThrow();
    expect(metadata.sources).toHaveLength(0);
  });
});

describe('callPerplexityChat – buffer and linkify', () => {
  /**
   * Build a fake async-iterable Agent API event stream.
   * Each element may have { text, searchResults }, producing the typed SSE
   * events the Agent API emits (`response.output_text.delta` and
   * `response.reasoning.search_results`), followed by `response.completed`.
   * Pass `terminalEvent` to end the stream with that exact event instead.
   */
  function makeStream(chunks, { terminal = 'response.completed', finalResults, terminalEvent } = {}) {
    const events = [];

    for (const chunk of chunks) {
      if (chunk.text !== undefined) {
        events.push({ type: 'response.output_text.delta', delta: chunk.text });
      }
      if (chunk.searchResults !== undefined) {
        events.push({ type: 'response.reasoning.search_results', results: chunk.searchResults });
      }
    }

    if (terminalEvent) {
      events.push(terminalEvent);
    } else if (terminal) {
      events.push({
        type: terminal,
        response: {
          status: terminal === 'response.completed' ? 'completed' : 'incomplete',
          ...(finalResults !== undefined ? { output: [{ type: 'search_results', results: finalResults }] } : {}),
          ...(terminal === 'response.incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
        },
      });
    }

    return toAsyncIterable(events);
  }

  const urlsToResults = (urls) => urls.map((url) => ({ url }));

  function makeStreamer(metadata) {
    const appended = [];
    return {
      __citation_metadata: metadata,
      append: jest.fn(async ({ markdown_text }) => {
        appended.push(markdown_text);
      }),
      _appended: appended,
    };
  }

  it('buffers all text chunks and emits a single linkified append after citations arrive', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    // Simulate: text in two deltas, search results arriving after them.
    mockCreate.mockResolvedValue(
      makeStream([
        { text: 'See [1] and ' },
        {
          text: '[2] for details.',
          searchResults: urlsToResults(['https://first.example.com', 'https://second.example.com']),
        },
      ]),
    );

    await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    // Should emit exactly one append call containing fully linkified text.
    expect(streamer.append).toHaveBeenCalledTimes(1);
    const emittedText = streamer._appended[0];
    expect(emittedText).toBe('See [[1]](https://first.example.com) and [[2]](https://second.example.com) for details.');
  });

  it('emits the buffered text as-is when results arrive but the answer cites none', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(
      makeStream([
        { text: 'No citations here.' },
        { text: ' Done.', searchResults: urlsToResults(['https://a.example.com']) },
      ]),
    );

    await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(streamer.append).toHaveBeenCalledTimes(1);
    expect(streamer._appended[0]).toBe('No citations here. Done.');
    expect(metadata.grounding).toBeUndefined();
  });

  describe('when search returns no results', () => {
    // Search is forced, so an answer with no results means retrieval failed
    // and anything the model wrote came from background knowledge (Q-005).
    it('sends the decline instead of the model answer', async () => {
      const streamer = makeStreamer(makeMetadata());
      mockCreate.mockResolvedValue(makeStream([{ text: 'South Carolina, Texas and Colorado implement Ed-Fi.' }]));

      const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'Which states?' }]);

      expect(streamer._appended).toEqual([NO_SOURCES_DECLINE_TEXT]);
      expect(botText).toBe(NO_SOURCES_DECLINE_TEXT);
      expect(NO_SOURCES_DECLINE_TEXT).toMatch(/could(?: not|n't) find/i);
    });

    it('records the decline in metadata so telemetry need not match on text', async () => {
      const metadata = makeMetadata();
      mockCreate.mockResolvedValue(makeStream([{ text: 'Unsourced claim.' }]));

      await callPerplexityChat(makeStreamer(metadata), [{ role: 'user', content: 'hello' }]);

      expect(metadata.grounding).toBe('declined_no_results');
      expect(metadata.citation_index).toEqual({});
      expect(metadata.cited_markers).toEqual([]);
    });

    it('declines even when the model produced no text', async () => {
      const streamer = makeStreamer(makeMetadata());
      mockCreate.mockResolvedValue(makeStream([]));

      await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(streamer._appended).toEqual([NO_SOURCES_DECLINE_TEXT]);
    });

    it('declines when an incomplete run returned no results', async () => {
      const streamer = makeStreamer(makeMetadata());
      mockCreate.mockResolvedValue(makeStream([{ text: 'Partial unsourced' }], { terminal: 'response.incomplete' }));

      await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }], { warn: jest.fn() });

      expect(streamer._appended).toEqual([NO_SOURCES_DECLINE_TEXT]);
    });
  });

  it('returns the collected citation URLs', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Result [1].', searchResults: urlsToResults(['https://result.example.com']) }]),
    );

    const { citations } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(citations).toEqual(['https://result.example.com']);
  });

  it('does not call streamer.append when there is no text', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    // Only a search-results event, no text delta.
    mockCreate.mockResolvedValue(makeStream([{ searchResults: urlsToResults(['https://only-citation.example.com']) }]));

    await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(streamer.append).not.toHaveBeenCalled();
  });

  it('defaults to the perplexity/sonar model slug when PERPLEXITY_API_MODEL is unset', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(makeStream([{ text: 'Hello from default model.' }]));

    await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'perplexity/sonar',
      }),
    );
  });

  it('sends Agent API request fields and never leftover Sonar params', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(makeStream([{ text: 'hi' }]));

    await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    const body = mockCreate.mock.calls[0][0];

    // Agent API shape: `input` items, domain filter nested under the tool.
    expect(body.input).toEqual([{ type: 'message', role: 'user', content: 'hello' }]);
    expect(body.tools).toEqual([
      { type: 'web_search', filters: { search_domain_filter: ['www.ed-fi.org', 'docs.ed-fi.org'] } },
    ]);
    // Grounding is citation-critical for Fiona, so the search is forced.
    expect(body.tool_choice).toEqual({ type: 'web_search' });
    expect(body.stream).toBe(true);

    // The Agent API rejects unknown fields with a 400, so no Sonar leftovers.
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('search_domain_filter');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('prefers the search_results output item from the terminal snapshot', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Answer [1].', searchResults: urlsToResults(['https://stale.example.com']) }], {
        finalResults: urlsToResults(['https://authoritative.example.com']),
      }),
    );

    const { citations } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(citations).toEqual(['https://authoritative.example.com']);
  });

  it.each([[], null])('does not link stale results when the terminal snapshot contains %p', async (finalResults) => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Answer [1].', searchResults: urlsToResults(['https://stale.example.com']) }], {
        finalResults,
      }),
    );

    const { botText, citations } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    // The snapshot is authoritative, so the answer has no sources and is
    // declined rather than shown with a marker linking a stale URL.
    expect(citations).toEqual([]);
    expect(botText).toBe(NO_SOURCES_DECLINE_TEXT);
    expect(metadata.sources).toEqual([]);
  });

  it('uses streamed results when the terminal snapshot has no search_results item', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);
    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Answer [1].', searchResults: urlsToResults(['https://streamed.example.com']) }]),
    );

    const { botText, citations } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(citations).toEqual(['https://streamed.example.com']);
    expect(botText).toBe('Answer [[1]](https://streamed.example.com).');
  });

  // Failed and cancelled runs arrive over a successful HTTP 200. The SDK's
  // `ResponseFailedEvent` carries a top-level `error` and no `response`.
  it.each([
    ['response.failed', { type: 'response.failed', sequence_number: 3, error: { message: 'upstream refused' } }, 'upstream refused'],
    ['response.cancelled', { type: 'response.cancelled', response: { status: 'cancelled', error: { message: 'run cancelled' } } }, 'run cancelled'],
    ['bare error', { type: 'error', error: { message: 'stream broke' } }, 'stream broke'],
    ['detail-less response.failed', { type: 'response.failed', sequence_number: 3 }, 'no error detail'],
  ])('throws on a %s terminal event without appending the partial answer', async (_label, terminalEvent, expectedDetail) => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(makeStream([{ text: 'partial' }], { terminalEvent }));

    await expect(callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }])).rejects.toThrow(
      `Perplexity run ended with ${terminalEvent.type}: ${expectedDetail}`,
    );
    expect(streamer.append).not.toHaveBeenCalled();
  });

  it('keeps the partial answer and warns when the run terminates as incomplete', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);
    const logger = { warn: jest.fn() };

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Truncated answer', searchResults: urlsToResults(['https://a.example.com']) }], {
        terminal: 'response.incomplete',
      }),
    );

    const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }], logger);

    expect(botText).toBe('Truncated answer');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('max_output_tokens'));
  });

  it('still takes sources from the terminal snapshot when the run is incomplete', async () => {
    // The terminal snapshot's results take precedence over the streamed
    // `response.reasoning.search_results` events. An incomplete run keeps its
    // partial answer, and those [n] markers can only linkify if the terminal
    // snapshot is read here too, exactly as it is for a completed run.
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);
    const logger = { warn: jest.fn() };

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Truncated [1].', searchResults: urlsToResults(['https://stale.example.com']) }], {
        terminal: 'response.incomplete',
        finalResults: urlsToResults(['https://authoritative.example.com']),
      }),
    );

    const { botText, citations } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }], logger);

    expect(citations).toEqual(['https://authoritative.example.com']);
    expect(botText).toBe('Truncated [[1]](https://authoritative.example.com).');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('max_output_tokens'));
  });

  it('linkifies markers whose result id falls beyond the display cap', async () => {
    // A multi-round search can return more than 10 results, and the model
    // cites them by their Agent API id. The former 10-source cap ran before
    // source_index_map was built and left [12] and [14] as bare text in
    // production.
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);
    const finalResults = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      url: `https://docs.ed-fi.org/page-${i + 1}`,
    }));

    mockCreate.mockResolvedValue(makeStream([{ text: 'First [2]. Later [12]. Last [14].' }], { finalResults }));

    const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(botText).toBe(
      'First [[2]](https://docs.ed-fi.org/page-2). ' +
        'Later [[12]](https://docs.ed-fi.org/page-12). ' +
        'Last [[14]](https://docs.ed-fi.org/page-14).',
    );
  });

  it('links a marker citing a duplicate result id to the same URL as the first', async () => {
    // Dedup keeps one source per URL, so id 2 (a repeat of id 1's URL) has no
    // entry in source_index_map. The marker must still link, to that URL.
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'A [1]. Again [2]. C [3].' }], {
        finalResults: [
          { id: 1, url: 'https://docs.ed-fi.org/a' },
          { id: 2, url: 'https://docs.ed-fi.org/a' },
          { id: 3, url: 'https://docs.ed-fi.org/c' },
        ],
      }),
    );

    const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(botText).toBe(
      'A [[1]](https://docs.ed-fi.org/a). Again [[2]](https://docs.ed-fi.org/a). C [[3]](https://docs.ed-fi.org/c).',
    );
    // The source list itself stays deduplicated.
    expect(metadata.sources.map((s) => s.url)).toEqual(['https://docs.ed-fi.org/a', 'https://docs.ed-fi.org/c']);
  });

  it('leaves ambiguous ids unlinked rather than using positional numbering', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'A [1]. B [2]. C [3].' }], {
        finalResults: [
          { id: 1, url: 'https://docs.ed-fi.org/a' },
          { id: 1, url: 'https://docs.ed-fi.org/b' },
          { id: 2, url: 'https://docs.ed-fi.org/c' },
        ],
      }),
    );

    const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(botText).toBe('A [1]. B [[2]](https://docs.ed-fi.org/c). C [3].');
  });

  it('does not link a missing id by its array position when another result has an API id', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Unknown [1]. Known [3].' }], {
        finalResults: [{ id: 3, url: 'https://docs.ed-fi.org/known' }, { url: 'https://docs.ed-fi.org/unknown' }],
      }),
    );

    const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(botText).toBe('Unknown [1]. Known [[3]](https://docs.ed-fi.org/known).');
  });

  describe('when the model writes its own numbered source list', () => {
    // Measured live: when the model appends its own list it numbers its
    // sources 1, 2, 3... itself instead of citing Agent API result ids, so
    // linking [n] to result id n pointed at the wrong page (0 of 4 correct in
    // one run). Its list is then the only record of what each number means.
    const results = [
      { id: 1, url: 'https://docs.ed-fi.org/one/', title: 'One', published_date: '2026-01-01' },
      { id: 2, url: 'https://docs.ed-fi.org/two/', title: 'Two' },
      { id: 3, url: 'https://docs.ed-fi.org/three/', title: 'Three' },
      { id: 4, url: 'https://docs.ed-fi.org/four/', title: 'Four' },
    ];

    async function run(text) {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);
      mockCreate.mockResolvedValue(makeStream([{ text }], { finalResults: results }));
      const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);
      return { botText, metadata };
    }

    it("links each marker to the URL the model's list gives it, not to result id n", async () => {
      const { botText } = await run(
        'Claim [1]. Other [2].\n\nSources\n[1] Four: [docs.ed-fi.org/four](https://docs.ed-fi.org/four/)\n[2] [Two](https://docs.ed-fi.org/two/)',
      );

      expect(botText).toBe('Claim [[1]](https://docs.ed-fi.org/four/). Other [[2]](https://docs.ed-fi.org/two/).');
    });

    it('removes the model list, with or without a heading, so only the Sources block lists sources', async () => {
      const withHeading = await run('A [1].\n\n**Sources:**\n- [1] [Four](https://docs.ed-fi.org/four/)');
      const bare = await run('A [1].\n\n[1] https://docs.ed-fi.org/four/');

      expect(withHeading.botText).toBe('A [[1]](https://docs.ed-fi.org/four/).');
      expect(bare.botText).toBe('A [[1]](https://docs.ed-fi.org/four/).');
    });

    it("numbers the Sources block by the model's numbers, and the uncited results after them", async () => {
      const { metadata } = await run(
        'A [1]. B [2].\n\n[1] [Four](https://docs.ed-fi.org/four/)\n[2] [Two](https://docs.ed-fi.org/two/)',
      );

      expect(metadata.citation_index).toEqual({
        1: 'https://docs.ed-fi.org/four/',
        2: 'https://docs.ed-fi.org/two/',
        3: 'https://docs.ed-fi.org/one/',
        4: 'https://docs.ed-fi.org/three/',
      });
      expect(metadata.cited_markers).toEqual([1, 2]);
    });

    it('matches list URLs to results ignoring scheme, www and a trailing slash', async () => {
      const { botText } = await run('A [1].\n\n[1] [Four](http://www.docs.ed-fi.org/four)');

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/four/).');
    });

    it('leaves a marker unlinked when its list URL is not among the search results', async () => {
      const { botText, metadata } = await run(
        'A [1]. B [2].\n\nSources\n[1] [Four](https://docs.ed-fi.org/four/)\n[2] [Elsewhere](https://example.com/made-up)',
      );

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/four/). B [2].');
      expect(Object.values(metadata.citation_index)).not.toContain('https://example.com/made-up');
      expect(metadata.cited_markers).toEqual([1]);
    });

    it('keeps result-id linking when the answer has no trailing list', async () => {
      const { botText } = await run('A [4]. B [2].');

      expect(botText).toBe('A [[4]](https://docs.ed-fi.org/four/). B [[2]](https://docs.ed-fi.org/two/).');
    });

    it('keeps a trailing numbered list of steps with links that the answer never cites', async () => {
      const text = 'Setup steps:\n[1] Open https://docs.ed-fi.org/one/\n[2] Check https://docs.ed-fi.org/two/';

      const { botText } = await run(text);

      expect(botText).toBe(
        'Setup steps:\n[[1]](https://docs.ed-fi.org/one/) Open https://docs.ed-fi.org/one/\n[[2]](https://docs.ed-fi.org/two/) Check https://docs.ed-fi.org/two/',
      );
    });

    it('keeps a trailing list of steps even when the answer cites one of its numbers', async () => {
      // Only [1] is cited earlier, so this is not evidence of a bibliography.
      const text =
        'Follow the cited guidance [1] to complete these steps:\n[1] Open https://docs.ed-fi.org/one/\n[2] Check https://docs.ed-fi.org/two/';

      const { botText } = await run(text);

      expect(botText).toBe(
        'Follow the cited guidance [[1]](https://docs.ed-fi.org/one/) to complete these steps:\n[[1]](https://docs.ed-fi.org/one/) Open https://docs.ed-fi.org/one/\n[[2]](https://docs.ed-fi.org/two/) Check https://docs.ed-fi.org/two/',
      );
    });

    it('keeps an unheaded trailing list whose links are not search results', async () => {
      const { botText } = await run('See [1].\n\n[1] Read https://example.com/elsewhere');

      expect(botText).toBe(
        'See [[1]](https://docs.ed-fi.org/one/).\n\n[[1]](https://docs.ed-fi.org/one/) Read https://example.com/elsewhere',
      );
    });

    it('treats a headed list as the model list even when the answer cites none of it', async () => {
      const { botText } = await run('Some answer.\n\nSources\n[1] [Four](https://docs.ed-fi.org/four/)');

      expect(botText).toBe('Some answer.');
    });

    it('links a listed URL to the result with the same path case, not one differing only in case', async () => {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);
      mockCreate.mockResolvedValue(
        makeStream([{ text: 'A [1].\n\n[1] [Upper](https://docs.ed-fi.org/Case)' }], {
          finalResults: [
            { id: 1, url: 'https://docs.ed-fi.org/Case' },
            { id: 2, url: 'https://docs.ed-fi.org/case' },
          ],
        }),
      );

      const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/Case).');
    });

    it('leaves a marker unlinked when its URL loosely matches more than one result', async () => {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);
      mockCreate.mockResolvedValue(
        makeStream([{ text: 'A [1].\n\nSources\n[1] [X](http://docs.ed-fi.org/x)' }], {
          finalResults: [
            { id: 1, url: 'https://docs.ed-fi.org/x/' },
            { id: 2, url: 'https://www.docs.ed-fi.org/x' },
          ],
        }),
      );

      const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(botText).toBe('A [1].');
    });

    it('never emits Slack control syntax from a result URL in the inline link', async () => {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);
      mockCreate.mockResolvedValue(
        makeStream([{ text: 'A [1].' }], { finalResults: [{ id: 1, url: 'https://docs.ed-fi.org/a><!here>' }] }),
      );

      const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/a%3E%3C!here%3E).');
      expect(botText).not.toContain('<!here>');
    });

    it('does not treat bracketed lines without URLs as a source list', async () => {
      const { botText } = await run('Steps:\n[1] Install the tools.\n[2] Run the setup [3].');

      expect(botText).toBe(
        'Steps:\n[[1]](https://docs.ed-fi.org/one/) Install the tools.\n[[2]](https://docs.ed-fi.org/two/) Run the setup [[3]](https://docs.ed-fi.org/three/).',
      );
    });
  });

  describe('citation_index (marker number -> URL, for the Sources block)', () => {
    it('records every result id when a search returns 15 results', async () => {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);
      const finalResults = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        url: `https://docs.ed-fi.org/page-${i + 1}`,
      }));

      mockCreate.mockResolvedValue(makeStream([{ text: 'Late [14].' }], { finalResults }));

      await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(Object.keys(metadata.citation_index).map(Number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(metadata.citation_index[14]).toBe('https://docs.ed-fi.org/page-14');
    });

    it('aliases a duplicate result id to the URL it shares', async () => {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);

      mockCreate.mockResolvedValue(
        makeStream([{ text: 'A [1]. Again [2].' }], {
          finalResults: [
            { id: 1, url: 'https://docs.ed-fi.org/a' },
            { id: 2, url: 'https://docs.ed-fi.org/a' },
            { id: 3, url: 'https://docs.ed-fi.org/c' },
          ],
        }),
      );

      await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(metadata.citation_index).toEqual({
        1: 'https://docs.ed-fi.org/a',
        2: 'https://docs.ed-fi.org/a',
        3: 'https://docs.ed-fi.org/c',
      });
    });

    it('records which resolvable markers the answer actually cites', async () => {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);
      const finalResults = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        url: `https://docs.ed-fi.org/page-${i + 1}`,
      }));

      // [12] twice, and an invented [16] that has no result.
      mockCreate.mockResolvedValue(
        makeStream([{ text: 'A [12]. B [3]. Again [12]. Invented [16].' }], { finalResults }),
      );

      await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(metadata.cited_markers).toEqual([3, 12]);
    });

    it('omits ambiguous ids, matching what the inline markers link', async () => {
      const metadata = makeMetadata();
      const streamer = makeStreamer(metadata);

      mockCreate.mockResolvedValue(
        makeStream([{ text: 'A [1]. B [2].' }], {
          finalResults: [
            { id: 1, url: 'https://docs.ed-fi.org/a' },
            { id: 1, url: 'https://docs.ed-fi.org/b' },
            { id: 2, url: 'https://docs.ed-fi.org/c' },
          ],
        }),
      );

      await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

      expect(metadata.citation_index).toEqual({ 2: 'https://docs.ed-fi.org/c' });
    });
  });

  it('ignores unrecognized event types', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]() {
        const events = [
          { type: 'response.created' },
          { type: 'response.unknown' },
          { type: 'response.output_text.delta', delta: 'ok' },
          { type: 'response.reasoning.search_results', results: [{ url: 'https://a.example.com' }] },
          { type: 'response.completed', response: { status: 'completed' } },
        ];
        let i = 0;
        return {
          async next() {
            if (i >= events.length) return { done: true, value: undefined };
            return { done: false, value: events[i++] };
          },
        };
      },
    });

    const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(botText).toBe('ok');
  });
});

describe('callLLM error path does not mask original failure', () => {
  function makeLogger() {
    return { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  }

  function makeStreamer() {
    return { append: jest.fn().mockResolvedValue(undefined) };
  }

  it('marks the envelope degraded and counts it once when the stream ends with response.failed', async () => {
    // HTTP-200 failures surface as a throw from inside the stream loop, so this
    // is the primary failure path — no envelope pre-seeding.
    incrementDegradedNoMetadataCount.mockClear();
    mockCreate.mockResolvedValue(
      toAsyncIterable([
        { type: 'response.output_text.delta', delta: 'partial' },
        { type: 'response.failed', sequence_number: 2, error: { message: 'upstream refused' } },
      ]),
    );

    const streamer = makeStreamer();

    await expect(callLLM(streamer, [{ role: 'user', content: 'hi' }], makeLogger())).rejects.toThrow(
      'Perplexity run ended with response.failed: upstream refused',
    );
    expect(streamer.__citation_metadata.finalize_state).toBe('degraded_no_metadata');
    expect(incrementDegradedNoMetadataCount).toHaveBeenCalledTimes(1);
    expect(streamer.append).not.toHaveBeenCalled();
  });

  it('rethrows the original LLM error when metadata is already DEGRADED_NO_METADATA', async () => {
    const llmError = new Error('upstream LLM exploded');
    // The create call throws to simulate a streaming failure mid-flight. Then
    // we manually drop the envelope into DEGRADED_NO_METADATA before the throw
    // bubbles up.
    mockCreate.mockImplementation(async () => {
      throw llmError;
    });

    const streamer = makeStreamer();
    // Pre-seed: simulate handleMetadataTimeout having already fired.
    streamer.__citation_metadata = null; // callLLM will overwrite with a fresh envelope

    // Wrap callLLM so we can intercept the envelope and force DEGRADED_NO_METADATA
    // before the catch block runs.  We use a Proxy on the streamer to flip the
    // state the moment callLLM attaches the envelope.
    const captured = {};
    const intercepting = new Proxy(streamer, {
      set(target, prop, value) {
        target[prop] = value;
        if (prop === '__citation_metadata' && value) {
          // Drop into DEGRADED_NO_METADATA via the public state machine.
          value.finalize_state = 'degraded_no_metadata';
          captured.envelope = value;
        }
        return true;
      },
    });

    await expect(callLLM(intercepting, [{ role: 'user', content: 'hi' }], makeLogger())).rejects.toBe(llmError);
    expect(captured.envelope.finalize_state).toBe('degraded_no_metadata');
  });

  it('rethrows the original LLM error when metadata is already READY_TO_FINALIZE', async () => {
    const llmError = new Error('LLM stream aborted');
    mockCreate.mockImplementation(async () => {
      throw llmError;
    });

    const streamer = makeStreamer();
    const captured = {};
    const intercepting = new Proxy(streamer, {
      set(target, prop, value) {
        target[prop] = value;
        if (prop === '__citation_metadata' && value) {
          value.finalize_state = 'ready_to_finalize';
          captured.envelope = value;
        }
        return true;
      },
    });

    await expect(callLLM(intercepting, [{ role: 'user', content: 'hi' }], makeLogger())).rejects.toBe(llmError);
    expect(captured.envelope.finalize_state).toBe('ready_to_finalize');
  });
});

describe('callLLM returns botText alongside metadata', () => {
  it('returns botText alongside the metadata envelope', async () => {
    const fakeStreamer = { append: jest.fn().mockResolvedValue(undefined), stop: jest.fn() };
    mockCreate.mockResolvedValueOnce(
      (async function* () {
        yield { type: 'response.output_text.delta', delta: 'Hello world' };
        yield { type: 'response.reasoning.search_results', results: [{ url: 'https://a.example.com' }] };
        yield { type: 'response.completed', response: { status: 'completed' } };
      })(),
    );

    const result = await callLLM(fakeStreamer, [{ role: 'user', content: 'hi' }], {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    });

    expect(result).toHaveProperty('metadata');
    expect(result).toHaveProperty('botText', 'Hello world');
    expect(result).toHaveProperty('systemPromptVersion', 'v3');
  });

  it('instructs the model to cite result numbers and not to write its own source list', async () => {
    // Measured: without this the model sometimes renumbers its sources and
    // appends its own list, which mislinked markers and duplicated the list.
    const fakeStreamer = { append: jest.fn().mockResolvedValue(undefined), stop: jest.fn() };
    mockCreate.mockResolvedValueOnce(
      (async function* () {
        yield { type: 'response.completed', response: { status: 'completed' } };
      })(),
    );

    await callLLM(fakeStreamer, [{ role: 'user', content: 'hi' }], {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    });

    const system = mockCreate.mock.calls.at(-1)[0].input.find((item) => item.role === 'system').content;
    expect(system).toMatch(/never renumber/i);
    expect(system).toMatch(/do not (?:end|finish) your answer with a list of sources/i);
    expect(system).not.toMatch(/numeric markers \[1\], \[2\], etc\./);
  });
  it('instructs the model to ground every claim and decline on high-risk topics without a source', async () => {
    // Q-005: the model named implementing states from background knowledge.
    const fakeStreamer = { append: jest.fn().mockResolvedValue(undefined), stop: jest.fn() };
    mockCreate.mockResolvedValueOnce(
      (async function* () {
        yield { type: 'response.completed', response: { status: 'completed' } };
      })(),
    );

    await callLLM(fakeStreamer, [{ role: 'user', content: 'hi' }], {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    });

    const system = mockCreate.mock.calls.at(-1)[0].input.find((item) => item.role === 'system').content;
    expect(system).toMatch(/do not answer from background knowledge/i);
    expect(system).toMatch(/could not find (?:this|that|it) in (?:the )?Ed-Fi documentation/i);
    for (const topic of [/states or agencies/i, /adoption/i, /implementation status/i, /licensing/i, /legal/i]) {
      expect(system).toMatch(topic);
    }
    // Measured: v3 without this called the homepage's case-study states "implemented".
    expect(system).toMatch(/use the source's own label/i);
    expect(system).toMatch(/case stud(?:y|ies) (?:is|are) not (?:a list of )?(?:states )?implementing/i);
    // Measured: two runs of the same commercial-use question gave opposite answers.
    expect(system).toMatch(/licensing or legal question/i);
    expect(system).toMatch(/do not give a (?:definitive )?yes or no/i);
    expect(system).toContain('https://www.ed-fi.org/contact/');
    // Search is forced now, and "general productivity" invited ungrounded answers.
    expect(system).not.toMatch(/offer to search/i);
    expect(system).not.toMatch(/general productivity/i);
  });
});
