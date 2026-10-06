// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isEscalationEnabled, isTicketingFeatureEnabled } from '../../agent/deployment-flags.js';
import { postEscalation } from '../../agent/escalation.js';
import { recordInteraction } from '../../agent/interaction-store.js';
import { checkRateLimit, rateLimitMessage } from '../../agent/rate-limiter.js';
import { SEARCH_ERROR_TEXT } from '../../agent/search-caller.js';
import { isTicketingEnabled } from '../../agent/ticket-service.js';
import { buildTicketModal } from '../views/ticket_modal.js';
import {
  ASK_DELIVERY_FAILED_TEXT,
  ASK_ERROR_TEXT,
  ASK_TOO_LONG_TEXT,
  buildAskResponse,
  describeError,
  isQuestionTooLong,
} from './ask-handler.js';
import {
  buildHelpText,
  buildSearchResponse,
  ESCALATE_CONFIRM_TEXT,
  ESCALATE_DM_TEXT,
  ESCALATE_ERROR_TEXT,
  TICKET_ERROR_TEXT,
  TICKET_NOT_CONFIGURED_TEXT,
} from './command-handler.js';

const TICKET_SUB_COMMANDS = ['ticket', 'bug', 'feature'];

/**
 * True when `subCommand` belongs to a feature this deployment has switched off
 * (AI-217). Such a sub-command is not routed at all: it goes to `handleUnknown`,
 * which acks with the help text — which no longer lists it either — so the
 * feature leaves no trace in the slash surface. The word the user typed is still
 * logged and recorded as `slash_unknown`.
 *
 * Ticketing is gated on `isTicketingFeatureEnabled`, the flag alone, not
 * `isTicketingEnabled`: flag on with GitHub unconfigured must keep routing so
 * `handleTicket` can answer with TICKET_NOT_CONFIGURED_TEXT.
 */
function isDisabledByFeatureFlag(subCommand) {
  if (subCommand === 'escalate') return !isEscalationEnabled();
  if (TICKET_SUB_COMMANDS.includes(subCommand)) return !isTicketingFeatureEnabled();
  return false;
}

/**
 * Handles the /fiona slash command. Routes to a sub-command handler or falls
 * back to help for unrecognized / missing input.
 */
export const fionaCommandCallback = async ({ command, ack, respond, client, logger }) => {
  logger?.info?.(`/fiona slash command invoked: ${command.text ?? '(empty)'}`);
  const subCommand = (command.text ?? '').trim().split(/\s+/)[0].toLowerCase();

  // Returns before the switch below, so a flagged-off sub-command is handled as
  // if it were never a sub-command at all.
  if (isDisabledByFeatureFlag(subCommand)) {
    await handleUnknown({ command, ack, logger, subCommand });
    return;
  }

  switch (subCommand) {
    case 'help':
    case '':
      await handleHelp({ command, ack, logger });
      break;
    case 'ask':
      await handleAsk({ command, ack, respond, logger });
      break;
    case 'search':
      await handleSearch({ command, ack, respond, logger });
      break;
    case 'escalate':
      await handleEscalate({ command, ack, respond, client, logger });
      break;
    // Preselects Feature, not Bug and not the neutral Question option. Decided
    // 2026-08-05; the rationale and the telemetry signal that would overturn it
    // are recorded in 2026-08-05-ticket-type-question-design.md.
    case 'ticket':
      await handleTicket({ command, ack, respond, client, logger, ticketType: 'feature', invokedAs: 'ticket' });
      break;
    // Aliases. They preselect a type in the same form rather than opening a
    // different one, and record the word the user actually typed.
    case 'bug':
      await handleTicket({ command, ack, respond, client, logger, ticketType: 'bug', invokedAs: 'bug' });
      break;
    case 'feature':
      await handleTicket({ command, ack, respond, client, logger, ticketType: 'feature', invokedAs: 'feature' });
      break;
    default:
      await handleUnknown({ command, ack, logger, subCommand });
      break;
  }
};

/**
 * Builds a recordInteraction payload for slash commands.
 * Slash commands have no thread_ts/message_ts; trigger_id is unique per
 * invocation and serves as both identifiers for the Cosmos document ID.
 */
function slashInteractionRecord(command, interactionType) {
  return {
    userId: command.user_id,
    teamId: command.team_id,
    channelId: command.channel_id,
    threadTs: command.trigger_id,
    messageTs: command.trigger_id,
    interactionType,
    status: 'success',
    errorType: null,
    rateLimited: false,
  };
}

function hasRequiredFields(command) {
  return Boolean(command.user_id && command.channel_id && command.trigger_id);
}

function fireAndForgetRecord({ command, logger, interactionType, errorType = null, rateLimited = false }) {
  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping interaction record');
    return;
  }
  recordInteraction({
    ...slashInteractionRecord(command, interactionType),
    ...(errorType ? { status: 'error', errorType } : {}),
    rateLimited,
    logger,
  }).catch((err) => logger?.warn?.(`Failed to record ${interactionType} interaction: ${err.name}`));
}

