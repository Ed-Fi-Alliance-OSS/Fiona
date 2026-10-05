// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockEscalateViaSay = jest.fn();
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({ escalateViaSay: mockEscalateViaSay }));

const mockIsTicketingEnabled = jest.fn();
jest.unstable_mockModule('../../../src/agent/ticket-service.js', () => ({
  isTicketingEnabled: mockIsTicketingEnabled,
}));

const mockBuildAskResponse = jest.fn();
const mockStreamAskResponse = jest.fn().mockResolvedValue(undefined);
const mockCapture = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../../../src/listeners/commands/ask-handler.js', () => ({
  ASK_DELIVERY_FAILED_TEXT: ':warning: could not deliver',
  ASK_ERROR_TEXT: ':warning: ask failed',
  buildAskResponse: mockBuildAskResponse,
  describeError: (err) => err.name,
  streamAskResponse: mockStreamAskResponse,
}));

// Real search would hit the network from the keyword-coverage test below.
jest.unstable_mockModule('../../../src/agent/search-caller.js', () => ({
  searchForSources: jest.fn().mockResolvedValue([]),
  formatSearchResults: jest.fn(() => ({ text: 'no sources', blocks: null })),
  extractSearchQuery: jest.fn(() => null),
  SEARCH_ERROR_TEXT: ':warning: search failed',
}));

const mockGenerateResponseId = jest.fn().mockReturnValue('C1:123.45:123.45');
const mockShouldFinalize = jest.fn().mockReturnValue(true);
const mockRollbackFinalization = jest.fn();
jest.unstable_mockModule('../../../src/agent/utils/idempotent-finalize.js', () => ({
  generateResponseId: mockGenerateResponseId,
  shouldFinalize: mockShouldFinalize,
  rollbackFinalization: mockRollbackFinalization,
}));

const { dispatchKeywordViaSay } = await import('../../../src/listeners/commands/command-dispatch.js');
const { CREATE_TICKET_ACTION, parseCommandKeyword, TICKET_NOT_CONFIGURED_TEXT } = await import(
  '../../../src/listeners/commands/command-handler.js'
);

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

const ctx = (cmd, say) => ({
  cmd,
  say,
  logger,
  telemetry: {
    markInteractionRecorded: jest.fn(),
    markInteractionError: jest.fn(),
    claimResponseId: jest.fn(),
  },
  client: {},
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '123.45',
  messageTs: '123.45',
  source: 'mention_escalate',
});

beforeEach(() => {
  jest.clearAllMocks();
  // Set explicitly rather than relying on a jest.fn(impl) default: clearAllMocks
  // does not drain queued once-values, and an implicit default hides which
  // branch a test is exercising.
  mockIsTicketingEnabled.mockReturnValue(true);
  mockShouldFinalize.mockReturnValue(true);
  mockBuildAskResponse.mockResolvedValue({
    response: { text: 'answer', blocks: [{ type: 'section' }], unfurl_links: false, unfurl_media: false },
    errorType: null,
    capture: mockCapture,
  });
});

