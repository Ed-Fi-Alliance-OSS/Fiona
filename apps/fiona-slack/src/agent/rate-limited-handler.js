// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordInteraction } from './interaction-store.js';
import { checkRateLimit, rateLimitMessage } from './rate-limiter.js';

/**
 * Handles rate-limited interactions by checking limits, recording the event,
 * and sending a user-friendly error message.
 *
 * @param {Object} params
 * @param {string} params.userId - The user ID
 * @param {string} params.teamId - The team ID
 * @param {string} params.channelId - The channel ID
 * @param {string} params.threadTs - The thread timestamp
 * @param {string} params.messageTs - The message timestamp
 * @param {string} params.interactionType - The type of interaction
 * @param {import("@slack/logger").Logger} params.logger - Logger instance
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages
 * @param {Function} params.markRateLimited - Callback to mark interaction as rate limited
 * @param {Function} params.markInteractionRecorded - Callback to mark interaction as recorded
 * @returns {Promise<boolean>} True if rate limited, false otherwise
 */
export async function handleRateLimitedInteraction({
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  interactionType,
  logger,
  say,
  markRateLimited,
  markInteractionRecorded,
}) {
  const { allowed, retryAfterMs } = checkRateLimit(userId);
  if (!allowed) {
    markRateLimited();
    recordInteraction({
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
      interactionType,
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((e) => logger.warn?.(`Failed to record interaction: ${e.message}`));
    markInteractionRecorded();

    // Reply in the originating thread. Without thread_ts Slack posts to the parent
    // channel, so a user rate-limited inside a thread gets the notice somewhere else.
    await say({ text: rateLimitMessage(retryAfterMs), thread_ts: threadTs });
    return true;
  }
  return false;
}
