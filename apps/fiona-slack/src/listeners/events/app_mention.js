// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordInteraction } from '../../agent/interaction-store.js';
import {
  CITATION_POLICY,
  callLLM,
  finalizeMetadataEnvelope,
  handleMetadataTimeout,
  MetadataLifecycleState,
} from '../../agent/llm-caller.js';
import { checkRateLimit } from '../../agent/rate-limiter.js';
import { buildThreadHistory } from '../../agent/thread-history.js';
import { generateResponseId, rollbackFinalization, shouldFinalize } from '../../agent/utils/idempotent-finalize.js';
import { feedbackBlock } from '../views/feedback_block.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for metadata to reach a finalization-ready state with timeout.
 *
 * @param {Object} metadata - Metadata envelope
 * @param {number} [timeoutMs=2000] - Max wait time
 * @returns {Promise<void>}
 */
async function waitForMetadataReady(metadata, timeoutMs = 2000) {
  if (!metadata) return;

  const startTime = Date.now();
  const readyStates = [
    MetadataLifecycleState.READY_TO_FINALIZE,
    MetadataLifecycleState.DEGRADED_NO_METADATA,
    MetadataLifecycleState.FINALIZED,
  ];

  while (true) {
    if (readyStates.includes(metadata.finalize_state)) {
      return;
    }

    if (Date.now() - startTime > timeoutMs) {
      // On timeout, transition via state machine to preserve strict consistency.
      handleMetadataTimeout(metadata);
      return;
    }

    await sleep(50);
  }
}

/**
 * Handles the event when the app is mentioned in a Slack conversation
 * and generates an AI response.
 *
 * @param {Object} params
 * @param {import("@slack/types").AppMentionEvent} params.event - The app mention event.
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 *
 * @see {@link https://docs.slack.dev/reference/events/app_mention/}
 */
export const appMentionCallback = async ({ event, client, logger, say }) => {
  // Track the claimed finalization slot so the catch block can roll it back on failure,
  // allowing a future delivery attempt to retry.
  const { channel, team, user } = event;
  const thread_ts = event.thread_ts || event.ts;
  const messageTs = event.ts;

  let responseId = null;
  let status = 'success';
  let errorType = null;
  let isRateLimited = false;
  let interactionRecorded = false;

  try {
    const { allowed, retryAfterMs } = checkRateLimit(user);
    if (!allowed) {
      isRateLimited = true;
      recordInteraction({
        userId: user,
        teamId: team,
        channelId: channel,
        threadTs: thread_ts,
        messageTs,
        interactionType: 'app_mention',
        status: 'error',
        errorType: 'rate_limited',
        rateLimited: true,
        logger,
      }).catch((e) => logger.warn?.(`Failed to record interaction: ${e.message}`));
      interactionRecorded = true;

      const minutes = Math.ceil(retryAfterMs / 60000);
      await say(
        `:no_entry: You've reached the request limit. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`,
      );
      return;
    }

    // Strip Slack mention tokens (users, channels, special commands) before sending to LLM
    const text = (event.text || '').replace(/<[@#!][^>]+>/g, '').trim();

    // Respond with a helpful introduction when there is no message text (silently discard, don't record)
    if (!text) {
      interactionRecorded = true;
      await say(
        "Hi, I'm Fiona, your Ed-Fi AI assistant! Ask me anything about Ed-Fi standards, documentation, or implementations.",
      );
      return;
    }

    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: thread_ts,
      status: 'thinking...',
      loading_messages: [
        'Teaching the hamsters to type faster…',
        'Untangling the internet cables…',
        'Consulting the office goldfish…',
        'Polishing up the response just for you…',
        'Convincing the AI to stop overthinking…',
      ],
    });

    const streamer = client.chatStream({
      channel: channel,
      recipient_team_id: team,
      recipient_user_id: user,
      thread_ts: thread_ts,
    });

    const prompts = await buildThreadHistory(client, channel, thread_ts, { currentText: text, logger });

    const metadata = await callLLM(streamer, prompts, logger);

    // Guard against duplicate finalization
    responseId = generateResponseId(channel, thread_ts, event.ts);
    if (!shouldFinalize(responseId, logger)) {
      return;
    }

    // Wait for metadata to be ready before finalizing
    await waitForMetadataReady(metadata, CITATION_POLICY.METADATA_WAIT_TIMEOUT_MS);

    // Telemetry: log finalize_state and source count for observability.
    if (metadata) {
      logger.info(`[citations] state=${metadata.finalize_state} sources=${metadata.sources?.length ?? 0}`);
    }

    await streamer.stop({ blocks: [feedbackBlock] });
    finalizeMetadataEnvelope(metadata);
  } catch (e) {
    // Roll back the claimed finalization slot so a future delivery attempt can retry.
    if (responseId) rollbackFinalization(responseId);

    status = 'error';

    if (e.code === 'COSMOS_ERROR') {
      errorType = 'cosmos_error';
    } else if (e.name === 'TimeoutError') {
      errorType = 'timeout';
    } else if (e.code?.includes('429') || e.message?.includes('rate_limit')) {
      errorType = 'llm_rate_limited';
    } else if (e.code?.includes('openai') || e.name?.includes('APIError')) {
      errorType = 'llm_error';
    } else {
      errorType = 'unknown';
    }

    logger.error('Failed to handle a user message event:', e);
    await say(':warning: Something went wrong! Please try again later.');
  } finally {
    if (!interactionRecorded) {
      try {
        await recordInteraction({
          userId: user,
          teamId: team,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          interactionType: 'app_mention',
          status,
          errorType: status === 'error' ? errorType : null,
          rateLimited: isRateLimited,
          logger,
        });
      } catch (cosmosError) {
        logger.warn?.(`Failed to record interaction: ${cosmosError.message}`);
      }
    }
  }
};