// AI-182. The keyword path answers `ask` for real. In a channel the mention is
// visible but the reply is ephemeral; in the private assistant panel it streams
// like any other answer.
describe('dispatchKeywordViaSay — ask', () => {
  const askCtx = (over = {}) => ({
    ...ctx({ keyword: 'ask', rawArgs: 'how do I set up ODS?' }, jest.fn().mockResolvedValue(undefined)),
    client: {
      chat: { postEphemeral: jest.fn().mockResolvedValue(undefined) },
      assistant: { threads: { setStatus: jest.fn().mockResolvedValue(undefined) } },
    },
    interactionType: 'app_mention',
    ...over,
  });

  it('answers an @-mention ephemerally, never with say()', async () => {
    const params = askCtx();

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledTimes(1);
    expect(params.client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', user: 'U1', text: 'answer' }),
    );
    expect(params.say).not.toHaveBeenCalled();
  });

  it('passes the question through without the keyword', async () => {
    const params = askCtx();

    await dispatchKeywordViaSay(params);

    expect(mockBuildAskResponse).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'how do I set up ODS?', interactionType: 'app_mention' }),
    );
    expect(mockGenerateResponseId).toHaveBeenCalledWith('C1', '123.45', '123.45');
    expect(params.telemetry.claimResponseId).toHaveBeenCalledWith('C1:123.45:123.45');
    expect(mockShouldFinalize).toHaveBeenCalledWith('C1:123.45:123.45', logger);
  });

  it('skips duplicate retries before generating or delivering an answer', async () => {
    mockShouldFinalize.mockReturnValueOnce(false);
    const params = askCtx();

    await dispatchKeywordViaSay(params);

    expect(mockBuildAskResponse).not.toHaveBeenCalled();
    expect(params.client.chat.postEphemeral).not.toHaveBeenCalled();
  });

  it('uses the top-level mention timestamp for capture identity but omits it from delivery', async () => {
    // threadTs === messageTs means the mention started the thread rather than
    // landing in one. Capture still needs that timestamp as its conversation
    // identity, while an ephemeral reply to a non-thread must not claim one.
    const params = askCtx();

    await dispatchKeywordViaSay(params);

    expect(mockBuildAskResponse).toHaveBeenCalledWith(expect.objectContaining({ threadTs: '123.45' }));
    expect(params.client.chat.postEphemeral.mock.calls[0][0]).not.toHaveProperty('thread_ts');
  });

  it('keeps the reply in-thread for a mention inside a thread', async () => {
    const params = askCtx({ threadTs: '100.00', messageTs: '200.00' });

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '100.00' }),
    );
  });

  it('marks and logs an ephemeral post failure without throwing', async () => {
    const params = askCtx();
    params.client.chat.postEphemeral.mockRejectedValueOnce(new Error('channel_not_found'));

    await expect(dispatchKeywordViaSay(params)).resolves.toBeUndefined();
    expect(params.telemetry.markInteractionError).toHaveBeenCalledWith('post_failed');
    expect(mockRollbackFinalization).toHaveBeenCalledWith('C1:123.45:123.45');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ephemeral ask'));
  });

  it('tells the user in plain text when the answer cannot be posted', async () => {
    const params = askCtx({ threadTs: '100.00', messageTs: '200.00' });
    params.client.chat.postEphemeral.mockRejectedValueOnce(new Error('invalid_blocks'));

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledTimes(2);
    expect(params.client.chat.postEphemeral.mock.calls[1][0]).toEqual({
      channel: 'C1',
      user: 'U1',
      thread_ts: '100.00',
      text: ':warning: could not deliver',
    });
  });

  it('survives the delivery-failure notice failing too', async () => {
    const params = askCtx();
    params.client.chat.postEphemeral.mockRejectedValue(new Error('channel_not_found'));

    await expect(dispatchKeywordViaSay(params)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('delivery-failure notice'));
  });

  it('captures the conversation only once the answer is posted', async () => {
    const params = askCtx();
    const order = [];
    params.client.chat.postEphemeral.mockImplementationOnce(async () => order.push('post'));
    mockCapture.mockImplementationOnce(async () => order.push('capture'));

    await dispatchKeywordViaSay(params);

    expect(order).toEqual(['post', 'capture']);
  });

  it('does not capture an answer that could not be posted', async () => {
    const params = askCtx();
    params.client.chat.postEphemeral.mockRejectedValueOnce(new Error('channel_not_found'));

    await dispatchKeywordViaSay(params);

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('shows a thinking status while the answer is generated, then clears it', async () => {
    const params = askCtx();
    const statuses = [];
    params.client.assistant.threads.setStatus.mockImplementation(async ({ status }) => statuses.push(status));
    mockBuildAskResponse.mockImplementationOnce(async () => {
      statuses.push('<generating>');
      return { response: { text: 'answer' }, errorType: null, capture: mockCapture };
    });

    await dispatchKeywordViaSay(params);

    expect(statuses).toEqual(['thinking...', '<generating>', '']);
    expect(params.client.assistant.threads.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ channel_id: 'C1', thread_ts: '123.45' }),
    );
  });

  it('clears the thinking status even when generation throws', async () => {
    const params = askCtx();
    mockBuildAskResponse.mockRejectedValueOnce(new Error('boom'));

    await expect(dispatchKeywordViaSay(params)).rejects.toThrow('boom');
    expect(params.client.assistant.threads.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: '' }),
    );
  });

  it('still answers when the thinking status cannot be set', async () => {
    const params = askCtx();
    params.client.assistant.threads.setStatus.mockRejectedValue(new Error('missing_scope'));

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledWith(expect.objectContaining({ text: 'answer' }));
  });

  // Fails closed: only the private assistant panel streams. Anything else,
  // including a caller added later, gets the ephemeral path.
  it.each(['app_mention', 'some_future_surface', undefined])(
    'answers ephemerally for interactionType %p',
    async (interactionType) => {
      const params = askCtx({ interactionType });

      await dispatchKeywordViaSay(params);

      expect(params.client.chat.postEphemeral).toHaveBeenCalledTimes(1);
      expect(mockStreamAskResponse).not.toHaveBeenCalled();
    },
  );

  it('marks a handled ask-generation failure without posting a public warning', async () => {
    mockBuildAskResponse.mockResolvedValueOnce({
      response: { text: ':warning: ask failed', blocks: [], unfurl_links: false, unfurl_media: false },
      errorType: 'llm_failed',
      capture: mockCapture,
    });
    const params = askCtx();

    await dispatchKeywordViaSay(params);

    expect(params.telemetry.markInteractionError).toHaveBeenCalledWith('llm_failed');
    expect(params.client.chat.postEphemeral).toHaveBeenCalledTimes(1);
    expect(params.say).not.toHaveBeenCalled();
  });

  it('streams in the assistant panel instead of posting ephemerally', async () => {
    const params = askCtx({ interactionType: 'assistant_message' });

    await dispatchKeywordViaSay(params);

    expect(mockStreamAskResponse).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'how do I set up ODS?', interactionType: 'assistant_message' }),
    );
    expect(params.client.chat.postEphemeral).not.toHaveBeenCalled();
    expect(mockBuildAskResponse).not.toHaveBeenCalled();
  });

  it('marks a handled failure reported by the streaming path', async () => {
    mockStreamAskResponse.mockResolvedValueOnce({ errorType: 'llm_empty' });
    const params = askCtx({ interactionType: 'assistant_message' });

    await dispatchKeywordViaSay(params);

    expect(params.telemetry.markInteractionError).toHaveBeenCalledWith('llm_empty');
  });

  it('does not escalate or record the turn itself', async () => {
    const params = askCtx();

    await dispatchKeywordViaSay(params);

    expect(mockEscalateViaSay).not.toHaveBeenCalled();
    // The telemetry wrapper records app_mention/assistant_message turns; the ask
    // branch must not suppress that the way escalate does.
    expect(params.telemetry.markInteractionRecorded).not.toHaveBeenCalled();
  });
});

