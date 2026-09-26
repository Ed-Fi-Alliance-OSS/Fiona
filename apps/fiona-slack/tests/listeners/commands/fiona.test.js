// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock interaction-store before importing the module under test.
const mockRecordInteraction = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../src/agent/interaction-store.js', () => ({
  recordInteraction: mockRecordInteraction,
}));

// Stub llm-caller: /fiona ask streams a real LLM answer, the other sub-commands must not.
const mockCallLLM = jest.fn().mockResolvedValue({ metadata: null, botText: 'test response', systemPromptVersion: 'v1' });
const mockFinalizeMetadataEnvelope = jest.fn();
jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => ({
  callLLM: mockCallLLM,
  finalizeMetadataEnvelope: mockFinalizeMetadataEnvelope,
  LLM_MODEL: 'test-model',
  SYSTEM_PROMPT_VERSION: 'v1',
  CITATION_POLICY: { METADATA_WAIT_TIMEOUT_MS: 2000 },
}));

jest.unstable_mockModule('../../../src/agent/interaction-telemetry.js', () => ({
  waitForMetadataReady: jest.fn().mockResolvedValue(undefined),
  handleInteractionWithTelemetry: jest.fn(),
}));

const mockCaptureConversation = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../../src/agent/conversation-capture-store.js', () => ({
  captureConversation: mockCaptureConversation,
}));

// Mock search-caller so tests control search results without hitting the LLM.
const mockSearchForSources = jest.fn().mockResolvedValue([]);
const mockFormatSearchResults = jest
  .fn()
  .mockImplementation((_query, sources) => ({
    text: sources.length === 0 ? '🔍 No sources found.' : `🔍 Found ${sources.length} source(s).`,
    blocks: null,
  }));
const MOCK_SEARCH_ERROR_TEXT = ':warning: Search encountered an error. Please try again later.';

jest.unstable_mockModule('../../../src/agent/search-caller.js', () => ({
  searchForSources: mockSearchForSources,
  formatSearchResults: mockFormatSearchResults,
  SEARCH_ERROR_TEXT: MOCK_SEARCH_ERROR_TEXT,
}));

const mockPostEscalation = jest.fn().mockResolvedValue({ ok: true, errorType: null });
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({
  postEscalation: mockPostEscalation,
}));

const mockIsTicketingEnabled = jest.fn();
jest.unstable_mockModule('../../../src/agent/ticket-service.js', () => ({
  isTicketingEnabled: mockIsTicketingEnabled,
}));

const mockBuildTicketModal = jest.fn(() => ({ type: 'modal', callback_id: 'ticket_modal' }));
jest.unstable_mockModule('../../../src/listeners/views/ticket_modal.js', () => ({
  buildTicketModal: mockBuildTicketModal,
}));

const { fionaCommandCallback } = await import('../../../src/listeners/commands/fiona.js');

// Flush microtasks and the setImmediate queue so fire-and-forget Promises settle before assertions.
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

// The AI-217 flags default to off. Suites needing a feature on set it in their
// own beforeEach; clearing here keeps suite ordering from being load-bearing.
afterEach(() => {
  delete process.env.TICKET_CREATION_ENABLED;
  delete process.env.ESCALATION_ENABLED;
});

