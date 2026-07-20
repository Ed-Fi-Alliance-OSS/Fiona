// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

export const TICKET_MODAL_CALLBACK = 'ticket_modal';
export const PRIORITY_OPTIONS = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
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