describe('dispatchKeywordViaSay — file_ticket', () => {
  it('offers a Create ticket button in-thread instead of opening a modal', async () => {
    // An app_mention event carries no trigger_id, so views.open is impossible here;
    // the button is what supplies one when clicked.
    const say = jest.fn().mockResolvedValue(undefined);

    await dispatchKeywordViaSay(ctx({ keyword: 'file_ticket', rawArgs: 'bug' }, say));

    expect(say).toHaveBeenCalledTimes(1);
    const arg = say.mock.calls[0][0];
    expect(arg.thread_ts).toBe('123.45');
    const button = arg.blocks.flatMap((b) => b.elements ?? []).find((e) => e.action_id === CREATE_TICKET_ACTION);
    expect(button).toBeTruthy();
    expect(JSON.parse(button.value)).toEqual({ ticketType: 'bug', channelId: 'C1', threadTs: '123.45' });
    expect(mockEscalateViaSay).not.toHaveBeenCalled();
  });

  it('carries the feature type through to the button', async () => {
    const say = jest.fn().mockResolvedValue(undefined);

    await dispatchKeywordViaSay(ctx({ keyword: 'file_ticket', rawArgs: 'feature' }, say));

    const button = say.mock.calls[0][0].blocks.flatMap((b) => b.elements ?? [])[0];
    expect(JSON.parse(button.value).ticketType).toBe('feature');
  });

  it('replies with the not-configured copy instead of offering the button when ticketing is disabled', async () => {
    // docs/github-issue-creation.md promises "the modal is never opened" when
    // unconfigured; offering a button that opens one contradicts that.
    mockIsTicketingEnabled.mockReturnValue(false);
    const say = jest.fn().mockResolvedValue(undefined);

    await dispatchKeywordViaSay(ctx({ keyword: 'file_ticket', rawArgs: 'bug' }, say));

    expect(say).toHaveBeenCalledTimes(1);
    const arg = say.mock.calls[0][0];
    expect(arg.text).toBe(TICKET_NOT_CONFIGURED_TEXT);
    expect(arg.thread_ts).toBe('123.45');
    expect(arg.blocks).toBeUndefined();
  });

  it('warns but does not throw when the offer cannot be posted', async () => {
    const say = jest.fn().mockRejectedValue(new Error('channel_not_found'));

    await expect(dispatchKeywordViaSay(ctx({ keyword: 'file_ticket', rawArgs: 'bug' }, say))).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('channel_not_found'));
  });
});

// routeCommandViaSay answers an unrouted keyword with help and logs an error.
// Every keyword the parser can return must be routed somewhere on purpose.
describe('dispatchKeywordViaSay — keyword coverage', () => {
  const SAMPLE_COMMANDS = ['help', 'escalate', 'ask what is Ed-Fi?', 'search Data Standard', 'file a bug'];

  beforeEach(() => {
    process.env.ESCALATION_ENABLED = 'true';
    process.env.TICKET_CREATION_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.ESCALATION_ENABLED;
    delete process.env.TICKET_CREATION_ENABLED;
  });

  const parsedKeywords = () => SAMPLE_COMMANDS.map((text) => parseCommandKeyword(text)?.keyword);

  it('samples every keyword the parser can return', () => {
    expect(new Set(parsedKeywords())).toEqual(new Set(['help', 'escalate', 'ask', 'search', 'file_ticket']));
  });

  it.each(['app_mention', 'assistant_message'])('routes every keyword on %s without the unrouted fallback', async (interactionType) => {
    for (const text of SAMPLE_COMMANDS) {
      const params = {
        ...ctx(parseCommandKeyword(text), jest.fn().mockResolvedValue(undefined)),
        client: {
          chat: { postEphemeral: jest.fn().mockResolvedValue(undefined) },
          assistant: { threads: { setStatus: jest.fn().mockResolvedValue(undefined) } },
        },
        interactionType,
      };

      await dispatchKeywordViaSay(params);
    }

    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('Unrouted command keyword'));
  });
});
