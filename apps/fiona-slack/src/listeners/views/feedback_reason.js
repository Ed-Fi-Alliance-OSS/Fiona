// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { STORED_CONTEXT_TYPES } from '../../agent/feedback-response-types.js';
import { recordFeedback } from '../../agent/feedback-store.js';
import { extractSearchQuery } from '../../agent/search-caller.js';
import { FEEDBACK_RESPONSE_TYPES } from './feedback_block.js';

function normalizeResponseType(responseType) {
  return Object.values(FEEDBACK_RESPONSE_TYPES).includes(responseType)
    ? responseType
    : FEEDBACK_RESPONSE_TYPES.SYNTHESIS;
}

/**
 * Reads the modal's private_metadata, written by feedback.js when the button was
 * clicked, and normalizes the response type.
 */
function readFeedbackMetadata(view) {
  const {
    channelId,
    messageTs,
    userId,
    value,
    thread_ts,
    responseType,
    interactionType,
    searchQuery,
    question: storedQuestion,
    botResponse: storedBotResponse,
  } = JSON.parse(view.private_metadata);
  return {
    channelId,
    messageTs,
    userId,
    value,
    thread_ts,
    responseType: normalizeResponseType(responseType),
    interactionType,
    searchQuery,
    storedQuestion,
    storedBotResponse,
  };
}

/**
 * The context already in hand from private_metadata, before any lookup. It is
 * what gets recorded if the lookup fails, so a failed fetch never discards what
 * was stored at click time. Only STORED_CONTEXT_TYPES carry any.
 *
 * @returns {{ userMessage: string | null, botResponse: string | null }}
 */
function seedFeedbackContext({ responseType, searchQuery, storedQuestion, storedBotResponse }) {
  if (!STORED_CONTEXT_TYPES.has(responseType)) return { userMessage: null, botResponse: null };
  return {
    userMessage: (responseType === FEEDBACK_RESPONSE_TYPES.SEARCH ? searchQuery : storedQuestion) ?? null,
    botResponse: storedBotResponse ?? null,
  };
}

/**
 * Seeds the context, then tries to improve it with resolveFeedbackContext.
 * A lookup failure is logged and the seed is kept.
 */
async function gatherFeedbackContext({ client, logger, metadata, threadTs }) {
  let context = seedFeedbackContext(metadata);
  try {
    context = await resolveFeedbackContext(client, metadata, threadTs);
  } catch (e) {
    logger.error('Failed to fetch feedback context:', e);
  }
  return context;
}

/**
 * Retrieve thread-based feedback context by locating the rated bot message and
 * the user message immediately before it.
 *
 * @param {import("@slack/web-api").WebClient} client
 * @param {string} channelId
 * @param {string} threadTs
 * @param {string} messageTs
 * @returns {Promise<{ userMessage: string | null, botResponse: string | null }>}
 */
async function fetchThreadContext(client, channelId, threadTs, messageTs) {
  const { messages } = await client.conversations.replies({ channel: channelId, ts: threadTs });
  if (!messages) {
    return { userMessage: null, botResponse: null };
  }

  const botIndex = messages.findIndex((message) => message.ts === messageTs);
  if (botIndex < 0) {
    return { userMessage: null, botResponse: null };
  }

  const botResponse = messages[botIndex].text ?? null;
  const preceding = botIndex > 0 ? messages[botIndex - 1] : null;
  return {
    userMessage: preceding?.text ?? null,
    botResponse,
  };
}

/**
 * Retrieve the text of a single Slack message by timestamp. Uses
 * conversations.replies (not conversations.history) so thread replies are
 * found too — history only returns top-level channel messages, and
 * assistant_message/app_mention search responses are posted as thread replies.
 * threadTs equals messageTs for a top-level message, which conversations.replies
 * also handles correctly (returning just that single message).
 *
 * @param {import("@slack/web-api").WebClient} client
 * @param {string} channelId
 * @param {string} threadTs
 * @param {string} messageTs
 * @returns {Promise<string | null>}
 */
async function fetchMessageText(client, channelId, threadTs, messageTs) {
  const { messages } = await client.conversations.replies({ channel: channelId, ts: threadTs });
  if (!Array.isArray(messages)) {
    return null;
  }
  return messages.find((message) => message.ts === messageTs)?.text ?? null;
}

/**
 * The resolvers below take the metadata read by readFeedbackMetadata as-is,
 * plus the thread to look in, so a new stored field is threaded through once.
 */
async function resolveSearchFeedbackContext(
  client,
  { channelId, messageTs, interactionType, searchQuery: storedSearchQuery, storedBotResponse },
  threadTs,
) {
  if (interactionType === 'slash_search') {
    return {
      userMessage: storedSearchQuery ?? null,
      botResponse: storedBotResponse ?? null,
    };
  }

  const botResponse = storedBotResponse ?? (await fetchMessageText(client, channelId, threadTs, messageTs));
  return {
    userMessage: storedSearchQuery ?? extractSearchQuery(botResponse),
    botResponse,
  };
}

