// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { escalateViaSay } from '../../agent/escalation.js';
import { isTicketingEnabled } from '../../agent/ticket-service.js';
import { generateResponseId, rollbackFinalization, shouldFinalize } from '../../agent/utils/idempotent-finalize.js';
import {
  ASK_DELIVERY_FAILED_TEXT,
  ASK_ERROR_TEXT,
  ASK_TOO_LONG_TEXT,
  buildAskResponse,
  describeError,
  isQuestionTooLong,
  streamAskResponse,
} from './ask-handler.js';
import {
  buildCreateTicketBlocks,
  ephemeralTarget,
  handleHelpEphemeral,
  handleSearchEphemeral,
  postEphemeralSafely,
  routeCommandViaSay,
  TICKET_NOT_CONFIGURED_TEXT,
} from './command-handler.js';

// The one surface that is already private, so it answers with say() and
// streams `ask`. Every other surface answers ephemerally (fail closed).
const ASSISTANT_PANEL = 'assistant_message';

/**
 * Dispatches a parsed keyword command from a `say()`-based entry point (the
 * @-mention event or the assistant panel). The `escalate` keyword needs the
 * conversation context (client, ids, thread) and routes to `escalateViaSay`;
 * `ask`, `search` and `help` answer ephemerally everywhere except the agent
 * panel, where search and help fall through to `routeCommandViaSay`.
 *
 * Shared by the app_mention and assistant message listeners so the
 * escalate-vs-route branch — and the "record the escalate turn exactly once"
 * contract — lives in one place instead of being copy-pasted into each handler.
 *
 * @param {Object} params
 * @param {{ keyword: string, rawArgs: string }} params.cmd - Parsed command.
 * @param {import("@slack/bolt").SayFn} params.say
 * @param {import("@slack/logger").Logger} [params.logger]
 * @param {Object} params.telemetry - The helpers `handleInteractionWithTelemetry`
 *   hands its callback. A new helper belongs here, not as another top-level param.
 * @param {() => void} params.telemetry.markInteractionRecorded - Suppresses the
 *   wrapper's turn record for escalate (postEscalation records it exactly once).
 * @param {(errorType: string) => void} params.telemetry.markInteractionError -
 *   Records a handled failure without triggering the wrapper's public warning.
 * @param {(responseId: string) => void} params.telemetry.claimResponseId -
 *   Registers the claimed response so the wrapper can release it if an error
 *   escapes.
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
  telemetry,
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
    telemetry.markInteractionRecorded();
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
    // Claimed before the duplicate check, as the app_mention and assistant
    // paths do. That is safe: a duplicate returns straight away, and the
    // wrapper only releases the claim when an error escapes, which a duplicate
    // never reaches.
    const responseId = generateResponseId(channelId, threadTs, messageTs);
    telemetry.claimResponseId(responseId);
    if (!shouldFinalize(responseId, logger)) {
      return;
    }

    if (interactionType !== ASSISTANT_PANEL) {
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
        markInteractionError: telemetry.markInteractionError,
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
    if (streamResult?.errorType) telemetry.markInteractionError(streamResult.errorType);
    return;
  }
  // Help and search use the same fail-closed rule as ask: only the agent panel,
  // which is already private, answers through say(). Help matches /fiona help,
  // which is ephemeral; whether an ephemeral renders in the panel is unverified.
  if ((cmd.keyword === 'search' || cmd.keyword === 'help') && interactionType !== ASSISTANT_PANEL) {
    const target = ephemeralTarget({ channelId, userId, threadTs, messageTs });
    const { errorType } =
      cmd.keyword === 'search'
        ? await handleSearchEphemeral(client, logger, target, { query: cmd.rawArgs, interactionType })
        : await handleHelpEphemeral(client, logger, target);
    if (errorType) telemetry.markInteractionError(errorType);
    return;
  }
  await routeCommandViaSay(say, logger, cmd, { interactionType });
}

/**
 * Declines an over-long `ask` question before the caller spends the user's rate
 * limit on it. Call it ahead of the rate-limit check; it returns true when it
 * has answered and the caller should stop.
 *
 * The decline is private: ephemeral on an @-mention, where the channel would
 * otherwise see it, and an ordinary say() in the assistant panel, which only the
 * user sees.
 *
 * Not being rate limited is deliberate (AI-250): the decline costs no LLM call
 * and only the sender sees it, while counting it would let an over-long paste
 * lock the user out of asking the shorter question. A Slack retry of the same
 * event is still caught by the duplicate guard, so it is declined only once.
 *
 * @param {Object} params - As for dispatchKeywordViaSay. `telemetry` needs
 *   `markInteractionError` and `claimResponseId`.
 * @returns {Promise<boolean>}
 */
export async function declineOverLongAsk({
  cmd,
  say,
  client,
  logger,
  telemetry,
  userId,
  channelId,
  threadTs,
  messageTs,
  interactionType,
}) {
  if (cmd?.keyword !== 'ask' || !isQuestionTooLong(cmd.rawArgs, logger)) return false;
  // Claimed before the duplicate check, as the ask path in dispatchKeywordViaSay does.
  const responseId = generateResponseId(channelId, threadTs, messageTs);
  telemetry.claimResponseId(responseId);
  if (!shouldFinalize(responseId, logger)) return true;
  telemetry.markInteractionError('question_too_long');
  let delivered;
  if (interactionType === ASSISTANT_PANEL) {
    delivered = await say({ text: ASK_TOO_LONG_TEXT, thread_ts: threadTs }).then(
      () => true,
      (err) => {
        logger?.warn?.(`Failed to send ask too-long notice: ${describeError(err)}`);
        return false;
      },
    );
  } else {
    const target = ephemeralTarget({ channelId, userId, threadTs, messageTs });
    const { errorType } = await postEphemeralSafely(
      client,
      logger,
      target,
      { text: ASK_TOO_LONG_TEXT },
      'ask too-long',
    );
    delivered = !errorType;
  }
  // The user never saw the decline, so a Slack retry should get to send it.
  if (!delivered) rollbackFinalization(responseId);
  return true;
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
 *
 * Nothing is rethrown. An error escaping to handleInteractionWithTelemetry
 * would post its warning with say(), in front of the whole channel, so an
 * unexpected failure building the answer is answered ephemerally here instead.
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
  const target = ephemeralTarget({ channelId, userId, threadTs, messageTs });

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
  } catch (err) {
    // A retry should run the pipeline again rather than hit the duplicate guard.
    rollbackFinalization(responseId);
    markInteractionError('ask_failed');
    logger?.error?.(`Failed to build ask answer: ${describeError(err)}`);
    await postEphemeralSafely(client, logger, target, { text: ASK_ERROR_TEXT }, 'ask error');
    return;
  } finally {
    await setThinkingStatus(client, logger, channelId, threadTs, '');
  }

  const { response, errorType, capture } = built;
  if (errorType) markInteractionError(errorType);
  const { errorType: postErrorType } = await postEphemeralSafely(client, logger, target, response, 'ask');
  if (postErrorType) {
    rollbackFinalization(responseId);
    markInteractionError(postErrorType);
    await postEphemeralSafely(client, logger, target, { text: ASK_DELIVERY_FAILED_TEXT }, 'ask delivery-failure');
    return;
  }
  await capture();
}
