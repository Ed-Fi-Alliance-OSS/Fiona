// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockBuildTicketModal = jest.fn(() => ({ type: 'modal', callback_id: 'ticket_modal' }));
const mockReadTicketType = jest.fn(() => 'feature');
const mockReadPrefill = jest.fn(() => ({ summary: 'It broke', description: 'on save', priority: 'Urgent' }));

jest.unstable_mockModule('../../../src/listeners/views/ticket_modal.js', () => ({
  buildTicketModal: mockBuildTicketModal,
  readTicketType: mockReadTicketType,
  readPrefill: mockReadPrefill,
  TICKET_TYPE_ACTION: 'ticket_type_input',
}));

const { ticketTypeActionCallback } = await import('../../../src/listeners/actions/ticket_type.js');

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

const makeArgs = (over = {}) => ({
  ack: jest.fn().mockResolvedValue(undefined),
  body: {
    view: {
      id: 'V123',
      hash: 'hash-abc',
      private_metadata: JSON.stringify({ channelId: 'C1', threadTs: '9.9' }),
      state: { values: {} },
    },
  },
  client: { views: { update: jest.fn().mockResolvedValue({}) } },
  logger,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReadTicketType.mockReturnValue('feature');
  mockReadPrefill.mockReturnValue({ summary: 'It broke', description: 'on save', priority: 'Urgent' });
  mockBuildTicketModal.mockReturnValue({ type: 'modal', callback_id: 'ticket_modal' });
});

describe('ticketTypeActionCallback', () => {
  it('acks before calling views.update', async () => {
    const args = makeArgs();

    await ticketTypeActionCallback(args);

    expect(args.ack).toHaveBeenCalledTimes(1);
    expect(args.ack.mock.invocationCallOrder[0]).toBeLessThan(
      args.client.views.update.mock.invocationCallOrder[0],
    );
  });

  // views.update rejects without both of these; hash is what makes the update
  // conditional on the view not having moved on.
  it('updates the view by id and hash', async () => {
    const args = makeArgs();

    await ticketTypeActionCallback(args);

    expect(args.client.views.update).toHaveBeenCalledWith(
      expect.objectContaining({ view_id: 'V123', hash: 'hash-abc' }),
    );
  });

  it('rebuilds the modal with the newly selected type and the carried-forward values', async () => {
    const args = makeArgs();

    await ticketTypeActionCallback(args);

    expect(mockBuildTicketModal).toHaveBeenCalledWith({
      ticketType: 'feature',
      channelId: 'C1',
      threadTs: '9.9',
      prefill: { summary: 'It broke', description: 'on save', priority: 'Urgent' },
    });
  });

  it('passes the rebuilt view through to views.update', async () => {
    const rebuilt = { type: 'modal', callback_id: 'ticket_modal', blocks: [] };
    mockBuildTicketModal.mockReturnValue(rebuilt);
    const args = makeArgs();

    await ticketTypeActionCallback(args);

    expect(args.client.views.update.mock.calls[0][0].view).toBe(rebuilt);
  });

  it('still rebuilds when private_metadata is empty', async () => {
    const args = makeArgs();
    args.body.view.private_metadata = '';

    await ticketTypeActionCallback(args);

    expect(mockBuildTicketModal).toHaveBeenCalledWith(
      expect.objectContaining({ ticketType: 'feature', channelId: undefined, threadTs: undefined }),
    );
    expect(args.client.views.update).toHaveBeenCalled();
  });

  // Degradation is deliberately benign: the user keeps the previous field set and
  // submit still reads the type from live state.
  it('does not throw and logs when private_metadata is unparseable', async () => {
    const args = makeArgs();
    args.body.view.private_metadata = '{not json';

    await expect(ticketTypeActionCallback(args)).resolves.toBeUndefined();

    expect(args.client.views.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to update ticket modal'));
  });

  it('does not throw and logs when views.update rejects on a stale hash', async () => {
    const args = makeArgs();
    args.client.views.update.mockRejectedValueOnce(new Error('hash_conflict'));

    await expect(ticketTypeActionCallback(args)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('hash_conflict'));
  });

  it('acks even when the rebuild throws, so Slack does not show an operation-failed error', async () => {
    mockBuildTicketModal.mockImplementation(() => {
      throw new Error('build blew up');
    });
    const args = makeArgs();

    await expect(ticketTypeActionCallback(args)).resolves.toBeUndefined();

    expect(args.ack).toHaveBeenCalledTimes(1);
  });
});
