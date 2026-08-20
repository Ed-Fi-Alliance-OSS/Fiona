// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock interaction-store before importing the module under test.
const mockRecordInteraction = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../src/agent/interaction-store.js', () => ({
  recordInteraction: mockRecordInteraction,
}));

// Guard: fiona.js must not directly import llm-caller (use search-caller instead).
// This guard intercepts static imports only; dynamic import() calls would bypass it.
jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => {
  throw new Error('llm-caller must not be directly imported by /fiona slash command handlers');
});

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

describe('fionaCommandCallback', () => {
  let mockAck;
  let mockLogger;
  let mockCommand;

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('ask sub-command', () => {
    beforeEach(() => {
      mockCommand.text = 'ask';
    });

    it('calls ack() exactly once', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
    });

    it('ack() response indicates the feature is not yet available', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringMatching(/not yet available|coming soon/i));
    });

    it('ack() response does not show the full help menu', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).not.toHaveBeenCalledWith(expect.stringContaining('Available commands'));
    });

    it('records slash_ask telemetry', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_ask' }),
      );
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
