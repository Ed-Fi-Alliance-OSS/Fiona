// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordInteraction } from '../../agent/interaction-store.js';

const HELP_TEXT = `*Fiona — your Ed-Fi AI assistant* :wave:
Fiona helps you navigate Ed-Fi documentation, standards, and community resources using natural language.

*Available commands:*
\`\`\`
/fiona help              Show this help message
/fiona ask <question>    Ask Fiona a question about Ed-Fi (coming soon)
/fiona search <query>    Search Ed-Fi documentation (coming soon)
\`\`\`
_Tip: You can also @-mention Fiona in any channel, or send her a direct message._`;

/**
 * Handles the /fiona slash command. Routes to a sub-command handler or falls
 * back to help for unrecognized / missing input. Never invokes the LLM.
 */
export const fionaCommandCallback = async ({ command, ack, logger }) => {
  const subCommand = (command.text ?? '').trim().split(/\s+/)[0].toLowerCase();

  switch (subCommand) {
    default:
      // Future slices add: case 'help': ...; case 'ask': ...; case 'search': ...;
      await handleHelp({ command, ack, logger });
      break;
  }
};

async function handleHelp({ command, ack, logger }) {
  const { user_id, team_id, channel_id, trigger_id } = command;

  // ack(string) sends an immediate ephemeral response to the invoking user.
  await ack(HELP_TEXT);

  // Fire-and-forget — do not block ack on the Cosmos write.
  // Slash commands have no thread_ts or message_ts; trigger_id is unique per
  // invocation and serves as both identifiers for the Cosmos document ID.
  recordInteraction({
    userId: user_id,
    teamId: team_id,
    channelId: channel_id,
    threadTs: trigger_id,
    messageTs: trigger_id,
    interactionType: 'slash_help',
    status: 'success',
    errorType: null,
    rateLimited: false,
    logger,
  }).catch((err) => logger?.warn?.(`Failed to record slash_help interaction: ${err.message}`));
}
