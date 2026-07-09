// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordInteraction } from '../../agent/interaction-store.js';
import { ASK_NOT_YET_TEXT, HELP_TEXT, SEARCH_NOT_YET_TEXT } from './command-handler.js';

/**
 * Handles the /fiona slash command. Routes to a sub-command handler or falls
 * back to help for unrecognized / missing input. Never invokes the LLM.
 */
export const fionaCommandCallback = async ({ command, ack, logger }) => {
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
      await handleComingSoon({
        command,
        ack,
        logger,
        subCommand: 'search',
        text: SEARCH_NOT_YET_TEXT,
      });
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
