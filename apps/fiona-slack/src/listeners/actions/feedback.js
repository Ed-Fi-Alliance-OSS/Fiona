// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { FEEDBACK_RESPONSE_TYPES, parseFeedbackBlockId } from '../views/feedback_block.js';

const SEARCH_QUERY_PATTERN = /^🔍 \*Search results for:\* _"([\s\S]+)"_$/;

/**
 * Resolve the contextual feedback block id from the action payload.
 *
 * @param {import("@slack/bolt").SlackAction} body
 * @param {Record<string, any>} action
 * @returns {string|null}
 */
function getFeedbackBlockId(body, action) {
  if (typeof action?.block_id === 'string' && action.block_id.length > 0) {
    return action.block_id;
  }

  if (!Array.isArray(body?.message?.blocks)) return null;
  return body.message.blocks.find((block) => block?.type === 'context_actions')?.block_id ?? null;
}

/**
 * Extract the original query from a formatted Fiona search response.
 *
 * @param {string} messageText
 * @returns {string|null}
 */
function extractSearchQuery(messageText) {
  if (typeof messageText !== 'string') return null;
  const [headerLine] = messageText.split('\n');
  const match = headerLine?.match(SEARCH_QUERY_PATTERN);
  return match?.[1] ?? null;
}

/**
 * The `feedbackActionCallback` action responds to the `feedbackBlock` that displays
 * positive and negative feedback icons. This block is attached to the bottom of LLM
 * responses using the `WebClient#chatStream.stop()` method.
 *
 * Opens a modal so the user can optionally (thumbs-up) or mandatorily (thumbs-down)
 * provide a reason. The modal submission is handled by `feedbackReasonViewCallback`.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack - Acknowledgement function.
 * @param {import("@slack/bolt").SlackAction} params.body - Action payload.
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 */
export const feedbackActionCallback = async ({ ack, body, client, logger }) => {
  try {
    await ack();

    if (body.type !== 'block_actions' || !Array.isArray(body.actions) || body.actions.length === 0) {
      return;
    }

    const action = body.actions[0];
    if (action.type !== 'feedback_buttons') {
      return;
    }

    const message_ts = body.message.ts;
    const channel_id = body.channel.id;
    const user_id = body.user.id;
    const value = action.value;
    const { responseType, interactionType } = parseFeedbackBlockId(getFeedbackBlockId(body, action));

    if (value !== 'good-feedback' && value !== 'bad-feedback') {
      logger.warn('Received unexpected feedback value', { value, channel_id, user_id, message_ts });
      return;
    }

    const isGoodFeedback = value === 'good-feedback';
    const thread_ts = body.message.thread_ts ?? message_ts;

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'feedback_reason',
        notify_on_close: true,
        title: {
          type: 'plain_text',
          text: isGoodFeedback ? 'Thanks for the feedback!' : 'Sorry to hear that!',
        },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: isGoodFeedback ? 'Skip' : 'Cancel' },
        private_metadata: JSON.stringify({
          channelId: channel_id,
          messageTs: message_ts,
          userId: user_id,
          value,
          thread_ts,
          responseType,
          interactionType,
          ...(responseType === FEEDBACK_RESPONSE_TYPES.SEARCH
            ? { searchQuery: extractSearchQuery(body.message?.text), botResponse: body.message?.text ?? null }
            : {}),
        }),
        blocks: [
          {
            type: 'input',
            optional: isGoodFeedback,
            block_id: 'reason_block',
            label: {
              type: 'plain_text',
              text: isGoodFeedback ? 'Why was this helpful?' : 'What could be better?',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'reason_input',
              multiline: true,
              max_length: 500,
              placeholder: {
                type: 'plain_text',
                text: isGoodFeedback ? 'Optional: share what was helpful' : 'Please describe the issue',
              },
            },
          },
        ],
      },
    });
  } catch (error) {
    logger.error('Something went wrong while handling feedback action.', error);
  }
};
