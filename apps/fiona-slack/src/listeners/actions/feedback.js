// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { STORED_CONTEXT_TYPES } from '../../agent/feedback-response-types.js';
import { extractSearchQuery } from '../../agent/search-caller.js';
import { extractAskQuestion } from '../views/ask_question_block.js';
import { FEEDBACK_RESPONSE_TYPES, parseFeedbackBlockId } from '../views/feedback_block.js';

const PRIVATE_METADATA_MAX_CHARS = 3000;
const PRIVATE_METADATA_QUERY_MAX_CHARS = 1000;
// An ephemeral ask answer's stored copy is the only one there will ever be, so
// the question gets the smaller share of the budget. Its "You asked:" line can
// hold ~1,000 code units, which a pasted snippet could double once JSON-encoded,
// and the trim below would then cut the answer to make room.
const PRIVATE_METADATA_QUESTION_MAX_CHARS = 500;
const PRIVATE_METADATA_BOT_RESPONSE_MAX_CHARS = 1500;

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

function compactBotResponse(messageText) {
  if (typeof messageText !== 'string') return null;
  if (messageText.length <= PRIVATE_METADATA_BOT_RESPONSE_MAX_CHARS) return messageText;
  return `${messageText.slice(0, PRIVATE_METADATA_BOT_RESPONSE_MAX_CHARS - 1)}…`;
}

function compactQuery(query, maxChars = PRIVATE_METADATA_QUERY_MAX_CHARS) {
  if (typeof query !== 'string') return null;
  if (query.length <= maxChars) return query;
  // Never end on the first half of a surrogate pair.
  const cut = /[\uD800-\uDBFF]/.test(query[maxChars - 2]) ? maxChars - 2 : maxChars - 1;
  return `${query.slice(0, cut)}…`;
}

/**
 * Text worth keeping in private_metadata at click time, keyed by response type.
 *
 * An ephemeral message can never be re-fetched through
 * conversations.history/replies, so the click is the only chance to store its
 * text. That applies to every search response (app_mention and
 * assistant_message search results are ephemeral too) and to `ask` answers on
 * the public surfaces, which are ephemeral for the same privacy reason.
 *
 * A search response quotes its query in the header, so extractSearchQuery
 * recovers it from the text. An `ask` answer carries its question in the
 * "You asked:" block instead (AI-248); a streamed answer in the assistant
 * panel has none, and its question is read back from the thread later.
 */
function buildClickTimeContext(responseType, message) {
  if (!STORED_CONTEXT_TYPES.has(responseType)) return null;
  const messageText = message?.text;
  if (responseType === FEEDBACK_RESPONSE_TYPES.SEARCH) {
    return { searchQuery: extractSearchQuery(messageText), botResponse: messageText ?? null };
  }
  if (responseType === FEEDBACK_RESPONSE_TYPES.ASK) {
    return { question: extractAskQuestion(message?.blocks), botResponse: messageText ?? null };
  }
  return null;
}

function buildPrivateMetadata(baseMetadata, contextToStore = null) {
  if (!contextToStore) {
    return JSON.stringify(baseMetadata);
  }

  const searchQuery = compactQuery(contextToStore.searchQuery);
  const question = compactQuery(contextToStore.question, PRIVATE_METADATA_QUESTION_MAX_CHARS);
  let botResponse = compactBotResponse(contextToStore.botResponse);

  const encode = () =>
    JSON.stringify({
      ...baseMetadata,
      ...(searchQuery ? { searchQuery } : {}),
      ...(question ? { question } : {}),
      ...(botResponse ? { botResponse } : {}),
    });

  // The character caps above count raw text, but Slack's limit applies to the
  // JSON encoding, where every quote, backslash and newline doubles. An answer
  // full of code can overflow, so trim the stored response by the overflow
  // until it fits rather than dropping it.
  let privateMetadata = encode();
  while (privateMetadata.length > PRIVATE_METADATA_MAX_CHARS && botResponse) {
    const overflow = privateMetadata.length - PRIVATE_METADATA_MAX_CHARS;
    const keep = botResponse.length - overflow - 1;
    botResponse = keep > 0 ? `${botResponse.slice(0, keep)}…` : null;
    privateMetadata = encode();
  }

  // A guard against Slack's limit if the query cap is ever loosened without
  // re-checking the invariant.
  if (privateMetadata.length > PRIVATE_METADATA_MAX_CHARS) {
    return JSON.stringify(baseMetadata);
  }

  return privateMetadata;
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
        private_metadata: buildPrivateMetadata(
          {
            channelId: channel_id,
            messageTs: message_ts,
            userId: user_id,
            value,
            thread_ts,
            responseType,
            interactionType,
          },
          buildClickTimeContext(responseType, body.message),
        ),
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
