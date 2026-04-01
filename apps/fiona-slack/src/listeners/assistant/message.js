// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

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
 * Handles when users send messages or select a prompt in an assistant thread
 * and generate AI responses.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/bolt").Context} params.context - Event context.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/types").MessageEvent} params.message - The incoming message.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {Function} params.setStatus - Function to set assistant status.
 *
 * @see {@link https://docs.slack.dev/reference/events/message}
 */
export const message = async ({ client, context, logger, message, say, setStatus }) => {
  /**
   * Messages sent to the Assistant can have a specific message subtype.
   *
   * Here we check that the message was sent to a thread to skip unexpected
   * message subtypes.
   *
   * @see {@link https://docs.slack.dev/reference/events/message#subtypes}
   */
  if (!('thread_ts' in message) || !message.thread_ts) {
    return;
  }

  /**
   * When a user sends an empty message (or one that only contains Slack mention
   * tokens such as `<@U0AJYKA5S4D>`), respond with a helpful introduction
   * rather than silently ignoring the message or forwarding an empty prompt.
   */
  const text = ('text' in message ? message.text || '' : '').replace(/<[@#!][^>]+>/g, '').trim();
  if (!text) {
    await say(
      "Hi, I'm Fiona, your Ed-Fi AI assistant! Ask me anything about Ed-Fi standards, documentation, or implementations.",
    );
    return;
  }

  // Track the claimed finalization slot so the catch block can roll it back on failure,
  // allowing a future delivery attempt to retry.
  let responseId = null;

  try {
    const { channel, thread_ts } = message;
    const { userId, teamId } = context;

    const { allowed, retryAfterMs } = checkRateLimit(userId);
    if (!allowed) {
      const minutes = Math.ceil(retryAfterMs / 60000);
      await say(
        `:no_entry: You've reached the request limit. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`,
      );
      return;
    }

    // The first example shows a message with thinking steps that has different chunks to construct and update a plan alongside text outputs.
    if (message.text === 'Wonder a few deep thoughts.') {
      await setStatus({
        status: 'thinking...',
        loading_messages: [
          'Teaching the hamsters to type faster…',
          'Untangling the internet cables…',
          'Consulting the office goldfish…',
          'Polishing up the response just for you…',
          'Convincing the AI to stop overthinking…',
        ],
      });

      await sleep(4000);

      const streamer = client.chatStream({
        channel: channel,
        recipient_team_id: teamId,
        recipient_user_id: userId,
        thread_ts: thread_ts,
        task_display_mode: 'plan',
      });

      await streamer.append({
        chunks: [
          {
            type: 'markdown_text',
            text: 'Hello.\nI have received the task. ',
          },
          {
            type: 'markdown_text',
            text: 'This task appears manageable.\nThat is good.',
          },
          {
            type: 'task_update',
            id: '001',
            title: 'Understanding the task...',
            status: 'in_progress',
            details: '- Identifying the goal\n- Identifying constraints',
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'pending',
          },
        ],
      });

      await sleep(4000);

      await streamer.append({
        chunks: [
          {
            type: 'plan_update',
            title: 'Adding the final pieces...',
          },
          {
            type: 'task_update',
            id: '001',
            title: 'Understanding the task...',
            status: 'complete',
            details: '\n- Pretending this was obvious',
            output: "We'll continue to ramble now",
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'in_progress',
          },
        ],
      });

      await sleep(4000);

      await streamer.stop({
        chunks: [
          {
            type: 'plan_update',
            title: 'Decided to put on a show',
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'complete',
            details: '- Jumped atop ropes\n- Juggled bowling pins\n- Rode a single wheel too',
          },
          {
            type: 'markdown_text',
            text: 'The crowd appears to be astounded and applauds :popcorn:',
          },
        ],
        blocks: [feedbackBlock],
      });
    } else {
      // This second example shows a generated text response for the provided prompt
      await setStatus({
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
        recipient_team_id: teamId,
        recipient_user_id: userId,
        thread_ts: thread_ts,
        task_display_mode: 'timeline',
      });

      const prompts = await buildThreadHistory(client, channel, thread_ts, { currentText: text, logger });

      const metadata = await callLLM(streamer, prompts, logger);

      // Guard against duplicate finalization
      responseId = generateResponseId(channel, thread_ts, message.ts);
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
    }
  } catch (e) {
    // Roll back the claimed finalization slot so a future delivery attempt can retry.
    if (responseId) rollbackFinalization(responseId);
    logger.error('Failed to handle a user message event:', e);
    await say(':warning: Something went wrong! Please try again later.');
  }
};
