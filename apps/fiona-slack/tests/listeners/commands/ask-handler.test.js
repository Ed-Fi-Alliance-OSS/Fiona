// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCallLLM = jest.fn();
// Transitions the state the way the real one does, so a Sources block built
// after finalizing — which would render nothing — fails the tests below.
const mockFinalizeMetadataEnvelope = jest.fn((metadata) => {
  if (metadata && ['ready_to_finalize', 'degraded_no_metadata'].includes(metadata.finalize_state)) {
    metadata.finalize_state = 'finalized';
  }
});
jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => ({
  callLLM: mockCallLLM,
  finalizeMetadataEnvelope: mockFinalizeMetadataEnvelope,
  LLM_MODEL: 'test-model',
  SYSTEM_PROMPT_VERSION: 'v1',
  CITATION_POLICY: { METADATA_WAIT_TIMEOUT_MS: 2000 },
  MetadataLifecycleState: {
    STREAMING_TEXT: 'streaming_text',
    COLLECTING_METADATA: 'collecting_metadata',
    READY_TO_FINALIZE: 'ready_to_finalize',
    FINALIZED: 'finalized',
    DEGRADED_NO_METADATA: 'degraded_no_metadata',
  },
}));

const mockWaitForMetadataReady = jest.fn().mockResolvedValue(undefined);
const mockLogCitationTelemetry = jest.fn();
jest.unstable_mockModule('../../../src/agent/interaction-telemetry.js', () => ({
  waitForMetadataReady: mockWaitForMetadataReady,
  logCitationTelemetry: mockLogCitationTelemetry,
  handleInteractionWithTelemetry: jest.fn(),
}));

const mockCaptureConversation = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../../src/agent/conversation-capture-store.js', () => ({
  captureConversation: mockCaptureConversation,
}));

const {
  ASK_EMPTY_TEXT,
  ASK_ERROR_TEXT,
  ASK_TOO_LONG_TEXT,
  MAX_QUESTION_LENGTH,
  buildAskResponse,
  describeError,
  fitMarkdownBlock,
  streamAskResponse,
} = await import('../../../src/listeners/commands/ask-handler.js');

// Stands in for Perplexity: one append() with the finished text, which is what
// callPerplexityChat actually does once citations have been linkified.
function answersWith(text, metadata = null) {
  return async (sink) => {
    await sink.append({ markdown_text: text });
    return { metadata, botText: text, systemPromptVersion: 'v1' };
  };
}

const ids = {
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '111.000',
  messageTs: '222.000',
};

// Two retrieved sources, both cited, as llm-caller leaves them once ready.
const readyMetadata = () => ({
  finalize_state: 'ready_to_finalize',
  sources: [
    { url: 'https://docs.ed-fi.org/a', title: 'A' },
    { url: 'https://docs.ed-fi.org/b', title: 'B' },
  ],
  citation_index: { 1: 'https://docs.ed-fi.org/a', 2: 'https://docs.ed-fi.org/b' },
});
const SOURCES_TEXT = '*Sources*\n*[1]* <https://docs.ed-fi.org/a|A>\n*[2]* <https://docs.ed-fi.org/b|B>';

let mockLogger;

beforeEach(() => {
  jest.clearAllMocks();
  mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
});

