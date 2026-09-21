// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockEscalateViaSay = jest.fn();
jest.unstable_mockModule('../../../src/agent/escalation.js', () => ({ escalateViaSay: mockEscalateViaSay }));

const mockIsTicketingEnabled = jest.fn();
jest.unstable_mockModule('../../../src/agent/ticket-service.js', () => ({
  isTicketingEnabled: mockIsTicketingEnabled,
}));

const { dispatchKeywordViaSay } = await import('../../../src/listeners/commands/command-dispatch.js');
const { CREATE_TICKET_ACTION, TICKET_NOT_CONFIGURED_TEXT } = await import(
  '../../../src/listeners/commands/command-handler.js'
);

const logger = { warn: jest.fn(), error: jest.fn() };

const ctx = (cmd, say) => ({
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
});

beforeEach(() => {
  jest.clearAllMocks();
  // Set explicitly rather than relying on a jest.fn(impl) default: clearAllMocks
  // does not drain queued once-values, and an implicit default hides which
  // branch a test is exercising.
  mockIsTicketingEnabled.mockReturnValue(true);
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