describe('fionaCommandCallback', () => {
  let mockAck;
  let mockLogger;
  let mockCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCallLLM.mockResolvedValue({ metadata: null, botText: 'test response', systemPromptVersion: 'v1' });
    mockAck = jest.fn().mockResolvedValue(undefined);
    mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
    mockCommand = {
      user_id: 'U12345',
      team_id: 'T99999',
      channel_id: 'C67890',
      trigger_id: 'trigger-abc-123',
      text: 'help',
    };
  });

  describe('help sub-command', () => {
    it('calls ack() exactly once', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
    });

    it('ack() receives a string mentioning Fiona', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('ack() response lists available commands', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Available commands'));
    });

    it('ack() response includes ask command', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('ask <question>'));
    });

    it('ack() response includes search command', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('search <query>'));
    });

    // it('ack() response includes /fiona escalate', async () => {
    //   await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
    //   expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('/fiona escalate'));
    // });

    it('calls recordInteraction with interactionType slash_help', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_help' }),
      );
    });

    it('calls recordInteraction with status success', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success' }),
      );
    });

    it('calls recordInteraction with rateLimited false', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ rateLimited: false }),
      );
    });

    it('calls recordInteraction with threadTs and messageTs equal to trigger_id', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          threadTs: mockCommand.trigger_id,
          messageTs: mockCommand.trigger_id,
        }),
      );
    });

    it('calls recordInteraction with correct userId, teamId, channelId', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'U12345',
          teamId: 'T99999',
          channelId: 'C67890',
        }),
      );
    });

    it('ack() is called before recordInteraction (fire-and-forget ordering)', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockAck.mock.invocationCallOrder[0]).toBeLessThan(
        mockRecordInteraction.mock.invocationCallOrder[0],
      );
    });
  });

  describe('empty sub-command (bare /fiona)', () => {
    it('falls back to help when command.text is empty string', async () => {
      mockCommand.text = '';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('falls back to help when command.text is whitespace only', async () => {
      mockCommand.text = '   ';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('records slash_help on empty input', async () => {
      mockCommand.text = '';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_help' }),
      );
    });
  });

  describe('ask sub-command — empty question falls back to help', () => {
    let mockRespond;
    let mockClient;

    beforeEach(() => {
      mockCommand.text = 'ask';
      mockRespond = jest.fn().mockResolvedValue(undefined);
      mockClient = { chatStream: jest.fn() };
    });

    it('calls ack() exactly once', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
    });

    it('ack() shows the help response when no question is provided', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Available commands'));
    });

    it('does not call callLLM when the question is empty', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('records slash_help telemetry (not slash_ask) when the question is empty', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_help' }),
      );
    });
  });

  describe('ask sub-command — with a question invokes the LLM', () => {
    let mockRespond;
    let mockClient;

    beforeEach(() => {
      mockCommand.text = 'ask What is the Ed-Fi Data Standard?';
      // Own user id: the rate limiter is real and its per-user budget is shared
      // across suites, so spending U12345's on this suite starves the later ones.
      mockCommand.user_id = 'U_ASK_SUITE';
      mockRespond = jest.fn().mockResolvedValue(undefined);
      mockClient = { chatStream: jest.fn() };
      mockCallLLM.mockImplementation(async (sink) => {
        await sink.append({ markdown_text: 'test response' });
        return { metadata: null, botText: 'test response', systemPromptVersion: 'v1' };
      });
    });

    it('calls ack() exactly once with no text argument', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
      expect(mockAck).toHaveBeenCalledWith();
    });

    it('answers ephemerally so the exchange stays private in a public channel', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'ephemeral', text: 'test response' }),
      );
    });

    it('never posts the answer into the channel via chatStream', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockClient.chatStream).not.toHaveBeenCalled();
    });

    it('calls callLLM with the question as a standalone prompt', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
      const [, prompts] = mockCallLLM.mock.calls[0];
      expect(prompts).toEqual([{ role: 'user', content: 'What is the Ed-Fi Data Standard?' }]);
    });

    it('attaches the feedback block to the ephemeral answer', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      const [{ blocks }] = mockRespond.mock.calls[0];
      expect(blocks.at(-1).block_id).toBe('feedback|ask|slash_ask');
      expect(blocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn', text: 'test response' } });
    });

    it('captures the conversation with entryPoint slash_ask', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockCaptureConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          entryPoint: 'slash_ask',
          userMessage: 'What is the Ed-Fi Data Standard?',
          botResponse: 'test response',
        }),
      );
    });

    it('records slash_ask telemetry on success', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_ask', status: 'success', rateLimited: false }),
      );
    });

    it('sends an ephemeral error and records error telemetry when callLLM throws', async () => {
      mockCallLLM.mockRejectedValueOnce(new Error('LLM failure'));
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'ephemeral', text: expect.stringContaining(':warning:') }),
      );
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_ask', status: 'error', errorType: 'llm_failed' }),
      );
    });

    it('does not capture a conversation when the LLM fails', async () => {
      mockCallLLM.mockRejectedValueOnce(new Error('LLM failure'));
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockCaptureConversation).not.toHaveBeenCalled();
    });

    it('sends an ephemeral rate-limit message and records rate-limited telemetry', async () => {
      const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
      for (let i = 0; i < 25; i++) checkRateLimit('U_RL_ASK');
      mockCommand.user_id = 'U_RL_ASK';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockCallLLM).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'ephemeral', text: expect.any(String) }),
      );
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_ask', status: 'error', errorType: 'rate_limited', rateLimited: true }),
      );
    });

    it('logs citation info when metadata is present', async () => {
      mockCallLLM.mockResolvedValueOnce({
        metadata: { finalize_state: 'ready_to_finalize', sources: [{ url: 'https://docs.ed-fi.org' }] },
        botText: 'answer',
        systemPromptVersion: 'v1',
      });
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('[citations]'));
    });
  });

  describe('search sub-command', () => {
    let mockRespond;

    beforeEach(() => {
      jest.clearAllMocks();
      mockRespond = jest.fn().mockResolvedValue(undefined);
      mockSearchForSources.mockResolvedValue([]);
      mockFormatSearchResults.mockImplementation((_q, sources) => ({
        text: sources.length === 0 ? '🔍 No sources found.' : `🔍 Found ${sources.length} source(s).`,
        blocks: null,
      }));
    });

    describe('bare search (no query)', () => {
      beforeEach(() => {
        mockCommand.text = 'search';
      });

      it('falls back to help (ack receives help text)', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
      });

      it('records slash_help when no query is provided', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        await flushMicrotasks();
        expect(mockRecordInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ interactionType: 'slash_help' }),
        );
      });

      it('does not call searchForSources when no query is provided', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockSearchForSources).not.toHaveBeenCalled();
      });
    });

    describe('search with query', () => {
      beforeEach(() => {
        mockCommand.text = 'search Ed-Fi ODS API';
      });

      it('calls ack() without arguments (deferred response)', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockAck).toHaveBeenCalledTimes(1);
        expect(mockAck).toHaveBeenCalledWith();
      });

      it('calls searchForSources with the extracted query', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockSearchForSources).toHaveBeenCalledWith('Ed-Fi ODS API', expect.objectContaining({ logger: mockLogger }));
      });

      it('responds with SEARCH_ERROR_TEXT when searchForSources fails', async () => {
        mockSearchForSources.mockRejectedValueOnce(new Error('Perplexity down'));

        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });

        expect(mockRespond).toHaveBeenCalledWith(
          expect.objectContaining({
            response_type: 'ephemeral',
            text: MOCK_SEARCH_ERROR_TEXT,
          }),
        );
      });

      it('still attaches the feedback block when searchForSources fails', async () => {
        mockSearchForSources.mockRejectedValueOnce(new Error('Perplexity down'));

        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });

        expect(mockRespond).toHaveBeenCalledWith(
          expect.objectContaining({
            blocks: expect.arrayContaining([expect.objectContaining({ block_id: 'feedback|search|slash_search' })]),
          }),
        );
      });

      it('still records slash_search telemetry when searchForSources fails', async () => {
        mockSearchForSources.mockRejectedValueOnce(new Error('Perplexity down'));

        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        await flushMicrotasks();

        expect(mockRecordInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ interactionType: 'slash_search' }),
        );
      });

      it('records status error with errorType search_failed when searchForSources fails', async () => {
        mockSearchForSources.mockRejectedValueOnce(new Error('Perplexity down'));

        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        await flushMicrotasks();

        expect(mockRecordInteraction).toHaveBeenCalledWith(
          expect.objectContaining({
            interactionType: 'slash_search',
            status: 'error',
            errorType: 'search_failed',
          }),
        );
      });

      it('calls respond() with response_type ephemeral', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockRespond).toHaveBeenCalledWith(
          expect.objectContaining({
            response_type: 'ephemeral',
            unfurl_links: false,
            unfurl_media: false,
            blocks: expect.arrayContaining([expect.objectContaining({ block_id: 'feedback|search|slash_search' })]),
          }),
        );
      });

      it('respond() text contains formatted search results', async () => {
        mockSearchForSources.mockResolvedValueOnce([{ url: 'https://docs.ed-fi.org/', title: 'Ed-Fi Docs', hostname: 'docs.ed-fi.org' }]);
        mockFormatSearchResults.mockReturnValueOnce({ text: '🔍 Found 1 source(s).', blocks: null });
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockRespond).toHaveBeenCalledWith(
          expect.objectContaining({ text: '🔍 Found 1 source(s).' }),
        );
      });

      it('records slash_search telemetry', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        await flushMicrotasks();
        expect(mockRecordInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ interactionType: 'slash_search' }),
        );
      });

      it('records slash_search with status success', async () => {
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        await flushMicrotasks();
        expect(mockRecordInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'success' }),
        );
      });

      it('does not call respond() when ack() rejects', async () => {
        mockAck.mockRejectedValueOnce(new Error('slack timeout'));
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockRespond).not.toHaveBeenCalled();
      });

      it('does not throw when respond() rejects', async () => {
        mockRespond.mockRejectedValueOnce(new Error('respond failed'));
        await expect(
          fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger }),
        ).resolves.toBeUndefined();
      });

      it('logs an error when respond() rejects', async () => {
        mockRespond.mockRejectedValueOnce(new Error('respond failed'));
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to respond'));
      });

      it('responds with error text when required fields are missing', async () => {
        const { user_id: _u, ...cmd } = mockCommand;
        cmd.text = 'search Ed-Fi ODS API';
        await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockRespond).toHaveBeenCalledWith(
          expect.objectContaining({ text: MOCK_SEARCH_ERROR_TEXT }),
        );
      });

      it('does not call searchForSources when required fields are missing', async () => {
        const { user_id: _u, ...cmd } = mockCommand;
        cmd.text = 'search Ed-Fi ODS API';
        await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockSearchForSources).not.toHaveBeenCalled();
      });
    });

    describe('search rate limiting', () => {
      it('responds with rate limit message when rate limited', async () => {
        const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
        for (let i = 0; i < 25; i++) checkRateLimit('U_RL_SEARCH');
        const cmd = { ...mockCommand, text: 'search Ed-Fi', user_id: 'U_RL_SEARCH' };
        await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, logger: mockLogger });
        expect(mockRespond).toHaveBeenCalledWith(
          expect.objectContaining({ text: expect.stringContaining('request limit') }),
        );
      });

      it('records slash_search with rateLimited true when rate limited', async () => {
        const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
        for (let i = 0; i < 25; i++) checkRateLimit('U_RL_SEARCH2');
        const cmd = { ...mockCommand, text: 'search Ed-Fi', user_id: 'U_RL_SEARCH2' };
        await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, logger: mockLogger });
        await flushMicrotasks();
        expect(mockRecordInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ interactionType: 'slash_search', rateLimited: true }),
        );
      });
    });
  });

  describe('unknown sub-command fallback', () => {
    it.each([['foo'], ['bar']])(
      'falls back to help for unrecognized sub-command "%s"',
      async (subCommand) => {
        mockCommand.text = subCommand;
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
        expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
      },
    );

    it('records slash_unknown for unknown sub-command', async () => {
      mockCommand.text = 'foo';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_unknown' }),
      );
    });

    it('logs a warning containing the unrecognized sub-command name', async () => {
      mockCommand.text = 'foo';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('foo'));
    });
  });

  describe('resilience', () => {
    it('does not throw when recordInteraction rejects', async () => {
      mockRecordInteraction.mockRejectedValueOnce(new Error('cosmos down'));
      await expect(
        fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('logs a warning when recordInteraction rejects', async () => {
      mockRecordInteraction.mockRejectedValueOnce(new Error('cosmos down'));
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to record'));
    });

    it('does not throw when ack rejects', async () => {
      mockAck.mockRejectedValueOnce(new Error('slack timeout'));
      await expect(
        fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('logs an error when ack rejects', async () => {
      mockAck.mockRejectedValueOnce(new Error('slack timeout'));
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to acknowledge'));
    });
  });

  describe('missing required command fields', () => {
    it('does not throw when user_id is missing', async () => {
      const { user_id: _u, ...cmd } = mockCommand;
      await expect(
        fionaCommandCallback({ command: cmd, ack: mockAck, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('skips recordInteraction when user_id is missing', async () => {
      const { user_id: _u, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).not.toHaveBeenCalled();
    });

    it('does not throw when channel_id is missing', async () => {
      const { channel_id: _c, ...cmd } = mockCommand;
      await expect(
        fionaCommandCallback({ command: cmd, ack: mockAck, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('skips recordInteraction when channel_id is missing', async () => {
      const { channel_id: _c, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).not.toHaveBeenCalled();
    });

    it('does not throw when trigger_id is missing', async () => {
      const { trigger_id: _t, ...cmd } = mockCommand;
      await expect(
        fionaCommandCallback({ command: cmd, ack: mockAck, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('skips recordInteraction when trigger_id is missing', async () => {
      const { trigger_id: _t, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).not.toHaveBeenCalled();
    });

    it('logs a warning when required fields are missing', async () => {
      const { trigger_id: _t, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, logger: mockLogger });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('required'));
    });
  });

  describe('null or undefined command.text', () => {
    it('treats null text the same as empty text', async () => {
      mockCommand.text = null;
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('treats undefined text the same as empty text', async () => {
      delete mockCommand.text;
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });
  });

  describe('escalate sub-command', () => {
    let mockRespond;
    let mockClient;

    beforeEach(() => {
      jest.clearAllMocks();
      // Escalation defaults to off (AI-217); this suite covers the on path.
      process.env.ESCALATION_ENABLED = 'true';
      mockRespond = jest.fn().mockResolvedValue(undefined);
      mockClient = {};
      mockPostEscalation.mockResolvedValue({ ok: true, errorType: null });
    });

    const cmd = (over = {}) => ({
      user_id: 'U1', team_id: 'T1', channel_id: 'C1', trigger_id: 'trig-1', text: 'escalate', ...over,
    });

    it('acks and delegates to postEscalation with source slash_escalate', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(ack).toHaveBeenCalledTimes(1);
      expect(mockPostEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'slash_escalate', userId: 'U1', channelId: 'C1' }),
      );
    });

    it('sends the channel confirmation on success in a channel', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('has been escalated') }),
      );
      // The confirmation should not name a specific channel the user may not see.
      expect(mockRespond.mock.calls[0][0].text).not.toContain('#escalation');
    });

    it('sends the DM confirmation and marks isDm when invoked in a DM', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ channel_id: 'D9', channel_name: 'directmessage' }),
        ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(mockPostEscalation).toHaveBeenCalledWith(expect.objectContaining({ isDm: true }));
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: '✅ A team member will follow up shortly.' }),
      );
    });

    it('sends an ephemeral error when postEscalation fails', async () => {
      mockPostEscalation.mockResolvedValue({ ok: false, errorType: 'post_failed' });
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('could not escalate') }),
      );
    });

    it('does not call postEscalation and warns the user when rate limited', async () => {
      // Exhaust the limiter for this user (default RATE_LIMIT_MAX_REQUESTS=20).
      const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
      for (let i = 0; i < 25; i++) checkRateLimit('U_RL');
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ user_id: 'U_RL' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(mockPostEscalation).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('request limit') }),
      );
    });
  });

  describe('bug/feature sub-commands', () => {
    let mockRespond;
    let mockClient;

    beforeEach(() => {
      jest.clearAllMocks();
      // Ticketing defaults to off (AI-217); this suite covers the on path.
      process.env.TICKET_CREATION_ENABLED = 'true';
      mockIsTicketingEnabled.mockReturnValue(true);
      mockRespond = jest.fn().mockResolvedValue(undefined);
      mockClient = { views: { open: jest.fn().mockResolvedValue({}) } };
    });

    const cmd = (over = {}) => ({
      user_id: 'U_TICKET', team_id: 'T1', channel_id: 'C1', trigger_id: 'trig-1',
      channel_name: 'general', text: 'bug', ...over,
    });

    it('opens the bug modal with trigger_id when enabled', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'bug' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(ack).toHaveBeenCalledTimes(1);
      expect(mockBuildTicketModal).toHaveBeenCalledWith(
        expect.objectContaining({ ticketType: 'bug', channelId: 'C1' }),
      );
      expect(mockClient.views.open).toHaveBeenCalledWith(expect.objectContaining({ trigger_id: 'trig-1' }));
    });

    it('opens the feature modal with trigger_id when enabled', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'feature' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(mockBuildTicketModal).toHaveBeenCalledWith(
        expect.objectContaining({ ticketType: 'feature', channelId: 'C1' }),
      );
      expect(mockClient.views.open).toHaveBeenCalledWith(expect.objectContaining({ trigger_id: 'trig-1' }));
    });

    it('records slash_bug telemetry after opening the modal', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'bug' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_bug' }),
      );
    });

    it('responds not-configured and does not open a modal when disabled', async () => {
      mockIsTicketingEnabled.mockReturnValue(false);
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'feature' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(mockClient.views.open).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringMatching(/not available/i) }),
      );
    });

    it('records slash_feature interaction as an error with errorType not_configured when disabled', async () => {
      mockIsTicketingEnabled.mockReturnValue(false);
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'feature' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      await flushMicrotasks();
      expect(mockClient.views.open).not.toHaveBeenCalled();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionType: 'slash_feature',
          status: 'error',
          errorType: 'not_configured',
        }),
      );
    });

    it('does not throw and responds not-configured when required fields are missing', async () => {
      const { trigger_id: _t, ...cmdWithoutTrigger } = cmd({ text: 'bug' });
      const ack = jest.fn().mockResolvedValue(undefined);
      await expect(
        fionaCommandCallback({
          command: cmdWithoutTrigger, ack, respond: mockRespond, client: mockClient, logger: mockLogger,
        }),
      ).resolves.toBeUndefined();
      expect(mockClient.views.open).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringMatching(/not available/i) }),
      );
    });

    it('does not open a modal and shows the rate-limit message when rate limited', async () => {
      const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
      for (let i = 0; i < 25; i++) checkRateLimit('U_TICKET_RL');
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'bug', user_id: 'U_TICKET_RL' }),
        ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(mockClient.views.open).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('request limit') }),
      );
    });

    it('records slash_bug telemetry with errorType rate_limited when rate limited', async () => {
      const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
      for (let i = 0; i < 25; i++) checkRateLimit('U_TICKET_RL2');
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'bug', user_id: 'U_TICKET_RL2' }),
        ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      await flushMicrotasks();
      expect(mockClient.views.open).not.toHaveBeenCalled();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionType: 'slash_bug',
          status: 'error',
          errorType: 'rate_limited',
          rateLimited: true,
        }),
      );
    });

    it('responds with the transient error text (not the not-available text) when views.open rejects', async () => {
      mockClient.views.open.mockRejectedValueOnce(new Error('slack API timeout'));
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'bug', user_id: 'U_TICKET_ERR' }),
        ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringMatching(/could not create/i) }),
      );
      expect(mockRespond).not.toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringMatching(/not available/i) }),
      );
    });

    // Decided 2026-08-05. Deliberately NOT the neutral 'question' option and no
    // longer 'bug' as the 08-04 spec had it — see the addendum's note.
    it('opens the modal preselected to feature for /fiona ticket', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'ticket' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(ack).toHaveBeenCalledTimes(1);
      expect(mockBuildTicketModal).toHaveBeenCalledWith(
        expect.objectContaining({ ticketType: 'feature', channelId: 'C1' }),
      );
      expect(mockClient.views.open).toHaveBeenCalledWith(expect.objectContaining({ trigger_id: 'trig-1' }));
    });

    // Telemetry records the word the user typed, not a canonical name, so whether
    // anyone still uses the aliases becomes an evidence question later.
    it.each([
      ['ticket', 'slash_ticket'],
      ['bug', 'slash_bug'],
      ['feature', 'slash_feature'],
    ])('records %s as %s', async (text, interactionType) => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(expect.objectContaining({ interactionType }));
    });

    it('records slash_ticket, not slash_bug, when ticket is disabled', async () => {
      mockIsTicketingEnabled.mockReturnValue(false);
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'ticket' }), ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_ticket', status: 'error', errorType: 'not_configured' }),
      );
    });

    it('records slash_ticket with rate_limited when ticket is rate limited', async () => {
      const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');
      for (let i = 0; i < 25; i++) checkRateLimit('U_TICKET_RL3');
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'ticket', user_id: 'U_TICKET_RL3' }),
        ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      await flushMicrotasks();
      expect(mockClient.views.open).not.toHaveBeenCalled();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_ticket', errorType: 'rate_limited', rateLimited: true }),
      );
    });

    it('logs the invoked word, not the ticket type, when views.open rejects', async () => {
      mockClient.views.open.mockRejectedValueOnce(new Error('slack API timeout'));
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ text: 'ticket', user_id: 'U_TICKET_ERR2' }),
        ack, respond: mockRespond, client: mockClient, logger: mockLogger,
      });
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('ticket'));
    });
  });
});

