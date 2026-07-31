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

// Mock llm-caller with proper stubs for the ask handler.
const mockCallLLM = jest.fn().mockResolvedValue({ metadata: null, botText: 'test response', systemPromptVersion: 'v1' });
const mockFinalizeMetadataEnvelope = jest.fn();
jest.unstable_mockModule('../../../src/agent/llm-caller.js', () => ({
  callLLM: mockCallLLM,
  finalizeMetadataEnvelope: mockFinalizeMetadataEnvelope,
  LLM_MODEL: 'sonar-pro',
  SYSTEM_PROMPT_VERSION: 'v1',
  CITATION_POLICY: {
    METADATA_WAIT_TIMEOUT_MS: 2000,
  },
  MetadataLifecycleState: {
    READY_TO_FINALIZE: 'ready_to_finalize',
    FINALIZED: 'finalized',
    DEGRADED_NO_METADATA: 'degraded_no_metadata',
  },
}));

jest.unstable_mockModule('../../../src/agent/interaction-telemetry.js', () => ({
  waitForMetadataReady: jest.fn().mockResolvedValue(undefined),
  handleInteractionWithTelemetry: jest.fn(),
}));

jest.unstable_mockModule('../../../src/agent/conversation-capture-store.js', () => ({
  captureConversation: jest.fn().mockResolvedValue(undefined),
}));

const mockPostEscalation = jest.fn().mockResolvedValue({ ok: true, errorType: null });
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({
  postEscalation: mockPostEscalation,
}));
const { fionaCommandCallback } = await import('../../../src/listeners/commands/fiona.js');
const { checkRateLimit } = await import('../../../src/agent/rate-limiter.js');

