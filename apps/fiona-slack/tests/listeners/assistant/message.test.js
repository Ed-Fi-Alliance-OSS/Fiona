import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the LLM caller and rate limiter before importing the module under test
jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => ({
  callLLM: jest.fn().mockResolvedValue(undefined),
  finalizeMetadataEnvelope: jest.fn(),
  handleMetadataTimeout: jest.fn(),
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
  buildThreadHistory: jest.fn().mockImplementation((_client, _channel, _ts, { currentText = null } = {}) =>
    Promise.resolve(currentText ? [{ role: 'user', content: currentText }] : []),
  ),
}));

jest.unstable_mockModule('../../../src/agent/utils/idempotent-finalize.js', () => ({
  generateResponseId: jest.fn().mockReturnValue('C123:1234567890.000000'),
  shouldFinalize: jest.fn().mockReturnValue(true),
  rollbackFinalization: jest.fn(),
}));

jest.unstable_mockModule('../../../src/listeners/views/citations_block.js', () => ({
  buildCitationBlocks: jest.fn().mockReturnValue([]),
}));

const { message: messageHandler } = await import('../../../src/listeners/assistant/message.js');
const { callLLM, finalizeMetadataEnvelope } = await import('../../../src/agent/llm-caller.js');
const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
const { buildThreadHistory } = await import('../../../src/agent/thread-history.js');
const { shouldFinalize, rollbackFinalization } = await import('../../../src/agent/utils/idempotent-finalize.js');
const { buildCitationBlocks } = await import('../../../src/listeners/views/citations_block.js');

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
    shouldFinalize.mockReturnValue(true);

    mockSay = jest.fn().mockResolvedValue(undefined);
    mockLogger = { error: jest.fn(), info: jest.fn() };
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

  describe('citation blocks (strict-consistency citations)', () => {
    it('includes citation blocks before feedbackBlock when metadata is READY_TO_FINALIZE with sources', async () => {
      const citationSection = { type: 'section', text: { type: 'mrkdwn', text: '*Sources*' } };
      callLLM.mockResolvedValueOnce({
        metadata_contract_version: 'v1',
        finalize_state: 'ready_to_finalize',
        sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs' }],
        source_index_map: { 'https://docs.ed-fi.org': 1 },
        referenced_citation_indices: new Set([1]),
      });
      buildCitationBlocks.mockReturnValueOnce([citationSection]);

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(buildCitationBlocks).toHaveBeenCalledTimes(1);
      const { blocks } = mockStreamer.stop.mock.calls[0][0];
      expect(blocks[0]).toBe(citationSection);
    });

    it('omits citation blocks when metadata is DEGRADED_NO_METADATA and no sources exist', async () => {
      callLLM.mockResolvedValueOnce({
        metadata_contract_version: 'v1',
        finalize_state: 'degraded_no_metadata',
        sources: [],
        source_index_map: {},
      });

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(buildCitationBlocks).not.toHaveBeenCalled();
      expect(mockStreamer.stop).toHaveBeenCalledTimes(1);
    });

    it('renders citation blocks when metadata is DEGRADED_NO_METADATA but sources are present', async () => {
      const citationSection = { type: 'section', text: { type: 'mrkdwn', text: '*Sources*' } };
      callLLM.mockResolvedValueOnce({
        metadata_contract_version: 'v1',
        finalize_state: 'degraded_no_metadata',
        sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs' }],
        source_index_map: { 'https://docs.ed-fi.org': 1 },
        referenced_citation_indices: new Set([1]),
      });
      buildCitationBlocks.mockReturnValueOnce([citationSection]);

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(buildCitationBlocks).toHaveBeenCalledTimes(1);
      const { blocks } = mockStreamer.stop.mock.calls[0][0];
      expect(blocks[0]).toBe(citationSection);
    });

    it('skips streamer.stop when shouldFinalize returns false', async () => {
      shouldFinalize.mockReturnValueOnce(false);

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(mockStreamer.stop).not.toHaveBeenCalled();
    });

    it('logs citation state and source count when metadata is present', async () => {
      callLLM.mockResolvedValueOnce({
        finalize_state: 'ready_to_finalize',
        sources: [{ url: 'https://a.com' }],
        source_index_map: { 'https://a.com': 1 },
      });

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('[citations]'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('state=ready_to_finalize'));
    });

    it('calls finalizeMetadataEnvelope after streamer.stop', async () => {
      const metadata = {
        finalize_state: 'ready_to_finalize',
        sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs' }],
        source_index_map: { 'https://docs.ed-fi.org': 1 },
      };
      callLLM.mockResolvedValueOnce(metadata);

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(finalizeMetadataEnvelope).toHaveBeenCalledWith(metadata);
    });

    it('passes logger to shouldFinalize', async () => {
      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(shouldFinalize).toHaveBeenCalledWith(expect.any(String), mockLogger);
    });

    it('rolls back finalization when streamer.stop throws', async () => {
      shouldFinalize.mockReturnValueOnce(true);
      mockStreamer.stop.mockRejectedValueOnce(new Error('stop failed'));

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(rollbackFinalization).toHaveBeenCalledWith('C123:1234567890.000000');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('does not roll back when shouldFinalize returns false (no slot was claimed)', async () => {
      shouldFinalize.mockReturnValueOnce(false);

      await messageHandler({
        client: mockClient,
        context: mockContext,
        logger: mockLogger,
        message: mockMessage,
        say: mockSay,
        setStatus: mockSetStatus,
      });

      expect(rollbackFinalization).not.toHaveBeenCalled();
    });
  });
});
