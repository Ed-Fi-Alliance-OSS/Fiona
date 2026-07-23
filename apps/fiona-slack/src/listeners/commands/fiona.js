// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { postEscalation } from '../../agent/escalation.js';
import { recordInteraction } from '../../agent/interaction-store.js';
import { checkRateLimit, rateLimitMessage } from '../../agent/rate-limiter.js';
import { formatSearchResults, SEARCH_ERROR_TEXT, searchForSources } from '../../agent/search-caller.js';
import {
  ASK_NOT_YET_TEXT,
  ESCALATE_CONFIRM_TEXT,
  ESCALATE_DM_TEXT,
  ESCALATE_ERROR_TEXT,
  HELP_TEXT,
} from './command-handler.js';

/**
 * Handles the /fiona slash command. Routes to a sub-command handler or falls
 * back to help for unrecognized / missing input. Never invokes the LLM.
 */
export const fionaCommandCallback = async ({ command, ack, respond, client, logger }) => {
  logger?.info?.(`/fiona slash command invoked: ${command.text ?? '(empty)'}`);
  const subCommand = (command.text ?? '').trim().split(/\s+/)[0].toLowerCase();

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

function fireAndForgetRecord({ command, logger, interactionType }) {
  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping interaction record');
    return;
  }
  recordInteraction({ ...slashInteractionRecord(command, interactionType), logger }).catch((err) =>
    logger?.warn?.(`Failed to record ${interactionType} interaction: ${err.name}`),
  );
}

async function handleHelp({ command, ack, logger }) {
  try {
    // ack(string) sends an immediate ephemeral response that only the invoking user sees
    await ack(HELP_TEXT);
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
  const sources = await searchForSources(query, { logger });
  const { text, blocks } = formatSearchResults(query, sources);

  try {
    await respond({ response_type: 'ephemeral', text, blocks, unfurl_links: false, unfurl_media: false });
  } catch (err) {
    logger?.error?.(`Failed to respond to /fiona search: ${err.name}`);
    return;
  }

  fireAndForgetRecord({ command, logger, interactionType: 'slash_search' });
}

async function handleUnknown({ command, ack, logger, subCommand }) {
  logger?.warn?.(`Unrecognized /fiona sub-command: "${subCommand}"`);
  try {
    // ack(string) sends an immediate ephemeral response that only the invoking user sees
    await ack(HELP_TEXT);
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
