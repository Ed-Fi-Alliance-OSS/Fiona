// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetUser = jest.fn();
const mockRecordInteraction = jest.fn().mockResolvedValue(undefined);
const mockRecordFeedback = jest.fn().mockResolvedValue(undefined);
const mockSummarize = jest.fn();

jest.unstable_mockModule('../../src/agent/slack-users-store.js', () => ({ getUser: mockGetUser }));
jest.unstable_mockModule('../../src/agent/interaction-store.js', () => ({ recordInteraction: mockRecordInteraction }));
jest.unstable_mockModule('../../src/agent/feedback-store.js', () => ({ recordFeedback: mockRecordFeedback }));
jest.unstable_mockModule('../../src/agent/llm-caller.js', () => ({ summarizeForEscalation: mockSummarize }));

const { postEscalation, escalateViaSay } = await import('../../src/agent/escalation.js');
const { ESCALATE_CONFIRM_TEXT, ESCALATE_DM_TEXT, ESCALATE_ERROR_TEXT } = await import(
  '../../src/listeners/commands/command-handler.js'
);

function makeClient() {
  return {
    conversations: {
      replies: jest.fn().mockResolvedValue({ messages: [
        { user: 'U1', text: 'I need help with the ODS' },
        { bot_id: 'B1', text: 'Here is some info' },
      ] }),
      history: jest.fn().mockResolvedValue({ messages: [
        { bot_id: 'B1', text: 'reply two' },
        { user: 'U1', text: 'message one' },
      ] }),
    },
    chat: {
      postMessage: jest.fn().mockResolvedValue({ ts: '111.222' }),
      getPermalink: jest.fn().mockResolvedValue({ permalink: 'https://slack.test/p1' }),
    },
  };
}

const baseArgs = () => ({
  client: makeClient(),
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '999.000',
  messageTs: '999.000',
  source: 'slash_escalate',
  logger: { warn: jest.fn(), error: jest.fn() },
});

describe('postEscalation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ESCALATION_CHANNEL = 'C_ESCALATE';
    delete process.env.ESCALATION_USERGROUP_ID;
    mockGetUser.mockResolvedValue({ displayName: 'Ada Lovelace' });
    mockSummarize.mockResolvedValue('User is stuck configuring the ODS.');
  });

  it('returns channel_not_configured when ESCALATION_CHANNEL is unset', async () => {
    delete process.env.ESCALATION_CHANNEL;
    const result = await postEscalation(baseArgs());
    expect(result).toEqual({ ok: false, errorType: 'channel_not_configured' });
  });

  it('posts to the configured channel with the display name and a thread link', async () => {
    const args = baseArgs();
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    const post = args.client.chat.postMessage.mock.calls[0][0];
    expect(post.channel).toBe('C_ESCALATE');
    const text = JSON.stringify(post.blocks);
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('https://slack.test/p1');
  });

  it('pings the user group when ESCALATION_USERGROUP_ID is set', async () => {
    process.env.ESCALATION_USERGROUP_ID = 'S123';
    const args = baseArgs();
    await postEscalation(args);
    const post = args.client.chat.postMessage.mock.calls[0][0];
    expect(JSON.stringify(post.blocks)).toContain('<!subteam^S123>');
  });

  it('records to both the interactions and feedback containers', async () => {
    await postEscalation(baseArgs());
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'slash_escalate', status: 'success' }),
    );
    expect(mockRecordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'slash_escalate', value: 'escalation' }),
    );
  });

  it('posts the transcript as a threaded reply to the escalation message', async () => {
    const args = baseArgs();
    await postEscalation(args);
    const primaryTs = (await args.client.chat.postMessage.mock.results[0].value).ts;
    const replyCall = args.client.chat.postMessage.mock.calls.find((c) => c[0].thread_ts === primaryTs);
    expect(replyCall).toBeDefined();
  });

  it('still posts (transcript-only) when the summary fails', async () => {
    mockSummarize.mockResolvedValue(null);
    const args = baseArgs();
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    expect(args.client.chat.postMessage).toHaveBeenCalled();
    expect(JSON.stringify(args.client.chat.postMessage.mock.calls[0][0].blocks)).not.toContain('*Summary:*');
  });

  it('returns post_failed when chat.postMessage throws', async () => {
    const args = baseArgs();
    args.client.chat.postMessage.mockRejectedValueOnce(new Error('not_in_channel'));
    const result = await postEscalation(args);
    expect(result).toEqual({ ok: false, errorType: 'post_failed' });
  });

  it('skips the permalink lookup for DM escalations', async () => {
    const args = { ...baseArgs(), isDm: true, threadTs: null };
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    expect(args.client.chat.getPermalink).not.toHaveBeenCalled();
  });
});

