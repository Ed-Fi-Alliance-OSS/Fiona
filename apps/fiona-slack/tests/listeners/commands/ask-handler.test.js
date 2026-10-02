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
jest.unstable_mockModule('../../../src/agent/interaction-telemetry.js', () => ({
  waitForMetadataReady: mockWaitForMetadataReady,
  handleInteractionWithTelemetry: jest.fn(),
}));

const mockCaptureConversation = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../../src/agent/conversation-capture-store.js', () => ({
  captureConversation: mockCaptureConversation,
}));

const { ASK_ERROR_TEXT, buildAskResponse, streamAskResponse } = await import(
  '../../../src/listeners/commands/ask-handler.js'
);

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

  it('renders the answer as a section block followed by a divider and feedback buttons', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    const { response } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'app_mention',
      ...ids,
    });

    expect(response.blocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn', text: 'answer' } });
    expect(response.blocks[1]).toEqual({ type: 'divider' });
    expect(response.blocks[2].block_id).toBe('feedback|ask|app_mention');
  });

  it('suppresses link unfurling so a cited answer does not explode into previews', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(response).toMatchObject({ unfurl_links: false, unfurl_media: false });
  });

  it('splits an answer longer than a section block across several blocks', async () => {
    // 5 paragraphs of 800 chars: over Slack's 3000-char section limit in total,
    // with newlines available to break on.
    const long = Array.from({ length: 5 }, (_, i) => `${'x'.repeat(799)}${i}`).join('\n');
    mockCallLLM.mockImplementation(answersWith(long));

    const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    const sections = response.blocks.filter((b) => b.type === 'section');
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it('splits a single unbroken paragraph that exceeds the limit', async () => {
    mockCallLLM.mockImplementation(answersWith('y'.repeat(7000)));

    const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    const sections = response.blocks.filter((b) => b.type === 'section');
    expect(sections).toHaveLength(3);
    for (const section of sections) {
      expect(section.text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it('loses no text when it splits', async () => {
    const long = Array.from({ length: 5 }, (_, i) => `${'x'.repeat(799)}${i}`).join('\n');
    mockCallLLM.mockImplementation(answersWith(long));

    const { response } = await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    const rejoined = response.blocks
      .filter((b) => b.type === 'section')
      .map((b) => b.text.text)
      .join('\n');
    expect(rejoined).toBe(long);
  });

  it('captures the conversation under the caller’s entry point', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

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

  it('logs the citation state when metadata is present', async () => {
    mockCallLLM.mockImplementation(answersWith('answer', { finalize_state: 'ready_to_finalize', sources: [{}, {}] }));

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('[citations]'));
  });

  it('survives a capture failure — the user still gets the answer', async () => {
    mockCallLLM.mockImplementation(answersWith('answer'));
    mockCaptureConversation.mockRejectedValueOnce(new Error('cosmos down'));

    const { response, errorType } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'slash_ask',
      ...ids,
    });

    expect(errorType).toBeNull();
    expect(response.text).toBe('answer');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to capture conversation'));
  });

  it('logs the grounding outcome when the answer was declined', async () => {
    const metadata = { ...readyMetadata(), grounding: 'declined_no_results' };
    mockCallLLM.mockImplementation(answersWith('declined', metadata));

    await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('grounding=declined_no_results'));
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

      expect(response.blocks.map((block) => block.type)).toEqual(['section', 'section', 'divider', 'context_actions']);
      expect(response.blocks[0].text.text).toBe('A [1] B [2]');
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

      expect(response.blocks.map((block) => block.type)).toEqual(['section', 'divider', 'context_actions']);
    });

    it('omits the Sources block from the empty-answer fallback', async () => {
      mockCallLLM.mockImplementation(answersWith('', readyMetadata()));

      const { response } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'slash_ask',
        ...ids,
      });

      expect(response.text).toBe(ASK_ERROR_TEXT);
      expect(response.blocks.map((block) => block.type)).toEqual(['section', 'divider', 'context_actions']);
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

    it('includes the divider and feedback buttons in the fallback response', async () => {
      const { response } = await buildAskResponse({
        question: 'q',
        logger: mockLogger,
        interactionType: 'app_mention',
        ...ids,
      });

      expect(response.blocks[0]).toMatchObject({
        type: 'section',
        text: { type: 'mrkdwn', text: ASK_ERROR_TEXT },
      });
      expect(response.blocks[1]).toEqual({ type: 'divider' });
      expect(response.blocks[2].block_id).toBe('feedback|ask|app_mention');
    });

    it('does not capture a conversation', async () => {
      await buildAskResponse({ question: 'q', logger: mockLogger, interactionType: 'slash_ask', ...ids });
      expect(mockCaptureConversation).not.toHaveBeenCalled();
    });
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

  it('stops an empty answer without a Sources block', async () => {
    mockCallLLM.mockImplementation(answersWith('', readyMetadata()));

    await streamAskResponse({
      client: mockClient,
      logger: mockLogger,
      question: 'q',
      interactionType: 'assistant_message',
      ...ids,
    });

    const [{ blocks }] = mockStreamer.stop.mock.calls[0];
    expect(blocks.map((block) => block.type)).toEqual(['context_actions']);
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

    expect(response.text).toBe(ASK_ERROR_TEXT);
    expect(response.blocks[0]).toMatchObject({ type: 'section', text: { text: ASK_ERROR_TEXT } });
    expect(response.blocks[2].block_id).toBe('feedback|ask|slash_ask');
  });

  it('treats a whitespace-only answer the same way', async () => {
    mockCallLLM.mockImplementation(answersWithNothing('   \n  '));

    const { response, errorType } = await buildAskResponse({
      question: 'q',
      logger: mockLogger,
      interactionType: 'slash_ask',
      ...ids,
    });

    expect(response.text).toBe(ASK_ERROR_TEXT);
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

      expect(mockStreamer.append).toHaveBeenCalledWith({ markdown_text: ASK_ERROR_TEXT });
      const [{ blocks }] = mockStreamer.stop.mock.calls[0];
      expect(blocks[0].block_id).toBe('feedback|ask|assistant_message');
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