/**
 * Recovers the question and answer behind an `ask` rating.
 *
 * In the assistant panel the answer is an ordinary thread message, so the thread
 * lookup recovers both sides. Everywhere else the answer was delivered
 * ephemerally and cannot be re-fetched, so the copies stored in private_metadata
 * when the button was clicked are the only ones: the answer text, and the
 * question read from the answer's "You asked:" block. An answer posted before
 * that block existed has no stored question, and userMessage is then null
 * rather than guessed at.
 *
 * @returns {Promise<{ userMessage: string | null, botResponse: string | null }>}
 */
async function resolveAskFeedbackContext(
  client,
  { channelId, messageTs, interactionType, storedQuestion, storedBotResponse },
  threadTs,
) {
  if (interactionType === 'assistant_message') {
    const fetched = await fetchThreadContext(client, channelId, threadTs, messageTs);
    // fetchThreadContext resolves with nulls rather than throwing when the
    // streamed message is gone or the thread was truncated; the copy stored at
    // click time is then the only surviving record of the answer.
    return {
      userMessage: fetched.userMessage ?? storedQuestion ?? null,
      botResponse: fetched.botResponse ?? storedBotResponse ?? null,
    };
  }
  return { userMessage: storedQuestion ?? null, botResponse: storedBotResponse ?? null };
}

/**
 * Routes to the context strategy the response type calls for. Synthesis answers
 * live in a thread and can be read back; search and ask cannot always be.
 *
 * @returns {Promise<{ userMessage: string | null, botResponse: string | null }>}
 */
async function resolveFeedbackContext(client, metadata, threadTs) {
  if (metadata.responseType === FEEDBACK_RESPONSE_TYPES.SEARCH) {
    return resolveSearchFeedbackContext(client, metadata, threadTs);
  }
  if (metadata.responseType === FEEDBACK_RESPONSE_TYPES.ASK) {
    return resolveAskFeedbackContext(client, metadata, threadTs);
  }
  return fetchThreadContext(client, metadata.channelId, threadTs, metadata.messageTs);
}

/**
 * Handles the `feedback_reason` modal submission. Records the feedback and reason
 * to Cosmos DB, then posts a confirmation ephemeral to the originating channel.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack
 * @param {import("@slack/bolt").ViewOutput} params.view
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {import("@slack/logger").Logger} params.logger
 */
export const feedbackReasonViewCallback = async ({ ack, view, client, logger }) => {
  try {
    const metadata = readFeedbackMetadata(view);
    const { channelId, messageTs, userId, value, thread_ts, responseType, interactionType } = metadata;
    const rawReason = view.state.values?.reason_block?.reason_input?.value;
    const trimmedReason = typeof rawReason === 'string' ? rawReason.trim() : '';

    if (value === 'bad-feedback' && !trimmedReason) {
      await ack({ response_action: 'errors', errors: { reason_block: 'Please enter a reason.' } });
      return;
    }

    await ack();
    const { userMessage, botResponse } = await gatherFeedbackContext({
      client,
      logger,
      metadata,
      threadTs: thread_ts,
    });

    try {
      await recordFeedback({
        userId,
        channelId,
        messageTs,
        value,
        reason: rawReason,
        userMessage,
        botResponse,
        responseType,
        interactionType,
        logger,
      });
    } catch (e) {
      logger.error('Failed to record feedback to Cosmos DB:', e);
    }

    const text =
      value === 'good-feedback'
        ? "We're glad you found this useful."
        : "Sorry to hear that response wasn't up to par :slightly_frowning_face: Starting a new chat may help with AI mistakes and hallucinations.";

    await client.chat.postEphemeral({ channel: channelId, user: userId, thread_ts, text });
  } catch (error) {
    try {
      await ack();
    } catch {
      // ignore ack failures (e.g., already acked)
    }
    logger.error('Something went wrong while handling feedback reason view.', error);
  }
};

/**
 * Handles `view_closed` for the `feedback_reason` modal.
 * Records thumbs-up feedback with no reason when the user dismisses the modal.
 * Thumbs-down close is ignored — the user did not intend to submit feedback.
 *
 * @param {Object} params
 * @param {import("@slack/bolt").AckFn<any>} params.ack
 * @param {import("@slack/bolt").ViewOutput} params.view
 * @param {import("@slack/logger").Logger} params.logger
 */
export const feedbackReasonClosedCallback = async ({ ack, view, client, logger }) => {
  try {
    await ack();
    const metadata = readFeedbackMetadata(view);
    const { channelId, messageTs, userId, value, thread_ts, responseType, interactionType } = metadata;
    if (value !== 'good-feedback') return;

    // Synthesis is left alone here, as it always has been: a dismissed thumbs-up
    // does not justify a conversations.replies call for context nobody asked for.
    // The stored-context types carry theirs cheaply in private_metadata.
    const { userMessage, botResponse } = STORED_CONTEXT_TYPES.has(responseType)
      ? await gatherFeedbackContext({ client, logger, metadata, threadTs: thread_ts ?? messageTs })
      : { userMessage: null, botResponse: null };

    await recordFeedback({
      userId,
      channelId,
      messageTs,
      value,
      reason: null,
      userMessage,
      botResponse,
      responseType,
      interactionType,
      logger,
    });
  } catch (error) {
    logger.error('Something went wrong while handling feedback reason modal close.', error);
  }
};