describe('escalateViaSay', () => {
  let mockSay;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ESCALATION_CHANNEL = 'C_ESCALATE';
    delete process.env.ESCALATION_USERGROUP_ID;
    mockGetUser.mockResolvedValue({ displayName: 'Ada Lovelace' });
    mockSummarize.mockResolvedValue('User is stuck configuring the ODS.');
    mockSay = jest.fn().mockResolvedValue(undefined);
  });

  const sayArgs = (over = {}) => ({
    ...baseArgs(),
    source: 'mention_escalate',
    say: mockSay,
    ...over,
  });

  it('posts the escalation and says the channel confirmation on success', async () => {
    const args = sayArgs();
    await escalateViaSay(args);
    expect(args.client.chat.postMessage).toHaveBeenCalled();
    expect(mockSay).toHaveBeenCalledWith(ESCALATE_CONFIRM_TEXT);
  });

  it('says the DM confirmation when isDm is true', async () => {
    await escalateViaSay(sayArgs({ isDm: true, threadTs: null }));
    expect(mockSay).toHaveBeenCalledWith(ESCALATE_DM_TEXT);
  });

  it('delegates to postEscalation with the real thread ts and source', async () => {
    await escalateViaSay(sayArgs({ threadTs: '555.111', messageTs: '555.111' }));
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'mention_escalate', threadTs: '555.111' }),
    );
  });

  it('says the error text and records an escalate error when the channel is unconfigured', async () => {
    delete process.env.ESCALATION_CHANNEL;
    await escalateViaSay(sayArgs());
    expect(mockSay).toHaveBeenCalledWith(ESCALATE_ERROR_TEXT);
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionType: 'mention_escalate',
        status: 'error',
        errorType: 'channel_not_configured',
      }),
    );
  });
});

describe('postEscalation without a thread (slash path)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ESCALATION_CHANNEL = 'C_ESCALATE';
    delete process.env.ESCALATION_USERGROUP_ID;
    mockGetUser.mockResolvedValue({ displayName: 'Ada Lovelace' });
    mockSummarize.mockResolvedValue('should not be used');
  });

  const slashArgs = (over = {}) => ({
    ...baseArgs(),
    threadTs: null,
    messageTs: 'trigger-xyz',
    source: 'slash_escalate',
    ...over,
  });

  it('does not scrape channel history or thread replies when there is no thread', async () => {
    const args = slashArgs();
    await postEscalation(args);
    expect(args.client.conversations.history).not.toHaveBeenCalled();
    expect(args.client.conversations.replies).not.toHaveBeenCalled();
  });

  it('does not attempt a permalink when there is no real message ts', async () => {
    const args = slashArgs();
    await postEscalation(args);
    expect(args.client.chat.getPermalink).not.toHaveBeenCalled();
  });

  it('does not call the summarizer when there is no transcript', async () => {
    await postEscalation(slashArgs());
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('still posts a single context-free escalation and succeeds', async () => {
    const args = slashArgs();
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    expect(args.client.chat.postMessage).toHaveBeenCalledTimes(1);
    const post = args.client.chat.postMessage.mock.calls[0][0];
    expect(JSON.stringify(post.blocks)).toContain('no conversation context');
  });
});
