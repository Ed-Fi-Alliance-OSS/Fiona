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
  TICKET_TYPES,
} from '../commands/command-handler.js';

export const TICKET_MODAL_CALLBACK = 'ticket_modal';

// Must match the GitHub org `Priority` single-select options exactly: the selected
// value is resolved to an option node id by name at issue-creation time. That field
// is org-configurable, so the list is hardcoded as a default and overridable by one
// comma-separated env var rather than requiring a code change.
export const DEFAULT_PRIORITY_OPTION_NAMES = ['Urgent', 'High', 'Medium', 'Low'];
const PREFERRED_DEFAULT_PRIORITY = 'Medium';

/**
 * The Priority option names to offer, read at call time so tests and a re-read of
 * the environment both work the way the rest of this feature's config does.
 *
 * A value that parses to nothing — unset, blank, or only separators — falls back to
 * the defaults. An empty dropdown would be worse than an out-of-date one.
 *
 * @returns {string[]}
 */
export function priorityOptionNames() {
  const configured = (process.env.GH_ISSUE_PRIORITY_OPTION_NAMES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_PRIORITY_OPTION_NAMES;
}

/**
 * The Priority to preselect, and the value sent when the user submits without
 * touching the dropdown.
 *
 * Medium when it is on offer, otherwise the first configured name. It cannot be a
 * constant: this name is resolved against the GitHub field's options by name, so
 * preselecting a value the field does not have would fail issue creation after the
 * user had already filled in the form.
 *
 * @returns {string}
 */
export function defaultPriorityName() {
  const options = priorityOptionNames();
  return options.includes(PREFERRED_DEFAULT_PRIORITY) ? PREFERRED_DEFAULT_PRIORITY : options[0];
}

export const TICKET_TYPE_ACTION = 'ticket_type_input';

// Display labels for the Type dropdown. Derived from TICKET_TYPES rather than
// redeclaring the set, so the modal cannot drift from the types the rest of the
// app accepts. "Question / not sure" names both cases on purpose: someone who
// cannot classify their report should not have to decide whether it counts as a
// question.
const TICKET_TYPE_LABELS = { bug: 'Bug', feature: 'Feature', question: 'Question / not sure' };
export const TICKET_TYPE_OPTIONS = TICKET_TYPES.map((value) => ({ value, name: TICKET_TYPE_LABELS[value] }));

// Per-type copy. A lookup rather than a ternary because there are three variants
// and only one of them carries the bug-specific blocks.
const TICKET_TYPE_COPY = {
  bug: { title: 'Report a bug', summary: 'Short description of the bug', description: 'What happened?' },
  feature: {
    title: 'Request a feature',
    summary: 'Short description of the feature',
    description: 'What would you like and why?',
  },
  question: {
    title: 'Ask a question',
    summary: 'Short description of your question',
    description: 'What would you like to know?',
  },
};

const plainText = (text) => ({ type: 'plain_text', text });

function textInput({ blockId, actionId, label, multiline, optional, initialValue, placeholder }) {
  const element = { type: 'plain_text_input', action_id: actionId, multiline: Boolean(multiline), max_length: 3000 };
  if (initialValue) element.initial_value = initialValue;
  if (placeholder) element.placeholder = plainText(placeholder);
  return { type: 'input', block_id: blockId, optional: Boolean(optional), label: plainText(label), element };
}

// dispatch_action makes selecting a type emit a block_actions event, which
// actions/ticket_type.js handles by re-rendering the view. Verified live on
// 2026-08-05: the event fires and carries both selected_option and view.state.
function typeBlock(ticketType) {
  const options = TICKET_TYPE_OPTIONS.map((t) => ({ text: plainText(t.name), value: t.value }));
  return {
    type: 'input',
    block_id: 'type_block',
    dispatch_action: true,
    label: plainText('Type'),
    element: {
      type: 'static_select',
      action_id: TICKET_TYPE_ACTION,
      options,
      initial_option: options.find((o) => o.value === ticketType) ?? options[0],
    },
  };
}

function priorityBlock(priority) {
  const names = priorityOptionNames();
  const options = names.map((name) => ({ text: plainText(name), value: name }));
  const selected = names.includes(priority) ? priority : defaultPriorityName();
  return {
    type: 'input',
    block_id: 'priority_block',
    label: plainText('Priority'),
    element: {
      type: 'static_select',
      action_id: 'priority_input',
      options,
      initial_option: options.find((o) => o.value === selected),
    },
  };
}

/**
 * Build the ticket modal view. Field set depends on ticketType.
 * @param {{ ticketType: 'bug'|'feature'|'question', channelId?: string, threadTs?: string, prefill?: { summary?: string, description?: string, priority?: string } }} params
 */
export function buildTicketModal({ ticketType, channelId, threadTs, prefill = {} }) {
  // Normalize once: an unrecognized type would otherwise render one type's field
  // set beneath a dropdown that fell back to displaying Bug.
  const type = normalizeTicketType(ticketType);
  const isBug = type === 'bug';
  const copy = TICKET_TYPE_COPY[type];
  const blocks = [
    typeBlock(type),
    textInput({
      blockId: 'summary_block',
      actionId: 'summary_input',
      label: 'Summary',
      initialValue: prefill.summary,
      placeholder: copy.summary,
    }),
    textInput({
      blockId: 'description_block',
      actionId: 'description_input',
      label: 'Description',
      multiline: true,
      initialValue: prefill.description,
      placeholder: copy.description,
    }),
    priorityBlock(prefill.priority),
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
    title: plainText(copy.title),
    submit: plainText('Create issue'),
    close: plainText('Cancel'),
    private_metadata: JSON.stringify({ channelId, threadTs }),
    blocks,
  };
}

function readValue(view, blockId, actionId) {
  return view.state.values?.[blockId]?.[actionId]?.value?.trim() || '';
}

/**
 * Read the selected ticket type out of live view state.
 *
 * View state is client-supplied like private_metadata was, so it goes through
 * normalizeTicketType rather than being trusted — that keeps the validated-enum
 * guarantee in one place for both the submit and the type-change paths.
 *
 * @param {import("@slack/bolt").ViewOutput} view
 * @returns {'bug'|'feature'|'question'}
 */
export function readTicketType(view) {
  return normalizeTicketType(view?.state?.values?.type_block?.[TICKET_TYPE_ACTION]?.selected_option?.value);
}

/**
 * Read the values that must survive a type change.
 *
 * Slack preserves input values across views.update only for identical input
 * blocks, and ours are not identical — placeholders change with the type. These
 * are carried forward explicitly instead.
 *
 * @param {import("@slack/bolt").ViewOutput} view
 * @returns {{ summary: string, description: string, priority: string|undefined }}
 */
export function readPrefill(view) {
  return {
    summary: readValue(view, 'summary_block', 'summary_input'),
    description: readValue(view, 'description_block', 'description_input'),
    priority: view?.state?.values?.priority_block?.priority_input?.selected_option?.value,
  };
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
    const { channelId } = JSON.parse(view.private_metadata || '{}');
    // The type comes from the validated Type dropdown in live view state, not from
    // client-supplied private_metadata.
    const ticketType = readTicketType(view);
    const payload = {
      ticketType,
      summary: readValue(view, 'summary_block', 'summary_input'),
      description: readValue(view, 'description_block', 'description_input'),
      priorityName: view.state.values?.priority_block?.priority_input?.selected_option?.value || defaultPriorityName(),
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
