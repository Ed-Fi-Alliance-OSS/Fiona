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

// Approver-facing copy for a failed approval, keyed by the errorType returned by
// createTicketNow.
//
// Two rules this copy has to obey, both learned from the message it replaces
// (":warning: Approval failed to create the issue (${result.errorType}). Try
// again."):
//
//  1. Never interpolate errorType. These are internal categories, not English,
//     and the triage channel is read by people who did not write them. The raw
//     value still reaches operators via the log line below.
//  2. Never invite a retry. replaceMessage rewrites the message with a single
//     section block, so the Approve/Discard buttons are gone by the time anyone
//     reads the failure — "Try again" points at a button that no longer exists.
//     `feature_disabled` could not be retried anyway while the flag is off.
//
// Every message says nothing was created, because the draft is destroyed by the
// same update that reports the failure and the request would otherwise look like
// it might still be in flight.
const APPROVAL_FAILURE_TEXT = {
  feature_disabled:
    ':warning: Ticket creation is currently disabled, so this draft could not be approved. Nothing was created.',
  github_auth_failed:
    ':warning: Could not create the issue — GitHub rejected the credentials. Nothing was created; an administrator needs to check the issue-creation token.',
  github_create_failed:
    ':warning: Could not create the issue. Nothing was created — check the Fiona logs for the cause.',
};

const GENERIC_APPROVAL_FAILURE_TEXT = APPROVAL_FAILURE_TEXT.github_create_failed;

/** Safe approver-facing copy for `errorType`, falling back to generic wording. */
function approvalFailureText(errorType) {
  return APPROVAL_FAILURE_TEXT[errorType] ?? GENERIC_APPROVAL_FAILURE_TEXT;
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
    // The approver sees safe copy; operators need the real category, so it goes
    // to the log instead of the channel.
    logger?.error?.(`Approval failed to create the issue (${result.errorType}) in ${body.channel.id}`);
    await replaceMessage(client, body, approvalFailureText(result.errorType), logger);
  }
};

/** Discard a drafted ticket without creating anything. */
export const ticketDiscardActionCallback = async ({ ack, body, client, logger }) => {
  await ack();
  await replaceMessage(client, body, `:wastebasket: Discarded by <@${body.user.id}>.`, logger);
};
