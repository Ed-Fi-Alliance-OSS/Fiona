// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock the LLM caller and rate limiter before importing the module under test
jest.unstable_mockModule('../../../src/agent/interaction-store.js', () => ({
  recordInteraction: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => ({
  callLLM: jest.fn().mockResolvedValue({ metadata: null, botText: '', systemPromptVersion: 'v1' }),
  finalizeMetadataEnvelope: jest.fn(),
  handleMetadataTimeout: jest.fn(),
  LLM_MODEL: 'sonar-pro',
  SYSTEM_PROMPT_VERSION: 'v1',
  CITATION_POLICY: {
    citation_rendering_enabled: true,
    FEATURE_FLAG_EVIDENCE_ROW: false,
    MAX_SOURCES_DISPLAYED: 10,
    METADATA_WAIT_TIMEOUT_MS: 2000,
  },
  MetadataLifecycleState: {
    STREAMING_TEXT: 'streaming_text',
    COLLECTING_METADATA: 'collecting_metadata',
    READY_TO_FINALIZE: 'ready_to_finalize',
    FINALIZED: 'finalized',
    DEGRADED_NO_METADATA: 'degraded_no_metadata',
  },
}));

jest.unstable_mockModule('../../../src/agent/rate-limiter.js', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 }),
}));

// Simulate the real fallback behaviour: when history is empty, return [currentText as user message].
jest.unstable_mockModule('../../../src/agent/thread-history.js', () => ({
  buildThreadHistory: jest
    .fn()
    .mockImplementation((_client, _channel, _ts, { currentText = null } = {}) =>
      Promise.resolve(currentText ? [{ role: 'user', content: currentText }] : []),
    ),
}));

jest.unstable_mockModule('../../../src/agent/utils/idempotent-finalize.js', () => ({
  generateResponseId: jest.fn().mockReturnValue('C123:1234567890.000001'),
  shouldFinalize: jest.fn().mockReturnValue(true),
  rollbackFinalization: jest.fn(),
}));

jest.unstable_mockModule('../../../src/agent/conversation-capture-store.js', () => ({
  captureConversation: jest.fn().mockResolvedValue(undefined),
}));

const { appMentionCallback } = await import('../../../src/listeners/events/app_mention.js');
const { callLLM, finalizeMetadataEnvelope } = await import('../../../src/agent/llm-caller.js');
const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
const { buildThreadHistory } = await import('../../../src/agent/thread-history.js');
const { shouldFinalize, rollbackFinalization } = await import('../../../src/agent/utils/idempotent-finalize.js');
const { recordInteraction } = await import('../../../src/agent/interaction-store.js');
const { captureConversation } = await import('../../../src/agent/conversation-capture-store.js');

