// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { escalateViaSay } from '../../agent/escalation.js';
import { isTicketingEnabled } from '../../agent/ticket-service.js';
import { buildCreateTicketBlocks, routeCommandViaSay, TICKET_NOT_CONFIGURED_TEXT } from './command-handler.js';

/**
 * Dispatches a parsed keyword command from a `say()`-based entry point (the
 * @-mention event or the assistant panel). The `escalate` keyword needs the
 * conversation context (client, ids, thread) and routes to `escalateViaSay`;
 * `help`/`ask`/`search` fall through to `routeCommandViaSay`.
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
 * @param {import("@slack/web-api").WebClient} params.client
 * @param {string} params.userId
 * @param {string} [params.teamId]
 * @param {string} params.channelId
 * @param {string|null} [params.threadTs]
 * @param {string} params.messageTs
 * @param {'mention_escalate'|'assistant_escalate'} params.source
 * @param {(text: string) => Promise<unknown>} [params.replyPrivately]
 */
export async function dispatchKeywordViaSay({
  cmd,
  say,
  logger,
  markInteractionRecorded,
  client,
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  source,
  replyPrivately,
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
  await routeCommandViaSay(say, logger, cmd, threadTs, replyPrivately);
}
