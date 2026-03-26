import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the LLM caller and rate limiter before importing the module under test
jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => ({
  callLLM: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../../src/agent/rate-limiter.js', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 }),
}));

// Simulate the real fallback behaviour: when history is empty, return [currentText as user message].
jest.unstable_mockModule('../../../src/agent/thread-history.js', () => ({
  buildThreadHistory: jest.fn().mockImplementation((_client, _channel, _ts, { currentText = null } = {}) =>
    Promise.resolve(currentText ? [{ role: 'user', content: currentText }] : []),
  ),
}));

const { appMentionCallback } = await import('../../../src/listeners/events/app_mention.js');
const { callLLM } = await import('../../../src/agent/llm-caller.js');
const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
const { buildThreadHistory } = await import('../../../src/agent/thread-history.js');

describe('appMentionCallback', () => {
  let mockSay;
  let mockLogger;
  let mockStreamer;
  let mockClient;
  let mockEvent;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn() };
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
    expect(mockClient.chatStream).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1234567890.000000' }),
    );
  });

  it('falls back to event.ts as thread_ts when thread_ts is absent', async () => {
    delete mockEvent.thread_ts;
    await appMentionCallback({ event: mockEvent, client: mockClient, logger: mockLogger, say: mockSay });
    expect(mockClient.chatStream).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1234567890.000001' }),
    );
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
});
