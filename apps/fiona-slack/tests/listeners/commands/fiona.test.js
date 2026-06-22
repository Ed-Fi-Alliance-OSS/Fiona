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

// Enforce the "no LLM call" requirement by failing if the handler imports llm-caller.
// This guard intercepts static imports only; dynamic import() calls would bypass it.
// Acceptable trade-off: slash command handlers should never dynamically import the LLM.
jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => {
  throw new Error('llm-caller must not be imported by /fiona slash command handlers');
});

const mockPostEscalation = jest.fn().mockResolvedValue({ ok: true, errorType: null });
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({
  postEscalation: mockPostEscalation,
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

    it('ack() response includes /fiona help', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('/fiona help'));
    });

    it('ack() response includes /fiona ask', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('/fiona ask'));
    });

    it('ack() response includes /fiona search', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('/fiona search'));
    });

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
      expect(mockAck).not.toHaveBeenCalledWith(expect.stringContaining('/fiona help'));
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
    beforeEach(() => {
      mockCommand.text = 'search';
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
      expect(mockAck).not.toHaveBeenCalledWith(expect.stringContaining('/fiona help'));
    });

    it('records slash_search telemetry', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_search' }),
      );
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
        expect.objectContaining({ text: expect.stringContaining('escalated to #escalation') }),
      );
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
});
