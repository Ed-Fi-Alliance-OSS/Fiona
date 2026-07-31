// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { captureConversation } from '../../agent/conversation-capture-store.js';
import { handleInteractionWithTelemetry, waitForMetadataReady } from '../../agent/interaction-telemetry.js';
import {
  CITATION_POLICY,
  callLLM,
  finalizeMetadataEnvelope,
  LLM_MODEL,
  SYSTEM_PROMPT_VERSION,
} from '../../agent/llm-caller.js';
import { handleRateLimitedInteraction } from '../../agent/rate-limited-handler.js';
import { buildThreadHistory } from '../../agent/thread-history.js';
import { generateResponseId, shouldFinalize } from '../../agent/utils/idempotent-finalize.js';
import { dispatchKeywordViaSay } from '../commands/command-dispatch.js';
import { parseCommandKeyword } from '../commands/command-handler.js';
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
/**
 * Builds a `say`-shaped reply that posts privately to the invoking user, matching
 * the ephemeral behaviour of `/fiona help`.
 *
 * `thread_ts` is only set when the mention is genuinely inside an existing thread:
 * Slack renders an ephemeral in a thread only if that thread already exists, so
 * passing a top-level message's own `ts` would silently show the user nothing.
 */
function replyEphemerally({ client, channel, user, event, logger }) {
  return async ({ text }) => {
    try {
      await client.chat.postEphemeral({
        channel,
        user,
        text,
        ...(event.thread_ts ? { thread_ts: event.thread_ts } : {}),
      });
    } catch (err) {
      logger?.error?.(`Failed to send ephemeral response: ${err.name}`);
    }
  };
}

export const appMentionCallback = async ({ event, client, logger, say }) => {
  const { channel, team, user } = event;
  const thread_ts = event.thread_ts || event.ts;
  const messageTs = event.ts;

  await handleInteractionWithTelemetry(
    {
      userId: user,
      teamId: team,
      channelId: channel,
      threadTs: thread_ts,
      messageTs,
      interactionType: 'app_mention',
      logger,
      say,
    },
    async ({ claimResponseId, markRateLimited, markInteractionRecorded }) => {
      if (
        await handleRateLimitedInteraction({
          userId: user,
          teamId: team,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          interactionType: 'app_mention',
          logger,
          say,
          markRateLimited,
          markInteractionRecorded,
        })
      ) {
        return;
      }

      // Strip Slack mention tokens (users, channels, special commands) before sending to LLM
      const text = (event.text || '').replace(/<[@#!][^>]+>/g, '').trim();

      // Respond with a helpful introduction when there is no message text (silently discard, don't record)
      if (!text) {
        markInteractionRecorded();
        await say({
          text: "Hi, I'm Fiona, your Ed-Fi AI assistant! Ask me anything about Ed-Fi standards, documentation, or implementations.",
          thread_ts,
        });
        return;
      }

      // Route command keywords (help, ask, search, escalate) before invoking the LLM.
      // Only exact "help"/"escalate" match; "@fiona help me with X" falls through to the LLM.
      const cmd = parseCommandKeyword(text);
      if (cmd) {
        await dispatchKeywordViaSay({
          cmd,
          say,
          replyPrivately: replyEphemerally({ client, channel, user, event, logger }),
          logger,
          markInteractionRecorded,
          client,
          userId: user,
          teamId: team,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          source: 'mention_escalate',
        });
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

      const { metadata, botText, systemPromptVersion } = await callLLM(streamer, prompts, logger);

      // Guard against duplicate finalization
      const responseId = generateResponseId(channel, thread_ts, event.ts);
      claimResponseId(responseId);
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

      try {
        await captureConversation({
          userId: user,
          teamId: team,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          entryPoint: 'app_mention',
          userMessage: text,
          botResponse: botText,
          threadHistory: prompts,
          llmProvider: metadata?.provider ?? 'perplexity',
          llmModel: LLM_MODEL,
          systemPromptVersion: systemPromptVersion ?? SYSTEM_PROMPT_VERSION,
          sources: metadata?.sources,
          logger,
        });
      } catch (err) {
        logger?.warn?.(`Failed to capture conversation: ${err.message}`);
      }
    },
  );
};