// AI-217. A flagged-off feature disappears: its sub-command stops being routed
// and falls through to handleUnknown, which acks with the help text (which no
// longer lists `ticket`) and records the turn as slash_unknown.
describe('fionaCommandCallback — flagged-off sub-commands', () => {
  let mockAck;
  let mockRespond;
  let mockClient;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ESCALATION_ENABLED;
    delete process.env.TICKET_CREATION_ENABLED;
    mockIsTicketingEnabled.mockReturnValue(true);
    mockAck = jest.fn().mockResolvedValue(undefined);
    mockRespond = jest.fn().mockResolvedValue(undefined);
    mockClient = { views: { open: jest.fn().mockResolvedValue({}) } };
    mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  });

  const cmd = (text) => ({
    user_id: 'U_FLAG', team_id: 'T1', channel_id: 'C1', trigger_id: 'trig-1', channel_name: 'general', text,
  });

  const invoke = (text) =>
    fionaCommandCallback({
      command: cmd(text), ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger,
    });

  it('does not escalate when escalation is off', async () => {
    await invoke('escalate');
    expect(mockPostEscalation).not.toHaveBeenCalled();
  });

  it('acks with the help text instead of escalating', async () => {
    await invoke('escalate');
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockAck.mock.calls[0][0]).toMatch('*Available commands:*');
  });

  it('records the flagged-off escalate as slash_unknown', async () => {
    await invoke('escalate');
    await flushMicrotasks();
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'slash_unknown' }),
    );
  });

  it.each(['ticket', 'bug', 'feature'])('does not open the modal for "%s" when ticketing is off', async (text) => {
    await invoke(text);
    expect(mockClient.views.open).not.toHaveBeenCalled();
  });

  it.each(['ticket', 'bug', 'feature'])('acks with the help text for "%s" when ticketing is off', async (text) => {
    await invoke(text);
    expect(mockAck.mock.calls[0][0]).toMatch('*Available commands:*');
  });

  // The whole point of routing to handleUnknown: help must not name a command
  // that is switched off.
  it('omits the ticket line from the help text it acks with', async () => {
    await invoke('ticket');
    expect(mockAck.mock.calls[0][0]).not.toMatch(/^ticket\b/m);
  });

  it('does not send the not-configured notice — the feature is off, not misconfigured', async () => {
    await invoke('ticket');
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it('still routes escalate once escalation is switched on', async () => {
    process.env.ESCALATION_ENABLED = 'true';
    await invoke('escalate');
    expect(mockPostEscalation).toHaveBeenCalled();
  });

  it('still opens the modal once ticketing is switched on', async () => {
    process.env.TICKET_CREATION_ENABLED = 'true';
    await invoke('bug');
    expect(mockClient.views.open).toHaveBeenCalled();
  });

  it('still serves help when both features are off', async () => {
    await invoke('help');
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockAck.mock.calls[0][0]).toMatch('*Available commands:*');
  });
});
