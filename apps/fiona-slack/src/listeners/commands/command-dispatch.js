// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { escalateViaSay } from '../../agent/escalation.js';
import { isTicketingEnabled } from '../../agent/ticket-service.js';
import { generateResponseId, rollbackFinalization, shouldFinalize } from '../../agent/utils/idempotent-finalize.js';
import { ASK_DELIVERY_FAILED_TEXT, buildAskResponse, describeError, streamAskResponse } from './ask-handler.js';
import {
  buildCreateTicketBlocks,
  ephemeralThreadTs,
  handleSearchEphemeral,
  routeCommandViaSay,
  TICKET_NOT_CONFIGURED_TEXT,
} from './command-handler.js';

/**
 * Dispatches a parsed keyword command from a `say()`-based entry point (the
 * @-mention event or the assistant panel). The `escalate` keyword needs the
 * conversation context (client, ids, thread) and routes to `escalateViaSay`;
 * `ask` and `search` answer through their own pipelines; `help` falls through
 * to `routeCommandViaSay`.
 *
 * Shared by the app_mention and assistant message listeners so the
 * escalate-vs-route branch — and the "record the escalate turn exactly once"
 * contract — lives in one place instead of being copy-pasted into each handler.
 *
 * @param {Object} params
 * @param {{ keyword: string, rawArgs: string }} params.cmd - Parsed command.
 * @param {import("@slack/bolt").SayFn} params.say
 * @param {import("@slack/logger").Logger} [params.logger]
 * @param {() => void} params.markInteractionRecorded - Suppresses the telemetry
 *   wrapper's turn record for escalate (postEscalation records it exactly once).
 * @param {(errorType: string) => void} params.markInteractionError - Records a
 *   handled failure without triggering the telemetry wrapper's public warning.
 * @param {(responseId: string) => void} params.claimResponseId - Registers the
 *   claimed response so the telemetry wrapper can release it if an error escapes.
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.userId
 * @param {string} [params.teamId]
 * @param {string} params.channelId
 * @param {string|null} [params.threadTs]
 * @param {string} params.messageTs
 * @param {'mention_escalate'|'assistant_escalate'} params.source
 */
export async function dispatchKeywordViaSay({
  cmd,
  say,
  logger,
  markInteractionRecorded,
  markInteractionError,
  claimResponseId,
  client,
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  source,
  interactionType,
}) {
  if (cmd.keyword === 'file_ticket') {
    // Don't offer a button that opens a modal the feature cannot honour — the
    // docs state the modal is never opened while ticketing is unconfigured.
    if (!isTicketingEnabled()) {
      await say({ text: TICKET_NOT_CONFIGURED_TEXT, thread_ts: threadTs }).catch((err) =>
        logger?.warn?.(`Failed to post ticket not-configured notice: ${err.message}`),
      );
      return;
    }
    const blocks = buildCreateTicketBlocks(cmd.rawArgs, channelId, threadTs);
    await say({ text: 'Would you like to create an issue?', blocks, thread_ts: threadTs }).catch((err) =>
      logger?.warn?.(`Failed to offer ticket button: ${err.message}`),
    );
    return;
  }
  if (cmd.keyword === 'escalate') {
    // postEscalation records the escalate interaction itself; suppress the
    // telemetry wrapper's turn record so the event is counted exactly once.
    markInteractionRecorded();
    await escalateViaSay({
      client,
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
      source,
      isDm: (channelId || '').startsWith('D'),
      say,
      logger,
    });
    return;
  }
  if (cmd.keyword === 'ask') {
    // Held in lock step with the slash command: same prompt, feedback block, and
    // capture record. Only the assistant panel, which is already private, streams
    // the answer into the thread. Every other surface gets an ephemeral answer, so
    // a new caller fails closed rather than posting a private answer publicly.
    const responseId = generateResponseId(channelId, threadTs, messageTs);
    claimResponseId(responseId);
    if (!shouldFinalize(responseId, logger)) {
      return;
    }

    if (interactionType !== 'assistant_message') {
      await answerAskEphemerally({
        client,
        logger,
        question: cmd.rawArgs,
        interactionType,
        userId,
        teamId,
        channelId,
        threadTs,
        messageTs,
        responseId,
        markInteractionError,
      });
      return;
    }
    const streamResult = await streamAskResponse({
      client,
      logger,
      question: cmd.rawArgs,
      interactionType,
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
    });
    if (streamResult?.errorType) markInteractionError(streamResult.errorType);
    return;
  }
  if (cmd.keyword === 'search' && interactionType === 'app_mention') {
    await handleSearchEphemeral(client, logger, {
      userId,
      channelId,
      threadTs: ephemeralThreadTs(threadTs, messageTs),
      query: cmd.rawArgs,
      interactionType,
    });
    return;
  }
  await routeCommandViaSay(say, logger, cmd, { interactionType });
}

/**
 * Sets or clears the thread's "thinking" status. Best effort: a status is a
 * courtesy, and failing to show one must not stop the answer.
 */
async function setThinkingStatus(client, logger, channelId, threadTs, status) {
  if (!threadTs) return;
  try {
    await client.assistant.threads.setStatus({ channel_id: channelId, thread_ts: threadTs, status });
  } catch (err) {
    logger?.warn?.(`Failed to set ask thinking status: ${describeError(err)}`);
  }
}

/**
 * Answers an `ask` keyword with an ephemeral message. The question is already
 * visible to the channel; the answer is not.
 *
 * A "thinking" status covers the LLM wait, because an ephemeral answer gives no
 * sign of progress until it arrives. It is cleared explicitly: Slack clears it
 * when the bot posts in the thread, and an ephemeral post does not count.
 *
 * If the post fails, the user gets a short plain-text notice instead of
 * silence, and the conversation is not captured, because the answer was never
 * seen.
 */
async function answerAskEphemerally({
  client,
  logger,
  question,
  interactionType,
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  responseId,
  markInteractionError,
}) {
  const replyThreadTs = ephemeralThreadTs(threadTs, messageTs);
  const ephemeralTarget = {
    channel: channelId,
    user: userId,
    ...(replyThreadTs ? { thread_ts: replyThreadTs } : {}),
  };

  await setThinkingStatus(client, logger, channelId, threadTs, 'thinking...');
  let built;
  try {
    built = await buildAskResponse({
      question,
      logger,
      interactionType,
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
    });
  } finally {
    await setThinkingStatus(client, logger, channelId, threadTs, '');
  }

  const { response, errorType, capture } = built;
  if (errorType) markInteractionError(errorType);
  try {
    await client.chat.postEphemeral({ ...ephemeralTarget, ...response });
  } catch (err) {
    rollbackFinalization(responseId);
    markInteractionError('post_failed');
    logger?.error?.(`Failed to send ephemeral ask response: ${describeError(err)}`);
    await client.chat
      .postEphemeral({ ...ephemeralTarget, text: ASK_DELIVERY_FAILED_TEXT })
      .catch((fallbackErr) =>
        logger?.warn?.(`Failed to send ask delivery-failure notice: ${describeError(fallbackErr)}`),
      );
    return;
  }
  await capture();
}
