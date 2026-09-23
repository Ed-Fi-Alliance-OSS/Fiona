// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest } from '@jest/globals';

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

const { aggregatePerplexityMetadata, callPerplexityChat, callLLM, assertLLMConfigured } = await import(
  '../../src/agent/llm-caller.js'
);

describe('assertLLMConfigured', () => {
  it('does not throw when PERPLEXITY_API_KEY is set at module load', () => {
    expect(() => assertLLMConfigured()).not.toThrow();
  });
});

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
   */
  function makeStream(chunks, { terminal = 'response.completed', finalResults } = {}) {
    const events = [];

    for (const chunk of chunks) {
      if (chunk.text !== undefined) {
        events.push({ type: 'response.output_text.delta', delta: chunk.text });
      }
      if (chunk.searchResults !== undefined) {
        events.push({ type: 'response.reasoning.search_results', results: chunk.searchResults });
      }
    }

    if (terminal) {
      events.push({
        type: terminal,
        response: {
          status: terminal === 'response.completed' ? 'completed' : 'failed',
          ...(finalResults !== undefined ? { output: [{ type: 'search_results', results: finalResults }] } : {}),
          ...(terminal === 'response.failed' ? { error: { message: 'upstream refused' } } : {}),
          ...(terminal === 'response.incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
        },
      });
    }

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
    expect(emittedText).toBe(
      'See [[1]](https://first.example.com) and [[2]](https://second.example.com) for details.',
    );
  });

  it('emits the buffered text as-is when no citations are returned', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(makeStream([{ text: 'No citations here.' }, { text: ' Done.' }]));

    await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(streamer.append).toHaveBeenCalledTimes(1);
    expect(streamer._appended[0]).toBe('No citations here. Done.');
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
    mockCreate.mockResolvedValue(
      makeStream([{ searchResults: urlsToResults(['https://only-citation.example.com']) }]),
    );

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

    expect(citations).toEqual([]);
    expect(botText).toBe('Answer [1].');
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

  it('throws when the run terminates with response.failed over a 200 response', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);

    mockCreate.mockResolvedValue(makeStream([{ text: 'partial' }], { terminal: 'response.failed' }));

    await expect(callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }])).rejects.toThrow(
      /response\.failed: upstream refused/,
    );
  });

  it('keeps the partial answer and warns when the run terminates as incomplete', async () => {
    const metadata = makeMetadata();
    const streamer = makeStreamer(metadata);
    const logger = { warn: jest.fn() };

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'Truncated answer' }], { terminal: 'response.incomplete' }),
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

    mockCreate.mockResolvedValue(
      makeStream([{ text: 'First [2]. Later [12]. Last [14].' }], { finalResults }),
    );

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
        finalResults: [
          { id: 3, url: 'https://docs.ed-fi.org/known' },
          { url: 'https://docs.ed-fi.org/unknown' },
        ],
      }),
    );

    const { botText } = await callPerplexityChat(streamer, [{ role: 'user', content: 'hello' }]);

    expect(botText).toBe('Unknown [1]. Known [[3]](https://docs.ed-fi.org/known).');
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

      expect(Object.keys(metadata.citation_index).map(Number)).toEqual(
        Array.from({ length: 15 }, (_, i) => i + 1),
      );
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
        yield { type: 'response.completed', response: { status: 'completed' } };
      })(),
    );

    const result = await callLLM(fakeStreamer, [{ role: 'user', content: 'hi' }], { error: jest.fn(), warn: jest.fn(), info: jest.fn() });

    expect(result).toHaveProperty('metadata');
    expect(result).toHaveProperty('botText', 'Hello world');
    expect(result).toHaveProperty('systemPromptVersion', 'v1');
  });
});