describe('appMentionCallback', () => {
  let mockSay;
  let mockLogger;
  let mockStreamer;
  let mockClient;
  let mockEvent;

  beforeEach(() => {
    jest.clearAllMocks();
    shouldFinalize.mockReturnValue(true);

    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), info: jest.fn() };
    mockStreamer = {
      append: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    mockClient = {
      assistant: {
        threads: {
          setStatus: jest.fn().mockResolvedValue(undefined),
        },
      },
      chatStream: jest.fn().mockReturnValue(mockStreamer),
    };
    mockEvent = {
      channel: 'C123',
      team: 'T123',
      user: 'U456',
      ts: '1234567890.000001',
      text: '<@BOT123> Hello world',
    };
  });

  it('calls checkRateLimit with the user ID', async () => {
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
    expect(checkRateLimit).toHaveBeenCalledWith('U456');
  });

  it('sends a rate limit message and returns early when user is rate limited', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 90000 });

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(mockSay).toHaveBeenCalledTimes(1);
    const [msg] = mockSay.mock.calls[0];
    expect(msg).toContain('request limit');
    expect(callLLM).not.toHaveBeenCalled();

    expect(recordInteraction).toHaveBeenCalledTimes(1);
    expect(recordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        rateLimited: true,
        status: 'error',
        errorType: 'rate_limited',
      }),
    );
    // recordInteraction is fired before say() but not awaited — say() is not blocked on the Cosmos write
    expect(recordInteraction.mock.invocationCallOrder[0]).toBeLessThan(mockSay.mock.invocationCallOrder[0]);
  });

  it('calls callLLM when user is within rate limit', async () => {
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('strips Slack mention tokens from the text before calling LLM', async () => {
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    const [, prompts] = callLLM.mock.calls[0];
    expect(prompts[0].content).toBe('Hello world');
  });

  it('calls streamer.stop after the LLM responds', async () => {
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
    expect(mockStreamer.stop).toHaveBeenCalledTimes(1);
  });

  it('uses event.thread_ts as thread_ts when present', async () => {
    mockEvent.thread_ts = '1234567890.000000';
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
    expect(mockClient.chatStream).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: '1234567890.000000' }));
  });

  it('falls back to event.ts as thread_ts when thread_ts is absent', async () => {
    delete mockEvent.thread_ts;
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
    expect(mockClient.chatStream).toHaveBeenCalledWith(expect.objectContaining({ thread_ts: '1234567890.000001' }));
  });

  it('sends a warning and logs error when an exception occurs', async () => {
    const error = new Error('LLM failure');
    callLLM.mockRejectedValueOnce(error);

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockSay).toHaveBeenCalledWith(expect.stringContaining(':warning:'));
  });

  it('includes plural "minutes" for retryAfterMs >= 2 minutes', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 120000 });

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    const [msg] = mockSay.mock.calls[0];
    expect(msg).toContain('minutes');
  });

  it('includes singular "minute" for retryAfterMs < 2 minutes', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 60000 });

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    const [msg] = mockSay.mock.calls[0];
    expect(msg).toMatch(/\bminute\b/);
  });

  describe('thread history integration', () => {
    it('passes the stripped text as currentText to buildThreadHistory', async () => {
      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
      expect(buildThreadHistory).toHaveBeenCalledWith(
        mockClient,
        'C123',
        expect.any(String),
        expect.objectContaining({ currentText: 'Hello world' }),
      );
    });

    it('passes the logger to buildThreadHistory', async () => {
      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
      expect(buildThreadHistory).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(String),
        expect.objectContaining({ logger: mockLogger }),
      );
    });

    it('uses full thread history when available', async () => {
      buildThreadHistory.mockResolvedValueOnce([
        { role: 'user', content: 'Prior question' },
        { role: 'assistant', content: 'Prior answer' },
        { role: 'user', content: 'Hello world' },
      ]);

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      const [, prompts] = callLLM.mock.calls[0];
      expect(prompts).toHaveLength(3);
      expect(prompts[prompts.length - 1]).toEqual({ role: 'user', content: 'Hello world' });
    });
  });

  it('sends an introduction when the mention has no text after stripping tokens', async () => {
    mockEvent.text = '<@BOT123>';

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay.mock.calls[0][0]).toContain("I'm Fiona");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('sends an introduction when the mention text is empty', async () => {
    mockEvent.text = '';

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay.mock.calls[0][0]).toContain("I'm Fiona");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('skips streamer.stop when shouldFinalize returns false', async () => {
    shouldFinalize.mockReturnValueOnce(false);

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(mockStreamer.stop).not.toHaveBeenCalled();
  });

  it('logs citation state and source count when metadata is present', async () => {
    callLLM.mockResolvedValueOnce({
      metadata: {
        finalize_state: 'ready_to_finalize',
        sources: [{ url: 'https://a.com' }],
        source_index_map: { 'https://a.com': 1 },
      },
      botText: 'test response',
      systemPromptVersion: 'v1',
    });

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('[citations]'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('state=ready_to_finalize'));
  });

  it('calls finalizeMetadataEnvelope after streamer.stop', async () => {
    const metadata = {
      finalize_state: 'ready_to_finalize',
      sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs' }],
      source_index_map: { 'https://docs.ed-fi.org': 1 },
    };
    callLLM.mockResolvedValueOnce({ metadata, botText: 'test response', systemPromptVersion: 'v1' });

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(finalizeMetadataEnvelope).toHaveBeenCalledWith(metadata);
  });

  it('passes logger to shouldFinalize', async () => {
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(shouldFinalize).toHaveBeenCalledWith(expect.any(String), mockLogger);
  });

  it('rolls back finalization when streamer.stop throws', async () => {
    shouldFinalize.mockReturnValueOnce(true);
    mockStreamer.stop.mockRejectedValueOnce(new Error('stop failed'));

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(rollbackFinalization).toHaveBeenCalledWith('C123:1234567890.000001');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('does not roll back when shouldFinalize returns false (no slot was claimed)', async () => {
    shouldFinalize.mockReturnValueOnce(false);

    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

    expect(rollbackFinalization).not.toHaveBeenCalled();
  });

  describe('conversation capture', () => {
    beforeEach(() => {
      captureConversation.mockClear();
      callLLM.mockResolvedValue({
        metadata: { finalize_state: 'ready_to_finalize', sources: [{ url: 'https://a.com' }], source_index_map: {}, provider: 'perplexity' },
        botText: 'Bot answer here.',
        systemPromptVersion: 'v1',
      });
    });

    it('calls captureConversation with correct fields after a successful LLM response', async () => {
      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(captureConversation).toHaveBeenCalledTimes(1);
      const call = captureConversation.mock.calls[0][0];
      expect(call.userId).toBe(mockEvent.user);
      expect(call.channelId).toBe(mockEvent.channel);
      expect(call.entryPoint).toBe('app_mention');
      expect(call.botResponse).toBe('Bot answer here.');
      expect(call.llmProvider).toBe('perplexity');
      expect(call.teamId).toBeDefined();
      expect(call.llmModel).toBeDefined();
      expect(call.systemPromptVersion).toBe('v1');
    });

    it('does not call captureConversation when callLLM throws', async () => {
      callLLM.mockRejectedValueOnce(new Error('LLM failure'));

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(captureConversation).not.toHaveBeenCalled();
    });

    it('does not call captureConversation when shouldFinalize returns false', async () => {
      shouldFinalize.mockReturnValueOnce(false);

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(captureConversation).not.toHaveBeenCalled();
    });
  });

  describe('keyword command routing', () => {
    it('responds with help text when mention text is exactly "help"', async () => {
      mockEvent.text = '<@UFIONA> help';

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(mockSay).toHaveBeenCalledTimes(1);
      expect(mockSay.mock.calls[0][0]).toContain('/fiona help');
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('does not call setStatus (thinking) when routing to help command', async () => {
      mockEvent.text = '<@UFIONA> help';

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(mockClient.assistant.threads.setStatus).not.toHaveBeenCalled();
    });

    it('passes "@fiona help me with X" to the LLM, not treated as command', async () => {
      mockEvent.text = '<@UFIONA> help me understand the ODS API';

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(callLLM).toHaveBeenCalled();
    });

    it('responds with coming-soon text when mention text starts with "ask "', async () => {
      mockEvent.text = '<@UFIONA> ask how do I set up ODS?';

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(mockSay).toHaveBeenCalledTimes(1);
      expect(mockSay.mock.calls[0][0]).toMatch(/not yet available/i);
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('responds with coming-soon text when mention text starts with "search "', async () => {
      mockEvent.text = '<@UFIONA> search Data Standard 6.0';

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(mockSay).toHaveBeenCalledTimes(1);
      expect(mockSay.mock.calls[0][0]).toMatch(/not yet available/i);
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('responds with help text when mention text is "fiona help"', async () => {
      mockEvent.text = '<@UFIONA> fiona help';

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(mockSay).toHaveBeenCalledTimes(1);
      expect(mockSay.mock.calls[0][0]).toContain('/fiona help');
      expect(callLLM).not.toHaveBeenCalled();
    });

    it('responds with coming-soon text for "@fiona fiona ask <question>"', async () => {
      mockEvent.text = '<@UFIONA> fiona ask how do I set up ODS?';

      await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });

      expect(mockSay).toHaveBeenCalledTimes(1);
      expect(mockSay.mock.calls[0][0]).toMatch(/not yet available/i);
      expect(callLLM).not.toHaveBeenCalled();
    });
  });
});
