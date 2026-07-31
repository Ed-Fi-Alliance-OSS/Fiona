// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { FEEDBACK_RESPONSE_TYPES, parseFeedbackBlockId } from '../views/feedback_block.js';

const SEARCH_QUERY_PATTERN = /^🔍 \*Search results for:\* _"([\s\S]+)"_(?:\n\n|$)/;
const SEARCH_NO_RESULTS_QUERY_PATTERN = /^🔍 No sources found for _"([\s\S]+)"_\. Try rephrasing your query\.$/;
const PRIVATE_METADATA_MAX_CHARS = 3000;
const PRIVATE_METADATA_SEARCH_QUERY_MAX_CHARS = 1000;
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

/**
 * Extract the original query from a formatted Fiona search response.
 *
 * @param {string} messageText
 * @returns {string|null}
 */
function extractSearchQuery(messageText) {
  if (typeof messageText !== 'string') return null;
  const match = messageText.match(SEARCH_QUERY_PATTERN) ?? messageText.match(SEARCH_NO_RESULTS_QUERY_PATTERN);
  return match?.[1] ?? null;
}

function compactBotResponse(messageText) {
  if (typeof messageText !== 'string') return null;
  if (messageText.length <= PRIVATE_METADATA_BOT_RESPONSE_MAX_CHARS) return messageText;
  return `${messageText.slice(0, PRIVATE_METADATA_BOT_RESPONSE_MAX_CHARS - 1)}…`;
}

function compactSearchQuery(searchQuery) {
  if (typeof searchQuery !== 'string') return null;
  if (searchQuery.length <= PRIVATE_METADATA_SEARCH_QUERY_MAX_CHARS) return searchQuery;
  return `${searchQuery.slice(0, PRIVATE_METADATA_SEARCH_QUERY_MAX_CHARS - 1)}…`;
}

function truncateForMetadata(text, maxChars) {
  if (typeof text !== 'string' || maxChars <= 0) return null;
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1)}…`;
}

function buildPrivateMetadata(baseMetadata, searchContext = null) {
  if (!searchContext) {
    return JSON.stringify(baseMetadata);
  }

  let compactedContext = {
    searchQuery: compactSearchQuery(searchContext.searchQuery),
    botResponse: compactBotResponse(searchContext.botResponse),
  };

  let privateMetadata = JSON.stringify({
    ...baseMetadata,
    ...(compactedContext.searchQuery ? { searchQuery: compactedContext.searchQuery } : {}),
    ...(compactedContext.botResponse ? { botResponse: compactedContext.botResponse } : {}),
  });

  while (
    privateMetadata.length > PRIVATE_METADATA_MAX_CHARS &&
    (compactedContext.searchQuery || compactedContext.botResponse)
  ) {
    if ((compactedContext.botResponse?.length ?? 0) >= (compactedContext.searchQuery?.length ?? 0)) {
      compactedContext = {
        ...compactedContext,
        botResponse: truncateForMetadata(
          compactedContext.botResponse,
          Math.floor((compactedContext.botResponse?.length ?? 0) / 2),
        ),
      };
    } else {
      compactedContext = {
        ...compactedContext,
        searchQuery: truncateForMetadata(
          compactedContext.searchQuery,
          Math.floor((compactedContext.searchQuery?.length ?? 0) / 2),
        ),
      };
    }

    privateMetadata = JSON.stringify({
      ...baseMetadata,
      ...(compactedContext.searchQuery ? { searchQuery: compactedContext.searchQuery } : {}),
      ...(compactedContext.botResponse ? { botResponse: compactedContext.botResponse } : {}),
    });
  }

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
          responseType === FEEDBACK_RESPONSE_TYPES.SEARCH && interactionType === 'slash_search'
            ? {
                searchQuery: extractSearchQuery(body.message?.text),
                botResponse: body.message?.text ?? null,
              }
            : null,
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
