// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// TICKET_APPROVE_ACTION / TICKET_DISCARD_ACTION are declared in ticket-service.js,
// which renders the buttons carrying them. Declaring them here instead closed an
// import cycle, since that module imports createTicketNow from here.
import { createTicketNow } from '../../agent/ticket-service.js';

function readDraft(body) {
  return body.message?.metadata?.event_payload || null;
}

async function replaceMessage(client, body, text, logger) {
  await client.chat
    .update({
      channel: body.channel.id,
      ts: body.message.ts,
      text,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
    })
    .catch((e) => logger?.warn?.(`Failed to update triage message: ${e.message}`));
}

/** Approve a drafted ticket: create the issue, update the triage message, notify the requester. */
export const ticketApproveActionCallback = async ({ ack, body, client, logger }) => {
  await ack();
  const draft = readDraft(body);
  if (!draft) {
    await replaceMessage(client, body, ':warning: Could not read the draft to approve.', logger);
    return;
  }
  const { requester = {} } = draft;
  const result = await createTicketNow(draft, {
    client,
    userId: requester.userId,
    teamId: requester.teamId,
    channelId: requester.channelId,
    triggerId: `${body.message.ts}-approve`,
    source: `approval_${draft.ticketType}`,
    logger,
  });

  if (result.ok) {
    await replaceMessage(
      client,
      body,
      `:white_check_mark: Approved by <@${body.user.id}> → *<${result.url}|${result.key}>*`,
      logger,
    );
    if (requester.userId) {
      await client.chat
        .postMessage({
          channel: requester.userId,
          text: `:white_check_mark: Your request was approved and created as *<${result.url}|${result.key}>*.`,
        })
        .catch((e) => logger?.warn?.(`Failed to notify requester: ${e.message}`));
    }
  } else {
    await replaceMessage(
      client,
      body,
      `:warning: Approval failed to create the issue (${result.errorType}). Try again.`,
      logger,
    );
  }
};

/** Discard a drafted ticket without creating anything. */
export const ticketDiscardActionCallback = async ({ ack, body, client, logger }) => {
  await ack();
  await replaceMessage(client, body, `:wastebasket: Discarded by <@${body.user.id}>.`, logger);
};
