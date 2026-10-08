// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { captureConversation } from '../../agent/conversation-capture-store.js';
import {
  handleInteractionWithTelemetry,
  logCitationTelemetry,
  waitForMetadataReady,
} from '../../agent/interaction-telemetry.js';
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
import { declineOverLongAsk, dispatchKeywordViaSay } from '../commands/command-dispatch.js';
import { parseCommandKeyword } from '../commands/command-handler.js';
import { createFeedbackBlock, FEEDBACK_RESPONSE_TYPES } from '../views/feedback_block.js';
import { createSourcesBlocks } from '../views/sources_block.js';

/**
 * The text of an `ask` mention with the invoking mention(s) removed and every
 * later mention replaced by a neutral marker, so the question still reads as a
 * sentence. It is shown back to the user ("You asked:") and stored with
 * feedback, so no user or channel id is kept.
 */
function askTextWithMentionMarkers(text) {
  return text
    .replace(/^(?:\s*<@[^>]+>)+/, '')
    .replace(/<(?:@|!subteam\^)[^>]+>/g, '@someone')
    .replace(/<#[^>]+>/g, '#a-channel')
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<![^>]+>/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
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
  const { channel, team, user } = event;
  const thread_ts = event.thread_ts || event.ts;
  const messageTs = event.ts;
  // Bolt's say() posts to the channel root, so every reply in the mention flow
  // (telemetry's error notice, the rate-limit notice, the greeting, keyword
  // replies) goes through this wrapper instead of adding thread_ts per call.
  //
  // For a top-level mention, thread_ts is the mention's own ts, so these notices
  // open a thread under it: the same place the streamed answer goes. Ephemeral
  // keyword answers are the exception (see ephemeralTarget). Slack cannot start
  // a thread with an ephemeral, so for a top-level mention those appear inline.
  const threadedSay = (msg) => say(typeof msg === 'string' ? { text: msg, thread_ts } : { thread_ts, ...msg });

  await handleInteractionWithTelemetry(
    {
      userId: user,
      teamId: team,
      channelId: channel,
      threadTs: thread_ts,
      messageTs,
      interactionType: 'app_mention',
      logger,
      say: threadedSay,
    },
    async ({ claimResponseId, markRateLimited, markInteractionRecorded, markInteractionError }) => {
      // Strip Slack mention tokens (users, channels, special commands) before sending to LLM
      const text = (event.text || '').replace(/<[@#!][^>]+>/g, '').trim();
      let cmd = text ? parseCommandKeyword(text) : null;
      if (cmd?.keyword === 'ask') {
        const marked = parseCommandKeyword(askTextWithMentionMarkers(event.text));
        if (marked?.keyword === 'ask') cmd = marked;
      }

      if (
        await declineOverLongAsk({
          cmd,
          say: threadedSay,
          client,
          logger,
          userId: user,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          interactionType: 'app_mention',
          markInteractionError,
        })
      ) {
        return;
      }

      if (
        await handleRateLimitedInteraction({
          userId: user,
          teamId: team,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          interactionType: 'app_mention',
          logger,
          say: threadedSay,
          markRateLimited,
          markInteractionRecorded,
        })
      ) {
        return;
      }

      // Respond with a helpful introduction when there is no message text (silently discard, don't record)
      if (!text) {
        markInteractionRecorded();
        await threadedSay(
          "Hi, I'm Fiona, your Ed-Fi AI assistant! Ask me anything about Ed-Fi standards, documentation, or implementations.",
        );
        return;
      }

      // Route command keywords (help, ask, search, escalate) before invoking the LLM.
      // Only exact "help"/"escalate" match; "@fiona help me with X" falls through to the LLM.
      if (cmd) {
        await dispatchKeywordViaSay({
          cmd,
          say: threadedSay,
          logger,
          telemetry: { markInteractionRecorded, markInteractionError, claimResponseId },
          client,
          userId: user,
          teamId: team,
          channelId: channel,
          threadTs: thread_ts,
          messageTs,
          source: 'mention_escalate',
          interactionType: 'app_mention',
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
      logCitationTelemetry(logger, metadata);

      await streamer.stop({
        blocks: [
          ...createSourcesBlocks(metadata),
          createFeedbackBlock({
            responseType: FEEDBACK_RESPONSE_TYPES.SYNTHESIS,
            interactionType: 'app_mention',
          }),
        ],
      });
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
