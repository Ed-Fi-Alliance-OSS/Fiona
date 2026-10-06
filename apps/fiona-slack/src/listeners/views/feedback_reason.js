// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordFeedback } from '../../agent/feedback-store.js';
import { extractSearchQuery } from '../../agent/search-caller.js';
import { FEEDBACK_RESPONSE_TYPES } from './feedback_block.js';

function normalizeResponseType(responseType) {
  return Object.values(FEEDBACK_RESPONSE_TYPES).includes(responseType)
    ? responseType
    : FEEDBACK_RESPONSE_TYPES.SYNTHESIS;
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

async function resolveSearchFeedbackContext(
  client,
  channelId,
  threadTs,
  messageTs,
  interactionType,
  storedSearchQuery,
  storedBotResponse,
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
 * ephemerally to keep the exchange private, and an ephemeral message cannot be
 * re-fetched — the copy stored in private_metadata when the button was clicked is
 * the only one. The question is not recoverable there at all: an answer does not
 * quote it the way a search result quotes its query, so userMessage is honestly
 * null rather than guessed at.
 *
 * @returns {Promise<{ userMessage: string | null, botResponse: string | null }>}
 */
async function resolveAskFeedbackContext(client, channelId, threadTs, messageTs, interactionType, storedBotResponse) {
  if (interactionType === 'assistant_message') {
    const fetched = await fetchThreadContext(client, channelId, threadTs, messageTs);
    // fetchThreadContext resolves with nulls rather than throwing when the
    // streamed message is gone or the thread was truncated; the copy stored at
    // click time is then the only surviving record of the answer.
    return { userMessage: fetched.userMessage, botResponse: fetched.botResponse ?? storedBotResponse ?? null };
  }
  return { userMessage: null, botResponse: storedBotResponse ?? null };
}

/**
 * Routes to the context strategy the response type calls for. Synthesis answers
 * live in a thread and can be read back; search and ask cannot always be.
 *
 * @returns {Promise<{ userMessage: string | null, botResponse: string | null }>}
 */
async function resolveFeedbackContext({
  client,
  responseType,
  channelId,
  threadTs,
  messageTs,
  interactionType,
  searchQuery,
  storedBotResponse,
}) {
  if (responseType === FEEDBACK_RESPONSE_TYPES.SEARCH) {
    return resolveSearchFeedbackContext(
      client,
      channelId,
      threadTs,
      messageTs,
      interactionType,
      searchQuery,
      storedBotResponse,
    );
  }
  if (responseType === FEEDBACK_RESPONSE_TYPES.ASK) {
    return resolveAskFeedbackContext(client, channelId, threadTs, messageTs, interactionType, storedBotResponse);
  }
  return fetchThreadContext(client, channelId, threadTs, messageTs);
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
    const {
      channelId,
      messageTs,
      userId,
      value,
      thread_ts,
      responseType,
      interactionType,
      searchQuery,
      botResponse: storedBotResponse,
    } = JSON.parse(view.private_metadata);
    const normalizedResponseType = normalizeResponseType(responseType);
    const rawReason = view.state.values?.reason_block?.reason_input?.value;
    const trimmedReason = typeof rawReason === 'string' ? rawReason.trim() : '';

    if (value === 'bad-feedback' && !trimmedReason) {
      await ack({ response_action: 'errors', errors: { reason_block: 'Please enter a reason.' } });
      return;
    }

    await ack();
    // Seeded before the lookup so a failed fetch still records what we already
    // hold, rather than discarding it along with the error.
    let userMessage = normalizedResponseType === FEEDBACK_RESPONSE_TYPES.SEARCH ? (searchQuery ?? null) : null;
    let botResponse = normalizedResponseType === FEEDBACK_RESPONSE_TYPES.ASK ? (storedBotResponse ?? null) : null;
    try {
      ({ userMessage, botResponse } = await resolveFeedbackContext({
        client,
        responseType: normalizedResponseType,
        channelId,
        threadTs: thread_ts,
        messageTs,
        interactionType,
        searchQuery,
        storedBotResponse,
      }));
    } catch (e) {
      logger.error('Failed to fetch feedback context:', e);
    }

    try {
      await recordFeedback({
        userId,
        channelId,
        messageTs,
        value,
        reason: rawReason,
        userMessage,
        botResponse,
        responseType: normalizedResponseType,
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
    const {
      channelId,
      messageTs,
      userId,
      value,
      thread_ts,
      responseType,
      interactionType,
      searchQuery,
      botResponse: storedBotResponse,
    } = JSON.parse(view.private_metadata);
    const normalizedResponseType = normalizeResponseType(responseType);
    if (value !== 'good-feedback') return;
    let userMessage = null;
    let botResponse = null;

    // Synthesis is left alone here, as it always has been: a dismissed thumbs-up
    // does not justify a conversations.replies call for context nobody asked for.
    // Search and ask carry theirs cheaply — ask's is already in private_metadata.
    if (
      normalizedResponseType === FEEDBACK_RESPONSE_TYPES.SEARCH ||
      normalizedResponseType === FEEDBACK_RESPONSE_TYPES.ASK
    ) {
      if (normalizedResponseType === FEEDBACK_RESPONSE_TYPES.ASK) botResponse = storedBotResponse ?? null;
      try {
        ({ userMessage, botResponse } = await resolveFeedbackContext({
          client,
          responseType: normalizedResponseType,
          channelId,
          threadTs: thread_ts ?? messageTs,
          messageTs,
          interactionType,
          searchQuery,
          storedBotResponse,
        }));
      } catch (e) {
        logger.error('Failed to fetch feedback context:', e);
      }
    }

    await recordFeedback({
      userId,
      channelId,
      messageTs,
      value,
      reason: null,
      userMessage,
      botResponse,
      responseType: normalizedResponseType,
      interactionType,
      logger,
    });
  } catch (error) {
    logger.error('Something went wrong while handling feedback reason modal close.', error);
  }
};
