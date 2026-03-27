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

const { message: messageHandler } = await import('../../../src/listeners/assistant/message.js');
const { callLLM } = await import('../../../src/agent/llm-caller.js');
const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
const { buildThreadHistory } = await import('../../../src/agent/thread-history.js');

describe('message (assistant thread handler)', () => {
  let mockSay;
  let mockLogger;
  let mockSetStatus;
  let mockStreamer;
  let mockClient;
  let mockContext;
  let mockMessage;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn() };
    mockSetStatus = jest.fn().mockResolvedValue(undefined);
    mockStreamer = {
      append: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    mockClient = {
      chatStream: jest.fn().mockReturnValue(mockStreamer),
    };
    mockContext = {
      userId: 'U123',
      teamId: 'T123',
    };
    mockMessage = {
      channel: 'C123',
      thread_ts: '1234567890.000000',
      text: 'What is Ed-Fi?',
    };
  });

  it('returns silently when thread_ts is absent', async () => {
    delete mockMessage.thread_ts;

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('returns silently when thread_ts is falsy', async () => {
    mockMessage.thread_ts = '';

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('sends an introduction when text is absent', async () => {
    delete mockMessage.text;

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay.mock.calls[0][0]).toContain("I'm Fiona");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('sends an introduction when text is an empty string', async () => {
    mockMessage.text = '';

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay.mock.calls[0][0]).toContain("I'm Fiona");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('sends an introduction when text is whitespace only', async () => {
    mockMessage.text = '   ';

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay.mock.calls[0][0]).toContain("I'm Fiona");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('sends an introduction when text contains only a Slack mention token', async () => {
    mockMessage.text = '<@U0AJYKA5S4D>';

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay.mock.calls[0][0]).toContain("I'm Fiona");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('sends an introduction when text is only mention tokens and whitespace', async () => {
    mockMessage.text = '  <@U0AJYKA5S4D>  <@U99999>  ';

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockSay.mock.calls[0][0]).toContain("I'm Fiona");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('logs error and does not throw when introduction say() rejects', async () => {
    mockMessage.text = '';
    mockSay.mockRejectedValueOnce(new Error('Slack API error'));

    await expect(
      messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('calls checkRateLimit with the user ID', async () => {
    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(checkRateLimit).toHaveBeenCalledWith('U123');
  });

  it('sends a rate limit message and returns early when user is rate limited', async () => {
    checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 90000 });

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    const [msg] = mockSay.mock.calls[0];
    expect(msg).toContain('request limit');
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('calls callLLM for a normal message', async () => {
    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('strips Slack mention tokens before passing text to the LLM', async () => {
    mockMessage.text = '<@U0AJYKA5S4D> What is Ed-Fi?';

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    const [, prompts] = callLLM.mock.calls[0];
    expect(prompts[0].content).toBe('What is Ed-Fi?');
  });

  it('sends a warning and logs error when an exception occurs', async () => {
    const error = new Error('LLM failure');
    callLLM.mockRejectedValueOnce(error);

    await messageHandler({
      client: mockClient,
      context: mockContext,
      logger: mockLogger,
      message: mockMessage,
      say: mockSay,
      setStatus: mockSetStatus,
    });

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockSay).toHaveBeenCalledWith(expect.stringContaining(':warning:'));
  });

  describe('thread history integration', () => {
    it('passes the stripped text as currentText to buildThreadHistory', async () => {
      mockMessage.text = '<@U0AJYKA5S4D> What is Ed-Fi?';

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(buildThreadHistory).toHaveBeenCalledWith(
        mockClient,
        'C123',
        '1234567890.000000',
        expect.objectContaining({ currentText: 'What is Ed-Fi?' }),
      );
    });

    it('passes the logger to buildThreadHistory', async () => {
      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

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
        { role: 'user', content: 'What is Ed-Fi?' },
      ]);

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      const [, prompts] = callLLM.mock.calls[0];
      expect(prompts).toHaveLength(3);
      expect(prompts[prompts.length - 1]).toEqual({ role: 'user', content: 'What is Ed-Fi?' });
    });
  });
});
