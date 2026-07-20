// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { buildTicketModal } from '../views/ticket_modal.js';

/**
 * Handles the conversational "Create ticket" button. Opens the ticket modal
 * pre-scoped to the ticket type and originating location.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack
 * @param {import("@slack/bolt").BlockAction} params.body
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {import("@slack/logger").Logger} params.logger
 */
export const createTicketActionCallback = async ({ ack, body, client, logger }) => {
  await ack();
  try {
    const action = Array.isArray(body.actions) ? body.actions[0] : null;
    const { ticketType, channelId, threadTs } = JSON.parse(action?.value || '{}');
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildTicketModal({ ticketType, channelId, threadTs }),
    });
  } catch (err) {
    logger?.error?.(`Failed to open ticket modal from button: ${err.message}`);
  }
};
