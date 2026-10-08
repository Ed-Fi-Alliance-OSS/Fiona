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
  ASK_TOO_LONG_TEXT: ':warning: too long',
  buildAskResponse: mockBuildAskResponse,
  describeError: (err) => err.name,
  isQuestionTooLong: (question) => question.length > 3000,
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

const mockSearchForSources = jest.fn();
jest.unstable_mockModule('../../../src/agent/search-caller.js', () => ({
  searchForSources: mockSearchForSources,
  formatSearchResults: (query, sources) => ({ text: `${sources.length} result(s) for ${query}`, blocks: null }),
  SEARCH_ERROR_TEXT: ':warning: search failed',
}));

const { declineOverLongAsk, dispatchKeywordViaSay } = await import(
  '../../../src/listeners/commands/command-dispatch.js'
);
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
  mockSearchForSources.mockResolvedValue([{ title: 'Doc', url: 'https://docs.ed-fi.org' }]);
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
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ask delivery-failure response'));
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

  // AI-250. An error escaping to the telemetry wrapper would post its warning
  // with say(), in front of the whole channel.
  describe('when building the answer throws unexpectedly', () => {
    beforeEach(() => {
      mockBuildAskResponse.mockRejectedValueOnce(new TypeError('boom'));
    });

    it('answers ephemerally instead of letting the error reach the public warning', async () => {
      const params = askCtx();

      await expect(dispatchKeywordViaSay(params)).resolves.toBeUndefined();

      expect(params.say).not.toHaveBeenCalled();
      expect(params.client.chat.postEphemeral).toHaveBeenCalledWith({
        channel: 'C1',
        user: 'U1',
        text: ':warning: ask failed',
      });
    });

    it('records ask_failed and releases the slot so a retry runs again', async () => {
      const params = askCtx();

      await dispatchKeywordViaSay(params);

      expect(params.telemetry.markInteractionError).toHaveBeenCalledWith('ask_failed');
      expect(mockRollbackFinalization).toHaveBeenCalledWith('C1:123.45:123.45');
      expect(mockCapture).not.toHaveBeenCalled();
    });

    it('still clears the thinking status', async () => {
      const params = askCtx();

      await dispatchKeywordViaSay(params);

      expect(params.client.assistant.threads.setStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: '' }),
      );
    });

    it('survives the error notice failing too', async () => {
      const params = askCtx();
      params.client.chat.postEphemeral.mockRejectedValueOnce(new Error('channel_not_found'));

      await expect(dispatchKeywordViaSay(params)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ask error response'));
    });
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

// AI-250. Checked before the rate limit by both say() listeners, so a question
// that will be declined anyway does not spend the user's budget.
describe('declineOverLongAsk', () => {
  const base = (over = {}) => ({
    cmd: { keyword: 'ask', rawArgs: 'x'.repeat(3001) },
    say: jest.fn().mockResolvedValue(undefined),
    client: { chat: { postEphemeral: jest.fn().mockResolvedValue(undefined) } },
    logger,
    userId: 'U1',
    channelId: 'C1',
    threadTs: '100.00',
    messageTs: '200.00',
    interactionType: 'app_mention',
    markInteractionError: jest.fn(),
    ...over,
  });

  it('declines an over-long @-mention ask ephemerally, in its thread', async () => {
    const params = base();

    await expect(declineOverLongAsk(params)).resolves.toBe(true);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledWith({
      channel: 'C1',
      user: 'U1',
      text: ':warning: too long',
      thread_ts: '100.00',
    });
    expect(params.say).not.toHaveBeenCalled();
    expect(params.markInteractionError).toHaveBeenCalledWith('question_too_long');
  });

  it('declines in the assistant panel with say(), which only the user sees', async () => {
    const params = base({ interactionType: 'assistant_message' });

    await declineOverLongAsk(params);

    expect(params.say).toHaveBeenCalledWith({ text: ':warning: too long', thread_ts: '100.00' });
    expect(params.client.chat.postEphemeral).not.toHaveBeenCalled();
  });

  it.each([
    ['a question within the limit', { cmd: { keyword: 'ask', rawArgs: 'x'.repeat(3000) } }],
    ['another keyword', { cmd: { keyword: 'search', rawArgs: 'x'.repeat(5000) } }],
    ['no command at all', { cmd: null }],
  ])('leaves %s alone', async (_label, over) => {
    const params = base(over);

    await expect(declineOverLongAsk(params)).resolves.toBe(false);

    expect(params.client.chat.postEphemeral).not.toHaveBeenCalled();
    expect(params.say).not.toHaveBeenCalled();
    expect(params.markInteractionError).not.toHaveBeenCalled();
  });

  it('still reports the decline when the notice fails to send', async () => {
    const params = base();
    params.client.chat.postEphemeral.mockRejectedValueOnce(new Error('channel_not_found'));

    await expect(declineOverLongAsk(params)).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ask too-long response'));
  });
});

// AI-198 review. Help and search follow ask's fail-closed rule, and a failed
// delivery is recorded rather than counted as a success.
describe('dispatchKeywordViaSay — help and search', () => {
  const kwCtx = (keyword, over = {}) => ({
    ...ctx({ keyword, rawArgs: keyword === 'search' ? 'Data Standard' : '' }, jest.fn().mockResolvedValue(undefined)),
    client: { chat: { postEphemeral: jest.fn().mockResolvedValue(undefined) } },
    interactionType: 'app_mention',
    ...over,
  });

  it.each(['help', 'search'])('answers %s ephemerally, never with say()', async (keyword) => {
    const params = kwCtx(keyword);

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledTimes(1);
    expect(params.say).not.toHaveBeenCalled();
    expect(params.telemetry.markInteractionError).not.toHaveBeenCalled();
  });

  // A surface added later must default to private, as ask already does.
  it.each(['help', 'search'])('keeps %s private on a surface it has not seen before', async (keyword) => {
    const params = kwCtx(keyword, { interactionType: 'some_future_surface' });

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledTimes(1);
    expect(params.say).not.toHaveBeenCalled();
  });

  it.each(['help', 'search'])('answers %s with say() in the assistant panel', async (keyword) => {
    const params = kwCtx(keyword, { interactionType: 'assistant_message' });

    await dispatchKeywordViaSay(params);

    expect(params.say).toHaveBeenCalledTimes(1);
    expect(params.client.chat.postEphemeral).not.toHaveBeenCalled();
  });

  it.each(['help', 'search'])('marks post_failed when the %s ephemeral cannot be posted', async (keyword) => {
    const params = kwCtx(keyword);
    params.client.chat.postEphemeral.mockRejectedValueOnce(new Error('channel_not_found'));

    await expect(dispatchKeywordViaSay(params)).resolves.toBeUndefined();

    expect(params.telemetry.markInteractionError).toHaveBeenCalledWith('post_failed');
  });

  it('marks search_failed when the search itself fails but the notice is delivered', async () => {
    mockSearchForSources.mockRejectedValueOnce(new Error('upstream down'));
    const params = kwCtx('search');

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ text: ':warning: search failed' }),
    );
    expect(params.telemetry.markInteractionError).toHaveBeenCalledWith('search_failed');
  });

  it('marks post_failed, not search_failed, when neither the search nor the notice gets through', async () => {
    mockSearchForSources.mockRejectedValueOnce(new Error('upstream down'));
    const params = kwCtx('search');
    params.client.chat.postEphemeral.mockRejectedValueOnce(new Error('channel_not_found'));

    await dispatchKeywordViaSay(params);

    expect(params.telemetry.markInteractionError).toHaveBeenCalledTimes(1);
    expect(params.telemetry.markInteractionError).toHaveBeenCalledWith('post_failed');
  });

  it.each(['help', 'search'])('omits thread_ts for a top-level %s mention', async (keyword) => {
    const params = kwCtx(keyword);

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral.mock.calls[0][0]).not.toHaveProperty('thread_ts');
  });

  it.each(['help', 'search'])('keeps the %s reply in-thread for a mention inside a thread', async (keyword) => {
    const params = kwCtx(keyword, { threadTs: '100.00', messageTs: '123.45' });

    await dispatchKeywordViaSay(params);

    expect(params.client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', user: 'U1', thread_ts: '100.00' }),
    );
  });
});
