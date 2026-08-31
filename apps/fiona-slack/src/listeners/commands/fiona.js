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
  ASK_NOT_YET_TEXT,
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
 * back to help for unrecognized / missing input. Never invokes the LLM.
 */
export const fionaCommandCallback = async ({ command, ack, respond, client, logger }) => {
  logger?.info?.(`/fiona slash command invoked: ${command.text ?? '(empty)'}`);
  const subCommand = (command.text ?? '').trim().split(/\s+/)[0].toLowerCase();

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
      await handleComingSoon({ command, ack, logger, subCommand: 'ask', text: ASK_NOT_YET_TEXT });
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

function fireAndForgetRecord({ command, logger, interactionType, errorType = null }) {
  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping interaction record');
    return;
  }
  recordInteraction({
    ...slashInteractionRecord(command, interactionType),
    ...(errorType ? { status: 'error', errorType } : {}),
    logger,
  }).catch((err) => logger?.warn?.(`Failed to record ${interactionType} interaction: ${err.name}`));
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

async function handleComingSoon({ command, ack, logger, subCommand, text }) {
  try {
    // ack(string) sends an immediate ephemeral response that only the invoking user sees
    await ack(text);
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona ${subCommand}: ${err.name}`);
    return;
  }
  fireAndForgetRecord({ command, logger, interactionType: `slash_${subCommand}` });
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

  try {
    await ack();
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona search: ${err.name}`);
    return;
  }

  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping search');
    await respond({ response_type: 'ephemeral', text: SEARCH_ERROR_TEXT });
    return;
  }

  const { allowed, retryAfterMs } = checkRateLimit(command.user_id);
  if (!allowed) {
    await respond({ response_type: 'ephemeral', text: rateLimitMessage(retryAfterMs) });
    recordInteraction({
      ...slashInteractionRecord(command, 'slash_search'),
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_search interaction: ${err.name}`));
    return;
  }

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
  try {
    await ack();
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona escalate: ${err.name}`);
    return;
  }

  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping escalate');
    await respond({ response_type: 'ephemeral', text: ESCALATE_ERROR_TEXT });
    return;
  }

  const { allowed, retryAfterMs } = checkRateLimit(command.user_id);
  if (!allowed) {
    await respond({ response_type: 'ephemeral', text: rateLimitMessage(retryAfterMs) });
    recordInteraction({
      ...slashInteractionRecord(command, 'slash_escalate'),
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_escalate interaction: ${err.name}`));
    return;
  }

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
  try {
    await ack();
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona ${invokedAs}: ${err.name}`);
    return;
  }

  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping ticket');
    await respond({ response_type: 'ephemeral', text: TICKET_NOT_CONFIGURED_TEXT });
    return;
  }

  if (!isTicketingEnabled()) {
    await respond({ response_type: 'ephemeral', text: TICKET_NOT_CONFIGURED_TEXT });
    recordInteraction({
      ...slashInteractionRecord(command, `slash_${invokedAs}`),
      status: 'error',
      errorType: 'not_configured',
      rateLimited: false,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_${invokedAs} interaction: ${err.name}`));
    return;
  }

  const { allowed, retryAfterMs } = checkRateLimit(command.user_id);
  if (!allowed) {
    await respond({ response_type: 'ephemeral', text: rateLimitMessage(retryAfterMs) });
    recordInteraction({
      ...slashInteractionRecord(command, `slash_${invokedAs}`),
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_${invokedAs} interaction: ${err.name}`));
    return;
  }

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: buildTicketModal({ ticketType, channelId: command.channel_id }),
    });
    fireAndForgetRecord({ command, logger, interactionType: `slash_${invokedAs}` });
  } catch (err) {
    logger?.error?.(`Failed to open ${invokedAs} modal: ${err.message}`);
    await respond({ response_type: 'ephemeral', text: TICKET_ERROR_TEXT });
  }
}
