// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockEscalateViaSay = jest.fn();
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({ escalateViaSay: mockEscalateViaSay }));

const { dispatchKeywordViaSay } = await import('../../../src/listeners/commands/command-dispatch.js');

const logger = { warn: jest.fn(), error: jest.fn() };

const ctx = (cmd, say, extra = {}) => ({
  cmd,
  say,
  logger,
  markInteractionRecorded: jest.fn(),
  client: {},
  userId: 'U1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '123.45',
  messageTs: '123.45',
  source: 'mention_escalate',
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe('dispatchKeywordViaSay — threading', () => {
  // Regression: help/ask/search fell through to routeCommandViaSay without threadTs,
  // so Slack posted the reply to the channel instead of the thread it was asked in.
  it.each([
    ['help', ''],
    ['ask', 'how do I set up the ODS?'],
    ['search', 'Data Standard'],
  ])('posts the %s response into the originating thread', async (keyword, rawArgs) => {
    const say = jest.fn().mockResolvedValue(undefined);

    await dispatchKeywordViaSay(ctx({ keyword, rawArgs }, say));

    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0]).toEqual(expect.objectContaining({ thread_ts: '123.45' }));
  });
});

describe('dispatchKeywordViaSay — private replies', () => {
  it('prefers replyPrivately over say for command responses', async () => {
    const say = jest.fn().mockResolvedValue(undefined);
    const replyPrivately = jest.fn().mockResolvedValue(undefined);

    await dispatchKeywordViaSay(ctx({ keyword: 'help', rawArgs: '' }, say, { replyPrivately }));

    expect(replyPrivately).toHaveBeenCalledTimes(1);
    expect(replyPrivately.mock.calls[0][0].text).toContain('Available commands');
    expect(say).not.toHaveBeenCalled();
  });

  it('falls back to say when no private reply is available (agent panel)', async () => {
    const say = jest.fn().mockResolvedValue(undefined);

    await dispatchKeywordViaSay(ctx({ keyword: 'help', rawArgs: '' }, say));

    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][0].text).toContain('Available commands');
  });

  it('still routes escalate through say, not the private reply', async () => {
    const say = jest.fn().mockResolvedValue(undefined);
    const replyPrivately = jest.fn().mockResolvedValue(undefined);

    await dispatchKeywordViaSay(ctx({ keyword: 'escalate', rawArgs: '' }, say, { replyPrivately }));

    expect(mockEscalateViaSay).toHaveBeenCalledTimes(1);
    expect(replyPrivately).not.toHaveBeenCalled();
  });
});
