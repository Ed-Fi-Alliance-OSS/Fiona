// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { submitTicket } from '../../agent/ticket-service.js';
import {
  normalizeTicketType,
  TICKET_CREATED_TEXT,
  TICKET_ERROR_TEXT,
  TICKET_NOT_CONFIGURED_TEXT,
} from '../commands/command-handler.js';

export const TICKET_MODAL_CALLBACK = 'ticket_modal';
// Must match the GitHub org `Priority` single-select options exactly: the selected
// value is resolved to an option node id by name at issue-creation time.
export const PRIORITY_OPTIONS = ['Urgent', 'High', 'Medium', 'Low'];
const DEFAULT_PRIORITY = 'Medium';

const plainText = (text) => ({ type: 'plain_text', text });

function textInput({ blockId, actionId, label, multiline, optional, initialValue, placeholder }) {
  const element = { type: 'plain_text_input', action_id: actionId, multiline: Boolean(multiline), max_length: 3000 };
  if (initialValue) element.initial_value = initialValue;
  if (placeholder) element.placeholder = plainText(placeholder);
  return { type: 'input', block_id: blockId, optional: Boolean(optional), label: plainText(label), element };
}

function priorityBlock() {
  const options = PRIORITY_OPTIONS.map((name) => ({ text: plainText(name), value: name }));
  return {
    type: 'input',
    block_id: 'priority_block',
    label: plainText('Priority'),
    element: {
      type: 'static_select',
      action_id: 'priority_input',
      options,
      initial_option: options.find((o) => o.value === DEFAULT_PRIORITY),
    },
  };
}

/**
 * Build the ticket modal view. Field set depends on ticketType.
 * @param {{ ticketType: 'bug'|'feature', channelId?: string, threadTs?: string, prefill?: { summary?: string, description?: string } }} params
 */
export function buildTicketModal({ ticketType, channelId, threadTs, prefill = {} }) {
  const isBug = ticketType === 'bug';
  const blocks = [
    textInput({
      blockId: 'summary_block',
      actionId: 'summary_input',
      label: 'Summary',
      initialValue: prefill.summary,
      placeholder: isBug ? 'Short description of the bug' : 'Short description of the feature',
    }),
    textInput({
      blockId: 'description_block',
      actionId: 'description_input',
      label: 'Description',
      multiline: true,
      initialValue: prefill.description,
      placeholder: isBug ? 'What happened?' : 'What would you like and why?',
    }),
    priorityBlock(),
  ];

  if (isBug) {
    blocks.push(
      textInput({
        blockId: 'steps_block',
        actionId: 'steps_input',
        label: 'Steps to reproduce',
        multiline: true,
        optional: true,
      }),
      textInput({
        blockId: 'expected_block',
        actionId: 'expected_input',
        label: 'Expected vs actual',
        multiline: true,
        optional: true,
      }),
      textInput({ blockId: 'env_block', actionId: 'env_input', label: 'Environment / version', optional: true }),
    );
  }

  return {
    type: 'modal',
    callback_id: TICKET_MODAL_CALLBACK,
    title: plainText(isBug ? 'Report a bug' : 'Request a feature'),
    submit: plainText('Create issue'),
    close: plainText('Cancel'),
    private_metadata: JSON.stringify({ ticketType, channelId, threadTs }),
    blocks,
  };
}

function readValue(view, blockId, actionId) {
  return view.state.values?.[blockId]?.[actionId]?.value?.trim() || '';
}

/**
 * Handle the ticket modal submission: assemble the payload, create/queue the
 * issue via the service, and DM the invoking user the outcome.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack
 * @param {import("@slack/bolt").SlackViewAction} params.body
 * @param {import("@slack/bolt").ViewOutput} params.view
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {import("@slack/logger").Logger} params.logger
 */
export const ticketModalSubmitCallback = async ({ ack, body, view, client, logger }) => {
  await ack();
  const userId = body.user?.id;
  try {
    const { ticketType: rawTicketType, channelId } = JSON.parse(view.private_metadata || '{}');
    // private_metadata is client-supplied; normalize rather than trust it.
    const ticketType = normalizeTicketType(rawTicketType);
    const payload = {
      ticketType,
      summary: readValue(view, 'summary_block', 'summary_input'),
      description: readValue(view, 'description_block', 'description_input'),
      priorityName: view.state.values?.priority_block?.priority_input?.selected_option?.value || DEFAULT_PRIORITY,
      bugFields:
        ticketType === 'bug'
          ? {
              stepsToReproduce: readValue(view, 'steps_block', 'steps_input'),
              expectedActual: readValue(view, 'expected_block', 'expected_input'),
              environment: readValue(view, 'env_block', 'env_input'),
            }
          : {},
    };

    const result = await submitTicket(payload, {
      client,
      userId,
      teamId: body.team?.id,
      channelId,
      triggerId: `${userId}-${Date.now()}`,
      source: `modal_${ticketType}`,
      logger,
    });

    let text = TICKET_ERROR_TEXT;
    if (result.mode === 'created') text = TICKET_CREATED_TEXT(result.key, result.url);
    else if (result.mode === 'queued_for_approval')
      text = ':hourglass_flowing_sand: Your request was sent for review. The team will follow up.';
    else if (result.mode === 'not_configured') text = TICKET_NOT_CONFIGURED_TEXT;

    await client.chat.postMessage({ channel: userId, text });
  } catch (err) {
    logger?.error?.(`Ticket modal submission failed: ${err.message}`);
    if (userId) {
      await client.chat
        .postMessage({ channel: userId, text: TICKET_ERROR_TEXT })
        .catch((e) => logger?.warn?.(`Failed to DM ticket error: ${e.message}`));
    }
  }
};
