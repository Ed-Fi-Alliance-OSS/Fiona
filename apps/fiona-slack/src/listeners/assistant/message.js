// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { callLLM } from '../../agent/llm-caller.js';
import { checkRateLimit } from '../../agent/rate-limiter.js';
import { buildThreadHistory } from '../../agent/thread-history.js';
import { feedbackBlock } from '../views/feedback_block.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

      await callLLM(streamer, prompts, logger);
      await streamer.stop({ blocks: [feedbackBlock] });
    }
  } catch (e) {
    logger.error('Failed to handle a user message event:', e);
    await say(':warning: Something went wrong! Please try again later.');
  }
};
