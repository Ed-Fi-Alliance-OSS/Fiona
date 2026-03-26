// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { callLLM } from '../../agent/llm-caller.js';
import { checkRateLimit } from '../../agent/rate-limiter.js';
import { buildThreadHistory } from '../../agent/thread-history.js';
import { feedbackBlock } from '../views/feedback_block.js';

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
  try {
    const { channel, team, user } = event;
    const thread_ts = event.thread_ts || event.ts;

    const { allowed, retryAfterMs } = checkRateLimit(user);
    if (!allowed) {
      const minutes = Math.ceil(retryAfterMs / 60000);
      await say(
        `:no_entry: You've reached the request limit. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`,
      );
      return;
    }

    // Strip Slack mention tokens (users, channels, special commands) before sending to LLM
    const text = (event.text || '').replace(/<[@#!][^>]+>/g, '').trim();

    // Respond with a helpful introduction when there is no message text
    if (!text) {
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

    await callLLM(streamer, prompts, logger);

    await streamer.stop({ blocks: [feedbackBlock] });
  } catch (e) {
    logger.error('Failed to handle a user message event:', e);
    await say(':warning: Something went wrong! Please try again later.');
  }
};