// Flush microtasks and the setImmediate queue so fire-and-forget Promises settle before assertions.
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('fionaCommandCallback', () => {
  let mockAck;
  let mockRespond;
  let mockClient;
  let mockLogger;
  let mockCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCallLLM.mockResolvedValue({ metadata: null, botText: 'test response', systemPromptVersion: 'v1' });
    mockAck = jest.fn().mockResolvedValue(undefined);
    mockRespond = jest.fn().mockResolvedValue(undefined);
    mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
    mockClient = {
      chatStream: jest.fn().mockReturnValue({
        append: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
      }),
    };
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
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
    });

    it('ack() receives a string mentioning Fiona', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('ack() response lists available commands', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Available commands'));
    });

    it('ack() response includes ask command', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('ask <question>'));
    });

    it('ack() response includes search command', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('search <query>'));
    });

    // it('ack() response includes /fiona escalate', async () => {
    //   await fionaCommandCallback({ command: mockCommand, ack: mockAck, logger: mockLogger });
    //   expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('/fiona escalate'));
    // });

    it('calls recordInteraction with interactionType slash_help', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_help' }),
      );
    });

    it('calls recordInteraction with status success', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success' }),
      );
    });

    it('calls recordInteraction with rateLimited false', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ rateLimited: false }),
      );
    });

    it('calls recordInteraction with threadTs and messageTs equal to trigger_id', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          threadTs: mockCommand.trigger_id,
          messageTs: mockCommand.trigger_id,
        }),
      );
    });

    it('calls recordInteraction with correct userId, teamId, channelId', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
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
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockAck.mock.invocationCallOrder[0]).toBeLessThan(
        mockRecordInteraction.mock.invocationCallOrder[0],
      );
    });
  });

  describe('empty sub-command (bare /fiona)', () => {
    it('falls back to help when command.text is empty string', async () => {
      mockCommand.text = '';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('falls back to help when command.text is whitespace only', async () => {
      mockCommand.text = '   ';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('records slash_help on empty input', async () => {
      mockCommand.text = '';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_help' }),
      );
    });
  });

  describe('ask sub-command — empty question falls back to help', () => {
    beforeEach(() => {
      mockCommand.text = 'ask';
    });

    it('calls ack() exactly once', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
    });

    it('ack() shows the help response when no question is provided', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('ack() response includes the available commands list', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Available commands'));
    });

    it('does not call callLLM when question is empty', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('records slash_help telemetry (not slash_ask) when question is empty', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_help' }),
      );
    });
  });

  describe('ask sub-command — with a question invokes LLM', () => {
    beforeEach(() => {
      mockCommand.text = 'ask What is the Ed-Fi Data Standard?';
    });

    it('calls ack() exactly once with no text argument', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
      expect(mockAck).toHaveBeenCalledWith();
    });

    it('calls client.chatStream with the user and channel ids', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockClient.chatStream).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: mockCommand.channel_id,
          recipient_user_id: mockCommand.user_id,
          recipient_team_id: mockCommand.team_id,
        }),
      );
    });

    it('calls callLLM with the question as a standalone prompt', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
      const [, prompts] = mockCallLLM.mock.calls[0];
      expect(prompts).toEqual([{ role: 'user', content: 'What is the Ed-Fi Data Standard?' }]);
    });

    it('stops the streamer after callLLM resolves', async () => {
      const mockStreamer = { append: jest.fn(), stop: jest.fn().mockResolvedValue(undefined) };
      mockClient.chatStream.mockReturnValue(mockStreamer);
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockStreamer.stop).toHaveBeenCalledTimes(1);
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
        expect.objectContaining({ interactionType: 'slash_ask', status: 'error' }),
      );
    });

    it('sends an ephemeral rate-limit message and records rate-limited telemetry when user is over limit', async () => {
      for (let i = 0; i < 25; i++) checkRateLimit('U_RL_ASK');
      mockCommand.user_id = 'U_RL_ASK';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockCallLLM).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ response_type: 'ephemeral', text: expect.stringContaining('request limit') }),
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
    beforeEach(() => {
      mockCommand.text = 'search';
    });

    it('calls ack() exactly once', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledTimes(1);
    });

    it('ack() response indicates the feature is not yet available', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringMatching(/not yet available|coming soon/i));
    });

    it('ack() response does not show the full help menu', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).not.toHaveBeenCalledWith(expect.stringContaining('Available commands'));
    });

    it('records slash_search telemetry', async () => {
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
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
        await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
        expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
      },
    );

    it('records slash_unknown for unknown sub-command', async () => {
      mockCommand.text = 'foo';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ interactionType: 'slash_unknown' }),
      );
    });

    it('logs a warning containing the unrecognized sub-command name', async () => {
      mockCommand.text = 'foo';
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('foo'));
    });
  });

  describe('resilience', () => {
    it('does not throw when recordInteraction rejects', async () => {
      mockRecordInteraction.mockRejectedValueOnce(new Error('cosmos down'));
      await expect(
        fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('logs a warning when recordInteraction rejects', async () => {
      mockRecordInteraction.mockRejectedValueOnce(new Error('cosmos down'));
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to record'));
    });

    it('does not throw when ack rejects', async () => {
      mockAck.mockRejectedValueOnce(new Error('slack timeout'));
      await expect(
        fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('logs an error when ack rejects', async () => {
      mockAck.mockRejectedValueOnce(new Error('slack timeout'));
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to acknowledge'));
    });
  });

  describe('missing required command fields', () => {
    it('does not throw when user_id is missing', async () => {
      const { user_id: _u, ...cmd } = mockCommand;
      await expect(
        fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('skips recordInteraction when user_id is missing', async () => {
      const { user_id: _u, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).not.toHaveBeenCalled();
    });

    it('does not throw when channel_id is missing', async () => {
      const { channel_id: _c, ...cmd } = mockCommand;
      await expect(
        fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('skips recordInteraction when channel_id is missing', async () => {
      const { channel_id: _c, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).not.toHaveBeenCalled();
    });

    it('does not throw when trigger_id is missing', async () => {
      const { trigger_id: _t, ...cmd } = mockCommand;
      await expect(
        fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger }),
      ).resolves.toBeUndefined();
    });

    it('skips recordInteraction when trigger_id is missing', async () => {
      const { trigger_id: _t, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      await flushMicrotasks();
      expect(mockRecordInteraction).not.toHaveBeenCalled();
    });

    it('logs a warning when required fields are missing', async () => {
      const { trigger_id: _t, ...cmd } = mockCommand;
      await fionaCommandCallback({ command: cmd, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('required'));
    });
  });

  describe('null or undefined command.text', () => {
    it('treats null text the same as empty text', async () => {
      mockCommand.text = null;
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });

    it('treats undefined text the same as empty text', async () => {
      delete mockCommand.text;
      await fionaCommandCallback({ command: mockCommand, ack: mockAck, respond: mockRespond, client: mockClient, logger: mockLogger });
      expect(mockAck).toHaveBeenCalledWith(expect.stringContaining('Fiona'));
    });
  });

  describe('escalate sub-command', () => {
    let mockClient2;

    beforeEach(() => {
      mockClient2 = {};
      mockPostEscalation.mockResolvedValue({ ok: true, errorType: null });
    });

    const cmd = (over = {}) => ({
      user_id: 'U1', team_id: 'T1', channel_id: 'C1', trigger_id: 'trig-1', text: 'escalate', ...over,
    });

    it('acks and delegates to postEscalation with source slash_escalate', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient2, logger: mockLogger });
      expect(ack).toHaveBeenCalledTimes(1);
      expect(mockPostEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'slash_escalate', userId: 'U1', channelId: 'C1' }),
      );
    });

    it('sends the channel confirmation on success in a channel', async () => {
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient2, logger: mockLogger });
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
        ack, respond: mockRespond, client: mockClient2, logger: mockLogger,
      });
      expect(mockPostEscalation).toHaveBeenCalledWith(expect.objectContaining({ isDm: true }));
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: '✅ A team member will follow up shortly.' }),
      );
    });

    it('sends an ephemeral error when postEscalation fails', async () => {
      mockPostEscalation.mockResolvedValue({ ok: false, errorType: 'post_failed' });
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({ command: cmd(), ack, respond: mockRespond, client: mockClient2, logger: mockLogger });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('could not escalate') }),
      );
    });

    it('does not call postEscalation and warns the user when rate limited', async () => {
      // Exhaust the limiter for this user (default RATE_LIMIT_MAX_REQUESTS=20).
      for (let i = 0; i < 25; i++) checkRateLimit('U_RL');
      const ack = jest.fn().mockResolvedValue(undefined);
      await fionaCommandCallback({
        command: cmd({ user_id: 'U_RL' }), ack, respond: mockRespond, client: mockClient2, logger: mockLogger,
      });
      expect(mockPostEscalation).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('request limit') }),
      );
    });
  });
});
