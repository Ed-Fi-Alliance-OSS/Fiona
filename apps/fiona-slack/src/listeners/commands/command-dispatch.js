// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { escalateViaSay } from '../../agent/escalation.js';
import { isTicketingEnabled } from '../../agent/ticket-service.js';
import { generateResponseId, rollbackFinalization, shouldFinalize } from '../../agent/utils/idempotent-finalize.js';
import { buildAskResponse, streamAskResponse } from './ask-handler.js';
import {
  buildCreateTicketBlocks,
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
    // capture record. For an @-mention, the question is already visible to the
    // channel but the answer is ephemeral. In the private assistant panel, the
    // answer streams into the thread like any other response.
    const responseId = generateResponseId(channelId, threadTs, messageTs);
    claimResponseId(responseId);
    if (!shouldFinalize(responseId, logger)) {
      return;
    }

    if (interactionType === 'app_mention') {
      const { response, errorType } = await buildAskResponse({
        question: cmd.rawArgs,
        logger,
        interactionType,
        userId,
        teamId,
        channelId,
        threadTs,
        messageTs,
      });
      if (errorType) markInteractionError(errorType);
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          ...(threadTs && threadTs !== messageTs ? { thread_ts: threadTs } : {}),
          ...response,
        });
      } catch (err) {
        rollbackFinalization(responseId);
        markInteractionError('post_failed');
        logger?.error?.(`Failed to send ephemeral ask response: ${err.name}: ${err.message}`);
      }
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
      threadTs: threadTs === messageTs ? null : threadTs,
      query: cmd.rawArgs,
      interactionType,
    });
    return;
  }
  await routeCommandViaSay(say, logger, cmd, { interactionType });
}
