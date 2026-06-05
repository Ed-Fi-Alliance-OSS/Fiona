// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordFeedback } from '../../agent/feedback-store.js';

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
    const { channelId, messageTs, userId, value, thread_ts } = JSON.parse(view.private_metadata);
    const rawReason = view.state.values?.reason_block?.reason_input?.value;
    const trimmedReason = typeof rawReason === 'string' ? rawReason.trim() : '';
    const reason = trimmedReason || null;

    if (value === 'bad-feedback' && !trimmedReason) {
      await ack({ response_action: 'errors', errors: { reason_block: 'Please enter a reason.' } });
      return;
    }

    await ack();
    let userMessage = null;
    let botResponse = null;
    try {
      const { messages } = await client.conversations.replies({ channel: channelId, ts: thread_ts });
      if (messages) {
        const botIndex = messages.findIndex((m) => m.ts === messageTs);
        if (botIndex >= 0) {
          botResponse = messages[botIndex].text ?? null;
          const preceding = botIndex > 0 ? messages[botIndex - 1] : null;
          if (preceding?.text) userMessage = preceding.text;
        }
      }
    } catch (e) {
      logger.error('Failed to fetch thread context:', e);
    }

    try {
      await recordFeedback({ userId, channelId, messageTs, value, reason, userMessage, botResponse, logger });
    } catch (e) {
      logger.error('Failed to record feedback to Cosmos DB:', e);
    }

    const text =
      value === 'good-feedback'
        ? "We're glad you found this useful."
        : "Sorry to hear that response wasn't up to par :slightly_frowning_face: Starting a new chat may help with AI mistakes and hallucinations.";

    await client.chat.postEphemeral({ channel: channelId, user: userId, thread_ts, text });
  } catch (error) {
    logger.error('Something went wrong while handling feedback reason view.', error);
  }
};
