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

const { postEscalation } = await import('../../src/agent/escalation.js');

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
    const replyCall = args.client.chat.postMessage.mock.calls.find((c) => c[0].thread_ts === '111.222');
    expect(replyCall).toBeDefined();
  });

  it('still posts (transcript-only) when the summary fails', async () => {
    mockSummarize.mockResolvedValue(null);
    const args = baseArgs();
    const result = await postEscalation(args);
    expect(result.ok).toBe(true);
    expect(args.client.chat.postMessage).toHaveBeenCalled();
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
