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

describe('ticketDiscardActionCallback', () => {
  it('acks and updates the message without creating', async () => {
    const args = makeArgs();
    await ticketDiscardActionCallback(args);
    expect(mockCreateTicketNow).not.toHaveBeenCalled();
    expect(args.client.chat.update).toHaveBeenCalled();
  });
});