/**
 * The steps every private slash sub-command shares before its own work:
 * acknowledge, check the required fields, apply the rate limit. Each failure
 * answers the user ephemerally and, where it is a real interaction, records it.
 *
 * Returns a `reply` function that sends an ephemeral message and logs rather
 * than throws, or null when the sub-command should stop. A handler that needs to
 * know whether its main response was delivered calls `respond` itself.
 *
 * @param {Object} params
 * @param {string} params.name - The sub-command, for the missing-fields log line.
 * @param {string} [params.invokedAs] - The word the user typed, for the ack and
 *   respond log lines. Defaults to `name`; differs for ticket aliases.
 * @param {string} params.interactionType - Telemetry name for the rate-limit record.
 * @param {Object} [params.ackMessage] - Sent with the ack instead of an empty ack.
 * @param {boolean} [params.replaceOriginal] - Replies replace the ack message.
 * @param {string} params.missingFieldsText - Copy sent when required fields are missing.
 * @param {(reply: Function) => Promise<boolean>} [params.checkAvailable] - Runs
 *   before the rate limit; returning false stops the sub-command (it has already
 *   replied).
 * @returns {Promise<((message: Object) => Promise<void>) | null>}
 */
async function startPrivateSlashCommand({
  command,
  ack,
  respond,
  logger,
  name,
  invokedAs = name,
  interactionType,
  ackMessage,
  replaceOriginal = false,
  missingFieldsText,
  checkAvailable,
}) {
  try {
    await (ackMessage ? ack(ackMessage) : ack());
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona ${invokedAs}: ${err.name}`);
    return null;
  }

  const reply = (message) =>
    respond({ response_type: 'ephemeral', ...(replaceOriginal ? { replace_original: true } : {}), ...message }).catch(
      (err) => logger?.error?.(`Failed to respond to /fiona ${invokedAs}: ${describeError(err)}`),
    );

  if (!hasRequiredFields(command)) {
    logger?.warn?.(`Missing required slash command fields; skipping ${name}`);
    await reply({ text: missingFieldsText });
    return null;
  }

  if (checkAvailable && !(await checkAvailable(reply))) return null;

  const { allowed, retryAfterMs } = checkRateLimit(command.user_id);
  if (!allowed) {
    await reply({ text: rateLimitMessage(retryAfterMs) });
    fireAndForgetRecord({ command, logger, interactionType, errorType: 'rate_limited', rateLimited: true });
    return null;
  }

  return reply;
}

async function handleHelp({ command, ack, logger }) {
  try {
    // ack(string) sends an immediate ephemeral response that only the invoking user sees
    await ack(buildHelpText());
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona help: ${err.name}`);
    return;
  }
  fireAndForgetRecord({ command, logger, interactionType: 'slash_help' });
}

const ASK_THINKING_TEXT = ':hourglass_flowing_sand: Thinking…';

/**
 * Handles the `/fiona ask <question>` sub-command.
 *
 * Answers ephemerally: `respond()` with response_type ephemeral, so only the
 * person who asked sees the question and the answer in Slack, even in a public
 * channel. The answer itself comes from buildAskResponse, shared with the `ask`
 * keyword path.
 *
 * The acknowledgement is a visible "Thinking…" line, because the answer can take
 * up to a minute and a silent wait invites resubmits that spend the rate limit.
 * Every later reply replaces it (`replace_original`).
 *
 * Falls back to the help response when no question is provided.
 */
async function handleAsk({ command, ack, respond, logger }) {
  const question = (command.text ?? '').trim().slice('ask'.length).trim();

  // Empty question: fall back to help (same as /fiona with no sub-command)
  if (!question) {
    await handleHelp({ command, ack, logger });
    return;
  }

  const reply = await startPrivateSlashCommand({
    command,
    ack,
    respond,
    logger,
    name: 'ask',
    interactionType: 'slash_ask',
    ackMessage: { response_type: 'ephemeral', text: ASK_THINKING_TEXT },
    replaceOriginal: true,
    missingFieldsText: ASK_ERROR_TEXT,
    // Before the rate limit, so a question that will be declined anyway does not
    // spend the user's budget.
    checkAvailable: async (sendReply) => {
      if (!isQuestionTooLong(question, logger)) return true;
      await sendReply({ text: ASK_TOO_LONG_TEXT });
      fireAndForgetRecord({ command, logger, interactionType: 'slash_ask', errorType: 'question_too_long' });
      return false;
    },
  });
  if (!reply) return;

  // buildAskResponse absorbs LLM failures and reports them through errorType.
  // Anything else it throws is a bug in building the answer, recorded as
  // ask_failed and kept apart from a failure to deliver a built answer.
  let built;
  try {
    built = await buildAskResponse({
      question,
      logger,
      interactionType: 'slash_ask',
      userId: command.user_id,
      teamId: command.team_id,
      channelId: command.channel_id,
      // Slash commands have no thread or message timestamp; trigger_id is unique
      // per invocation and stands in for both, as in slashInteractionRecord.
      threadTs: command.trigger_id,
      messageTs: command.trigger_id,
    });
  } catch (err) {
    logger?.error?.(`Failed to build /fiona ask answer: ${describeError(err)}`);
    await reply({ text: ASK_ERROR_TEXT });
    fireAndForgetRecord({ command, logger, interactionType: 'slash_ask', errorType: 'ask_failed' });
    return;
  }

  // The conversation is captured only once the answer has been delivered.
  const { response, errorType, capture } = built;
  try {
    await respond({ response_type: 'ephemeral', replace_original: true, ...response });
  } catch (err) {
    logger?.error?.(`Failed to respond to /fiona ask: ${describeError(err)}`);
    await reply({ text: ASK_DELIVERY_FAILED_TEXT });
    fireAndForgetRecord({ command, logger, interactionType: 'slash_ask', errorType: 'respond_failed' });
    return;
  }
  fireAndForgetRecord({ command, logger, interactionType: 'slash_ask', errorType });
  await capture();
}

