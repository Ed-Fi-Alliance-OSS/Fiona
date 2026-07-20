// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockBuildTicketModal = jest.fn(() => ({ type: 'modal', callback_id: 'ticket_modal' }));
jest.unstable_mockModule('../../../src/listeners/views/ticket_modal.js', () => ({ buildTicketModal: mockBuildTicketModal }));

const { createTicketActionCallback } = await import('../../../src/listeners/actions/create_ticket.js');

const logger = { warn: jest.fn(), error: jest.fn() };
beforeEach(() => jest.clearAllMocks());

describe('createTicketActionCallback', () => {
  it('acks and opens the prefilled modal from the button value', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    const client = { views: { open: jest.fn().mockResolvedValue({}) } };
    const body = {
      trigger_id: 'trig-9',
      actions: [{ action_id: 'create_ticket', value: JSON.stringify({ ticketType: 'feature', channelId: 'C1', threadTs: '9.9' }) }],
    };
    await createTicketActionCallback({ ack, body, client, logger });
    expect(ack).toHaveBeenCalled();
    expect(mockBuildTicketModal).toHaveBeenCalledWith({ ticketType: 'feature', channelId: 'C1', threadTs: '9.9' });
    expect(client.views.open).toHaveBeenCalledWith(expect.objectContaining({ trigger_id: 'trig-9' }));
  });
});