describe('buildAskResponse', () => {
  it('returns the answer text collected from the LLM', async () => {
    mockCallLLM.mockImplementation(answersWith('The Ed-Fi Data Standard is…'));

    const { response, errorType } = await buildAskResponse({
      question: 'What is the Ed-Fi Data Standard?',
      logger: mockLogger,
      interactionType: 'slash_ask',
      ...ids,
    });

    expect(errorType).toBeNull();
    expect(response.text).toBe('The Ed-Fi Data Standard is…');
  });

  it('sends the bare question as the prompt, with no keyword prefix', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    await buildAskResponse({ question: 'how do I set up ODS?', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    const [, prompts] = mockCallLLM.mock.calls[0];
    expect(prompts).toEqual([{ role: 'user', content: 'how do I set up ODS?' }]);
  });

  it('renders the answer as a markdown block followed by a divider and feedback buttons', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    const { response } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'app_mention',
      ...ids,
    });

    expect(response.blocks[0]).toEqual({ type: 'markdown', text: 'answer' });
    expect(response.blocks[1]).toEqual({ type: 'divider' });
    expect(response.blocks[2].block_id).toBe('feedback|ask|app_mention');
  });

  it('suppresses link unfurling so a cited answer does not explode into previews', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(response).toMatchObject({ unfurl_links: false, unfurl_media: false });
  });

  // llm-caller linkifies markers as standard Markdown. Slack's mrkdwn shows
  // that as literal text; the markdown block renders it as a link.
  it('delivers linkified citation markers in a block that renders Markdown links', async () => {
    const answer = 'ODS/API 7 supports this [[1]](https://docs.ed-fi.org/a). **Note:** see [[2]](https://docs.ed-fi.org/b).';
    mockCallLLM.mockImplementation(answersWith(answer));

    const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(response.blocks[0]).toEqual({ type: 'markdown', text: answer });
  });

  it('keeps a long answer with a code block in one block, so the fence is never split', async () => {
    const code = Array.from({ length: 150 }, (_, i) => `  const field${i} = record.get('field${i}');`).join('\n');
    const answer = `Map the fields like this:\n\n\`\`\`js\n${code}\n\`\`\`\n\nThen post the record [1].`;
    expect(answer.length).toBeGreaterThan(3000);
    mockCallLLM.mockImplementation(answersWith(answer));

    const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    const markdownBlocks = response.blocks.filter((b) => b.type === 'markdown');
    expect(markdownBlocks).toEqual([{ type: 'markdown', text: answer }]);
  });

  describe('when the answer exceeds the markdown block limit', () => {
    const lines = (count) => Array.from({ length: count }, (_, i) => `${'z'.repeat(99)}${i % 10}`);

    it('shortens it at a line break to fit, and says so', async () => {
      const answer = lines(130).join('\n');
      mockCallLLM.mockImplementation(answersWith(answer));

      const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

      const [block] = response.blocks.filter((b) => b.type === 'markdown');
      expect(block.text.length).toBeLessThanOrEqual(12000);
      const [kept, notice] = block.text.split('\n\n');
      expect(answer.startsWith(`${kept}\n`)).toBe(true);
      expect(notice).toMatch(/shortened/i);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('shortened'));
    });

    it('closes a code fence the cut leaves open', async () => {
      const answer = `Example:\n\`\`\`\n${lines(130).join('\n')}\n\`\`\``;
      mockCallLLM.mockImplementation(answersWith(answer));

      const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

      const [block] = response.blocks.filter((b) => b.type === 'markdown');
      expect(block.text.length).toBeLessThanOrEqual(12000);
      expect(block.text.match(/^```/gm)).toHaveLength(2);
    });
  });

  it('does not capture the conversation until the caller has delivered the answer', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(mockCaptureConversation).not.toHaveBeenCalled();
  });

  it('captures the conversation under the caller’s entry point when capture() runs', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    const { capture } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });
    await capture();

    expect(mockCaptureConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoint: 'slash_ask',
        userMessage: 'q',
        botResponse: 'answer',
        userId: 'U1',
        channelId: 'C1',
      }),
    );
  });

  it('finalizes the metadata envelope', async () => {
    const metadata = { finalize_state: 'ready_to_finalize', sources: [] };
    mockCallLLM.mockImplementation(answersWith('answer', metadata));

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(mockFinalizeMetadataEnvelope).toHaveBeenCalledWith(metadata);
  });

  it('logs the citation state through the shared helper', async () => {
    const metadata = { finalize_state: 'ready_to_finalize', sources: [{}, {}] };
    mockCallLLM.mockImplementation(answersWith('answer', metadata));

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(mockLogCitationTelemetry).toHaveBeenCalledWith(mockLogger, metadata);
  });

  it('survives a capture failure — capture() resolves and logs no error message', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));
    mockCaptureConversation.mockRejectedValueOnce(Object.assign(new Error('cosmos down: q'), { name: 'RestError' }));

    const { response, errorType, capture } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'slash_ask',
      ...ids,
    });
    await expect(capture()).resolves.toBeUndefined();

    expect(errorType).toBeNull();
    expect(response.text).toBe('answer');
    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to capture conversation: RestError');
  });

  // The line's format, including grounding=, is tested with the helper.
  it('passes the decline outcome to the citation log', async () => {
    const metadata = { ...readyMetadata(), grounding: 'declined_no_results' };
    mockCallLLM.mockImplementation(answersWith('declined', metadata));

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(mockLogCitationTelemetry).toHaveBeenCalledWith(
      mockLogger,
      expect.objectContaining({ grounding: 'declined_no_results' }),
    );
  });

  describe('Sources block', () => {
    it('renders the numbered Sources block between the answer and the divider', async () => {
      mockCallLLM.mockImplementation(answersWith('A [1] B [2]', readyMetadata()));

      const { response } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });

      expect(response.blocks.map((block) => block.type)).toEqual(['markdown', 'section', 'divider', 'context_actions']);
      expect(response.blocks[0].text).toBe('A [1] B [2]');
      expect(response.blocks[1].text.text).toBe(SOURCES_TEXT);
    });

    it('omits the Sources block when metadata degraded', async () => {
      mockCallLLM.mockImplementation(
        answersWith('answer', { ...readyMetadata(), finalize_state: 'degraded_no_metadata' }),
      );

      const { response } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });

      expect(response.blocks.map((block) => block.type)).toEqual(['markdown', 'divider', 'context_actions']);
    });

    it('omits the Sources block from the empty-answer fallback', async () => {
      mockCallLLM.mockImplementation(answersWith('', readyMetadata()));

      const { response } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });

      expect(response.text).toBe(ASK_EMPTY_TEXT);
      expect(response.blocks.map((block) => block.type)).toEqual(['section']);
    });
  });

  describe('when the LLM fails', () => {
    beforeEach(() => {
      mockCallLLM.mockRejectedValue(new Error('perplexity exploded'));
    });

    it('substitutes the error copy instead of throwing', async () => {
      const { response } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });
      expect(response.text).toBe(ASK_ERROR_TEXT);
    });

    it('reports the failure through errorType so telemetry is not recorded as success', async () => {
      const { errorType } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });
      expect(errorType).toBe('llm_failed');
    });

    it('sends only the error copy, with no feedback buttons to rate it by', async () => {
      const { response } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'app_mention',
        ...ids,
      });

      expect(response.blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: ASK_ERROR_TEXT } }]);
    });

    it('does not capture a conversation, even when capture() runs', async () => {
      const { capture } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });
      await capture();
      expect(mockCaptureConversation).not.toHaveBeenCalled();
    });

    it('logs the error name and status, not the message, which can echo the request', async () => {
      mockCallLLM.mockRejectedValue(
        Object.assign(new Error('400 bad request: {"input":"the question"}'), { name: 'APIError', status: 400 }),
      );

      await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to answer ask question: APIError (status 400)');
    });
  });

  describe('when the question is too long', () => {
    it('declines without calling the LLM', async () => {
      const { response, errorType, capture } = await buildAskResponse({
        question: 'x'.repeat(MAX_QUESTION_LENGTH + 1),
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });
      await capture();

      expect(mockCallLLM).not.toHaveBeenCalled();
      expect(errorType).toBe('question_too_long');
      expect(response.text).toBe(ASK_TOO_LONG_TEXT);
      expect(mockCaptureConversation).not.toHaveBeenCalled();
    });

    it('accepts a question exactly at the limit', async () => {
      mockCallLLM.mockImplementation(answersWith('answer'));

      const { errorType } = await buildAskResponse({
        question: 'x'.repeat(MAX_QUESTION_LENGTH),
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });

      expect(errorType).toBeNull();
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });
  });

  it('shortens an answer without a logger instead of throwing', async () => {
    mockCallLLM.mockImplementation(answersWith(`${'word '.repeat(3000)}`));

    const { response } = await buildAskResponse({ question: 'q', interactionType: 'slash_ask', ...ids });

    expect(response.blocks[0].text).toMatch(/shortened/);
  });
});

describe('fitMarkdownBlock', () => {
  const LIMIT = 12000;

  it.each([
    ['exactly at the limit', LIMIT, false],
    ['one character over', LIMIT + 1, true],
  ])('%s (%i characters) — shortened: %s', (_label, length, shortened) => {
    const text = `${'a'.repeat(99)}\n`.repeat(Math.ceil(length / 100)).slice(0, length);

    const result = fitMarkdownBlock(text);

    expect(result.shortened).toBe(shortened);
    expect(result.text.length).toBeLessThanOrEqual(LIMIT);
    if (!shortened) expect(result.text).toBe(text);
  });

  it('cuts one long line at a space, so a citation link is not split', async () => {
    const text = `${'see [[1]](https://docs.ed-fi.org/reference/data-exchange) '.repeat(400)}`;

    const { text: fitted } = fitMarkdownBlock(text);
    const [kept] = fitted.split('\n\n');

    expect(fitted.length).toBeLessThanOrEqual(LIMIT);
    const opened = kept.split('[[1]](').length - 1;
    const closed = kept.split('data-exchange)').length - 1;
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBe(opened);
  });

  it('closes the fence before the notice, so the notice renders as text', () => {
    const text = `\`\`\`js\n${'const x = 1;\n'.repeat(1200)}\`\`\``;

    const { text: fitted } = fitMarkdownBlock(text);

    expect(fitted.length).toBeLessThanOrEqual(LIMIT);
    expect(fitted).toMatch(/\n```\n\n_This answer was too long/);
  });

  it('adds no fence when the code block closed before the cut', () => {
    const text = `\`\`\`\ncode\n\`\`\`\n${'prose line\n'.repeat(1300)}`;

    const { text: fitted } = fitMarkdownBlock(text);

    expect(fitted.match(/^```/gm)).toHaveLength(2);
  });

  it.each([
    ['an indented backtick fence', '  ```', '  ```'],
    ['a tilde fence', '~~~', '~~~'],
    ['a longer backtick fence', '````', '````'],
  ])('closes %s with the matching marker', (_label, opener, closer) => {
    const text = `${opener}\n${'line of code\n'.repeat(1200)}`;

    const { text: fitted } = fitMarkdownBlock(text);

    expect(fitted).toContain(`\n${closer.trim()}\n\n_This answer was too long`);
  });

  it('does not treat a tilde line as closing a backtick fence', () => {
    const text = `\`\`\`\n~~~\n${'line of code\n'.repeat(1200)}`;

    const { text: fitted } = fitMarkdownBlock(text);

    expect(fitted).toMatch(/\n```\n\n_This answer was too long/);
  });
});

describe('describeError', () => {
  it('names the error and its status', () => {
    expect(describeError(Object.assign(new Error('secret'), { name: 'APIError', status: 429 }))).toBe(
      'APIError (status 429)',
    );
  });

  it('names an error with no status', () => {
    expect(describeError(new TypeError('secret'))).toBe('TypeError');
  });
});

describe('streamAskResponse', () => {
  let mockStreamer;
  let mockClient;

  beforeEach(() => {
    mockStreamer = { append: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
    mockClient = { chatStream: jest.fn().mockReturnValue(mockStreamer) };
    mockCallLLM.mockImplementation(answersWith('answer'));
  });

  it('streams into the current thread', async () => {
    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    expect(mockClient.chatStream).toHaveBeenCalledWith({
      channel: 'C1',
      recipient_team_id: 'T1',
      recipient_user_id: 'U1',
      thread_ts: '111.000',
    });
  });

  it('omits thread_ts when there is no thread', async () => {
    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
      threadTs: null,
    });

    expect(mockClient.chatStream.mock.calls[0][0]).not.toHaveProperty('thread_ts');
  });

  it('stops the stream with the feedback block', async () => {
    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    const [{ blocks }] = mockStreamer.stop.mock.calls[0];
    expect(blocks[0].block_id).toBe('feedback|ask|assistant_message');
  });

  it('stops the stream with the Sources block ahead of the feedback block', async () => {
    mockCallLLM.mockImplementation(answersWith('A [1] B [2]', readyMetadata()));

    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    const [{ blocks }] = mockStreamer.stop.mock.calls[0];
    expect(blocks.map((block) => block.type)).toEqual(['section', 'context_actions']);
    expect(blocks[0].text.text).toBe(SOURCES_TEXT);
  });

  it('stops an empty answer with no Sources block and no feedback buttons', async () => {
    mockCallLLM.mockImplementation(answersWith('', readyMetadata()));

    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    expect(mockStreamer.stop).toHaveBeenCalledWith();
  });

  it('builds the Sources block, then finalizes, then stops the stream', async () => {
    const order = [];
    const metadata = readyMetadata();
    mockCallLLM.mockImplementation(answersWith('A [1]', metadata));
    mockFinalizeMetadataEnvelope.mockImplementationOnce((m) => {
      order.push('finalize');
      m.finalize_state = 'finalized';
    });
    mockStreamer.stop.mockImplementationOnce(async ({ blocks }) => {
      order.push(`stop:${blocks.map((block) => block.type).join(',')}`);
    });

    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    expect(order).toEqual(['finalize', 'stop:section,context_actions']);
  });

  it('settles the envelope even when stop() rejects', async () => {
    const metadata = readyMetadata();
    mockCallLLM.mockImplementation(answersWith('A [1]', metadata));
    mockStreamer.stop.mockRejectedValueOnce(new Error('stream gone'));

    await expect(
      streamAskResponse({
        client: mockClient,
        logger: mockLogger,
        question: 'q',
        interactionType: 'assistant_message',
        ...ids,
      }),
    ).rejects.toThrow('stream gone');

    expect(metadata.finalize_state).toBe('finalized');
    expect(mockCaptureConversation).not.toHaveBeenCalled();
  });

  it('declines an over-long question without calling the LLM', async () => {
    const { errorType } = await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'x'.repeat(MAX_QUESTION_LENGTH + 1),
      interactionType: 'assistant_message',
      ...ids,
    });

    expect(errorType).toBe('question_too_long');
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockStreamer.append).toHaveBeenCalledWith({ markdown_text: ASK_TOO_LONG_TEXT });
    expect(mockStreamer.stop).toHaveBeenCalledWith();
  });

  it('survives a capture failure after the answer has streamed', async () => {
    mockCaptureConversation.mockRejectedValueOnce(new Error('cosmos down'));

    const result = await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    expect(result).toEqual({ errorType: null });
    expect(mockStreamer.stop).toHaveBeenCalledTimes(1);
  });

  it('captures the conversation like the ephemeral path does', async () => {
    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    expect(mockCaptureConversation).toHaveBeenCalledWith(
      expect.objectContaining({ entryPoint: 'assistant_message', userMessage: 'q', botResponse: 'answer' }),
    );
  });

  it('lets an LLM failure propagate to the telemetry wrapper', async () => {
    mockCallLLM.mockRejectedValueOnce(new Error('perplexity exploded'));

    await expect(
      streamAskResponse({
        client: mockClient,
        logger: mockLogger,
        question: 'q',
        interactionType: 'assistant_message',
        ...ids,
      }),
    ).rejects.toThrow('perplexity exploded');
  });
});

// callPerplexityChat returns `botText: ''` without appending anything when the
// Agent response carries no text. That is a failed generation, not an answer.
function answersWithNothing(text = '') {
  return async () => ({ metadata: null, botText: text, systemPromptVersion: 'v1' });
}

describe('when the LLM returns an empty answer', () => {
  it('substitutes the error copy instead of delivering an empty section', async () => {
    mockCallLLM.mockImplementation(answersWithNothing());

    const { response } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'slash_ask',
      ...ids,
    });

    expect(response.text).toBe(ASK_EMPTY_TEXT);
    expect(response.blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: ASK_EMPTY_TEXT } }]);
  });

  it('suggests a next step instead of the generic try-again copy', () => {
    expect(ASK_EMPTY_TEXT).not.toBe(ASK_ERROR_TEXT);
    expect(ASK_EMPTY_TEXT).toContain('/fiona search');
  });

  it('treats a whitespace-only answer the same way', async () => {
    mockCallLLM.mockImplementation(answersWithNothing('   \n  '));

    const { response, errorType } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'slash_ask',
      ...ids,
    });

    expect(response.text).toBe(ASK_EMPTY_TEXT);
    expect(errorType).toBe('llm_empty');
  });

  it('reports the failure through errorType so telemetry is not recorded as success', async () => {
    mockCallLLM.mockImplementation(answersWithNothing());

    const { errorType } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'slash_ask',
      ...ids,
    });

    expect(errorType).toBe('llm_empty');
  });

  it('does not capture an empty answer as a successful conversation', async () => {
    mockCallLLM.mockImplementation(answersWithNothing());

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(mockCaptureConversation).not.toHaveBeenCalled();
  });

  describe('on the streaming path', () => {
    let mockStreamer;
    let mockClient;

    beforeEach(() => {
      mockStreamer = { append: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
      mockClient = { chatStream: jest.fn().mockReturnValue(mockStreamer) };
      mockCallLLM.mockImplementation(answersWithNothing());
    });

    it('streams the error copy rather than stopping on an empty message', async () => {
      await streamAskResponse({
        client: mockClient,
        logger: mockLogger,
        question: 'q',
        interactionType: 'assistant_message',
        ...ids,
      });

      expect(mockStreamer.append).toHaveBeenCalledWith({ markdown_text: ASK_EMPTY_TEXT });
      expect(mockStreamer.stop).toHaveBeenCalledWith();
    });

    it('treats a whitespace-only answer the same way', async () => {
      mockCallLLM.mockImplementation(answersWithNothing('  \n '));

      const { errorType } = await streamAskResponse({
        client: mockClient,
        logger: mockLogger,
        question: 'q',
        interactionType: 'assistant_message',
        ...ids,
      });

      expect(errorType).toBe('llm_empty');
      expect(mockStreamer.append).toHaveBeenCalledWith({ markdown_text: ASK_EMPTY_TEXT });
    });

    it('reports the failure and captures nothing', async () => {
      const { errorType } = await streamAskResponse({
        client: mockClient,
        logger: mockLogger,
        question: 'q',
        interactionType: 'assistant_message',
        ...ids,
      });

      expect(errorType).toBe('llm_empty');
      expect(mockCaptureConversation).not.toHaveBeenCalled();
    });
  });
});