async function handleSearch({ command, ack, respond, logger }) {
  const rawText = (command.text ?? '').trim();
  // Extract everything after the leading 'search' token as the query.
  const query = rawText.slice('search'.length).trim();

  if (!query) {
    // Empty query: fall back to help (same as /fiona with no sub-command)
    await handleHelp({ command, ack, logger });
    return;
  }

  const reply = await startPrivateSlashCommand({
    command,
    ack,
    respond,
    logger,
    name: 'search',
    interactionType: 'slash_search',
    missingFieldsText: SEARCH_ERROR_TEXT,
  });
  if (!reply) return;

  logger?.info?.(`/fiona search: querying for "${query}"`);
  // buildSearchResponse never throws on search failure — it substitutes an error
  // message and reports the failure via errorType, so carry that into telemetry.
  let response;
  let errorType;
  try {
    ({ response, errorType } = await buildSearchResponse(query, logger, 'slash_search'));
    await respond({ response_type: 'ephemeral', ...response });
  } catch (err) {
    logger?.error?.(`Failed to respond to /fiona search: ${err.name}`);
    return;
  }

  fireAndForgetRecord({ command, logger, interactionType: 'slash_search', errorType });
}

async function handleUnknown({ command, ack, logger, subCommand }) {
  logger?.warn?.(`Unrecognized /fiona sub-command: "${subCommand}"`);
  try {
    // ack(string) sends an immediate ephemeral response that only the invoking user sees
    await ack(buildHelpText());
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona unknown command: ${err.name}`);
    return;
  }
  fireAndForgetRecord({ command, logger, interactionType: 'slash_unknown' });
}

function isDmChannel(command) {
  return command.channel_name === 'directmessage' || (command.channel_id || '').startsWith('D');
}

async function handleEscalate({ command, ack, respond, client, logger }) {
  const reply = await startPrivateSlashCommand({
    command,
    ack,
    respond,
    logger,
    name: 'escalate',
    interactionType: 'slash_escalate',
    missingFieldsText: ESCALATE_ERROR_TEXT,
  });
  if (!reply) return;

  const dm = isDmChannel(command);
  const result = await postEscalation({
    client,
    userId: command.user_id,
    teamId: command.team_id,
    channelId: command.channel_id,
    threadTs: null,
    messageTs: command.trigger_id,
    source: 'slash_escalate',
    isDm: dm,
    logger,
  });

  // postEscalation records the interaction on both success and failure; this
  // path only renders the ephemeral confirmation or error to the invoking user.
  await respond({
    response_type: 'ephemeral',
    text: result.ok ? (dm ? ESCALATE_DM_TEXT : ESCALATE_CONFIRM_TEXT) : ESCALATE_ERROR_TEXT,
  });
}

/**
 * Opens the ticket modal. `invokedAs` is the word the user typed and drives every
 * telemetry name and log line; `ticketType` only preselects the dropdown. Keeping
 * them separate is what lets `/fiona bug` record slash_bug while opening a form
 * the user can switch to a feature before submitting.
 */
async function handleTicket({ command, ack, respond, client, logger, ticketType, invokedAs }) {
  const interactionType = `slash_${invokedAs}`;
  const reply = await startPrivateSlashCommand({
    command,
    ack,
    respond,
    logger,
    name: 'ticket',
    invokedAs,
    interactionType,
    missingFieldsText: TICKET_NOT_CONFIGURED_TEXT,
    // Checked before the rate limit, so an unconfigured deployment does not
    // spend the user's budget on a form it cannot open.
    checkAvailable: async (sendReply) => {
      if (isTicketingEnabled()) return true;
      await sendReply({ text: TICKET_NOT_CONFIGURED_TEXT });
      fireAndForgetRecord({ command, logger, interactionType, errorType: 'not_configured' });
      return false;
    },
  });
  if (!reply) return;

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: buildTicketModal({ ticketType, channelId: command.channel_id }),
    });
    fireAndForgetRecord({ command, logger, interactionType });
  } catch (err) {
    logger?.error?.(`Failed to open ${invokedAs} modal: ${err.message}`);
    await reply({ text: TICKET_ERROR_TEXT });
  }
}
