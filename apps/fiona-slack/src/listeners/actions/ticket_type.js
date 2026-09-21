// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { buildTicketModal, readPrefill, readTicketType } from '../views/ticket_modal.js';

/**
 * Handles a change to the modal's Type dropdown.
 *
 * The Type select sits in an input block with `dispatch_action: true`, so
 * selecting a value emits block_actions while still contributing to
 * `view.state.values` on submit. Verified live in Slack on 2026-08-05.
 *
 * Summary, Description and Priority are carried forward explicitly rather than
 * relying on Slack's value preservation: that is documented for identical input
 * blocks, and ours are not identical — the placeholders change with the type.
 *
 * A failed update is logged and otherwise ignored. The user keeps the previous
 * field set, and submit still reads the type from live view state, so the worst
 * outcome is a bug filed with three empty optional fields.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<void>} params.ack
 * @param {import("@slack/bolt").BlockAction} params.body
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {import("@slack/logger").Logger} params.logger
 */
export const ticketTypeActionCallback = async ({ ack, body, client, logger }) => {
  await ack();
  try {
    const view = body.view;
    const { channelId, threadTs } = JSON.parse(view.private_metadata || '{}');
    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: buildTicketModal({
        ticketType: readTicketType(view),
        channelId,
        threadTs,
        prefill: readPrefill(view),
      }),
    });
  } catch (err) {
    logger?.error?.(`Failed to update ticket modal on type change: ${err.message}`);
  }
};
