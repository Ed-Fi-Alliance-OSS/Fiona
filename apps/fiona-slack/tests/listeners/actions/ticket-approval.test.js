// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreateTicketNow = jest.fn();
jest.unstable_mockModule('../../../src/agent/ticket-service.js', () => ({ createTicketNow: mockCreateTicketNow }));

const { ticketApproveActionCallback, ticketDiscardActionCallback } = await import(
  '../../../src/listeners/actions/ticket_approval.js'
);

const logger = { warn: jest.fn(), error: jest.fn() };

function makeArgs() {
  return {
    ack: jest.fn().mockResolvedValue(undefined),
    body: {
      user: { id: 'UAPP' },
      channel: { id: 'C_TRIAGE' },
      message: {
        ts: '1.1',
        metadata: {
          event_type: 'ticket_draft',
          event_payload: {
            ticketType: 'bug',
            summary: 'Broke',
            description: 'd',
            priorityName: 'High',
            bugFields: {},
            requester: { userId: 'U1', teamId: 'T1', channelId: 'C1' },
          },
        },
      },
    },
    client: { chat: { update: jest.fn().mockResolvedValue({}), postMessage: jest.fn().mockResolvedValue({}) } },
    logger,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateTicketNow.mockResolvedValue({ ok: true, key: '#500', url: 'https://github.com/o/r/issues/500', errorType: null });
});

describe('ticketApproveActionCallback', () => {
  it('creates the issue, updates the message, and notifies the requester', async () => {
    const args = makeArgs();
    await ticketApproveActionCallback(args);
    expect(args.ack).toHaveBeenCalled();
    expect(mockCreateTicketNow).toHaveBeenCalledWith(
      expect.objectContaining({ ticketType: 'bug', summary: 'Broke' }),
      expect.objectContaining({ userId: 'U1', channelId: 'C1', source: 'approval_bug' }),
    );
    expect(args.client.chat.update).toHaveBeenCalled();
    const dm = args.client.chat.postMessage.mock.calls[0][0];
    expect(dm.channel).toBe('U1');
    expect(dm.text).toContain('#500');
  });
});

// The failure branch had no coverage at all, and interpolated the raw internal
// errorType into approver-facing copy while inviting a retry that could not work:
// replaceMessage rewrites the message with a single section block, so the
// Approve/Discard buttons are gone by the time the approver reads it.
describe('ticketApproveActionCallback — failure copy', () => {
  const updatedText = (args) => args.client.chat.update.mock.calls[0][0].text;

  const fail = (errorType) =>
    mockCreateTicketNow.mockResolvedValue({ ok: false, key: null, url: null, errorType });

  it.each(['feature_disabled', 'github_auth_failed', 'github_create_failed', 'something_unexpected'])(
    'never leaks the raw errorType "%s" to the approver',
    async (errorType) => {
      fail(errorType);
      const args = makeArgs();
      await ticketApproveActionCallback(args);
      expect(updatedText(args)).not.toContain(errorType);
    },
  );

  it.each(['feature_disabled', 'github_auth_failed', 'github_create_failed', 'something_unexpected'])(
    'does not invite a retry for "%s" — the buttons are already gone',
    async (errorType) => {
      fail(errorType);
      const args = makeArgs();
      await ticketApproveActionCallback(args);
      expect(updatedText(args)).not.toMatch(/try again/i);
    },
  );

  it.each(['feature_disabled', 'github_auth_failed', 'github_create_failed', 'something_unexpected'])(
    'states that nothing was created for "%s"',
    async (errorType) => {
      fail(errorType);
      const args = makeArgs();
      await ticketApproveActionCallback(args);
      expect(updatedText(args)).toMatch(/nothing was created/i);
    },
  );

  it('says the feature is disabled, not that something went wrong, for feature_disabled', async () => {
    fail('feature_disabled');
    const args = makeArgs();
    await ticketApproveActionCallback(args);
    expect(updatedText(args)).toMatch(/currently disabled/i);
    expect(updatedText(args)).not.toMatch(/could not create the issue/i);
  });

  it('points at the credentials for github_auth_failed', async () => {
    fail('github_auth_failed');
    const args = makeArgs();
    await ticketApproveActionCallback(args);
    expect(updatedText(args)).toMatch(/credential|token/i);
  });

  it('falls back to generic copy for an errorType it does not know', async () => {
    fail('something_unexpected');
    const args = makeArgs();
    await ticketApproveActionCallback(args);
    expect(updatedText(args)).toMatch(/could not create the issue/i);
  });

  // The approver sees safe copy; operators still need the real cause, so it goes
  // to the log rather than the channel.
  it('logs the raw errorType even though it is not shown', async () => {
    fail('github_create_failed');
    const args = makeArgs();
    await ticketApproveActionCallback(args);
    const logged = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join(' ');
    expect(logged).toContain('github_create_failed');
  });

  it('does not notify the requester when creation failed', async () => {
    fail('github_create_failed');
    const args = makeArgs();
    await ticketApproveActionCallback(args);
    expect(args.client.chat.postMessage).not.toHaveBeenCalled();
  });
});

describe('ticketDiscardActionCallback', () => {
  it('acks and updates the message without creating', async () => {
    const args = makeArgs();
    await ticketDiscardActionCallback(args);
    expect(mockCreateTicketNow).not.toHaveBeenCalled();
    expect(args.client.chat.update).toHaveBeenCalled();
  });
});
