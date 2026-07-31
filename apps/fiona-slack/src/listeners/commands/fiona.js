// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { captureConversation } from '../../agent/conversation-capture-store.js';
import { postEscalation } from '../../agent/escalation.js';
import { recordInteraction } from '../../agent/interaction-store.js';
import { waitForMetadataReady } from '../../agent/interaction-telemetry.js';
import {
  CITATION_POLICY,
  callLLM,
  finalizeMetadataEnvelope,
  LLM_MODEL,
  SYSTEM_PROMPT_VERSION,
} from '../../agent/llm-caller.js';
import { checkRateLimit, rateLimitMessage } from '../../agent/rate-limiter.js';
import { feedbackBlock } from '../views/feedback_block.js';
import {
  ESCALATE_CONFIRM_TEXT,
  ESCALATE_DM_TEXT,
  ESCALATE_ERROR_TEXT,
  HELP_TEXT,
  SEARCH_NOT_YET_TEXT,
} from './command-handler.js';

/**
 * Handles the /fiona slash command. Routes to a sub-command handler or falls
 * back to help for unrecognized / missing input.
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
      await handleAsk({ command, ack, respond, client, logger });
      break;
    case 'search':
      await handleComingSoon({ command, ack, logger, subCommand: 'search', text: SEARCH_NOT_YET_TEXT });
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

/**
 * Handles the `/fiona ask <question>` sub-command.
 * Streams an ephemeral LLM response visible only to the invoking user.
 * Falls back to the help response when no question is provided.
 */
async function handleAsk({ command, ack, respond, client, logger }) {
  const rawArgs = (command.text ?? '').trim().slice('ask'.length).trim();

  // Empty question → fall back to help
  if (!rawArgs) {
    await handleHelp({ command, ack, logger });
    return;
  }

  // Acknowledge the slash command immediately (Slack requires ack within 3 seconds)
  try {
    await ack();
  } catch (err) {
    logger?.error?.(`Failed to acknowledge /fiona ask: ${err.name}`);
    return;
  }

  if (!hasRequiredFields(command)) {
    logger?.warn?.('Missing required slash command fields; skipping /fiona ask');
    return;
  }

  // Apply rate limiting
  const { allowed, retryAfterMs } = checkRateLimit(command.user_id);
  if (!allowed) {
    await respond({ response_type: 'ephemeral', text: rateLimitMessage(retryAfterMs) });
    recordInteraction({
      ...slashInteractionRecord(command, 'slash_ask'),
      status: 'error',
      errorType: 'rate_limited',
      rateLimited: true,
      logger,
    }).catch((err) => logger?.warn?.(`Failed to record slash_ask interaction: ${err.name}`));
    return;
  }

  // Stream the LLM response as an ephemeral message visible only to the invoking user
  try {
    const streamer = client.chatStream({
      channel: command.channel_id,
      recipient_team_id: command.team_id,
      recipient_user_id: command.user_id,
    });

    const prompts = [{ role: 'user', content: rawArgs }];
    const { metadata, botText, systemPromptVersion } = await callLLM(streamer, prompts, logger);

    // Wait for citation metadata to be ready before finalizing
    await waitForMetadataReady(metadata, CITATION_POLICY.METADATA_WAIT_TIMEOUT_MS);

    if (metadata) {
      logger?.info?.(`[citations] state=${metadata.finalize_state} sources=${metadata.sources?.length ?? 0}`);
    }

    await streamer.stop({ blocks: [feedbackBlock] });
    finalizeMetadataEnvelope(metadata);

    fireAndForgetRecord({ command, logger, interactionType: 'slash_ask' });

    try {
      await captureConversation({
        userId: command.user_id,
        teamId: command.team_id,
        channelId: command.channel_id,
        threadTs: command.trigger_id,
        messageTs: command.trigger_id,
        entryPoint: 'slash_ask',
        userMessage: rawArgs,
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
  } catch (err) {
    logger?.error?.(`Failed to handle /fiona ask: ${err.name}`, err);
    try {
      await respond({ response_type: 'ephemeral', text: ':warning: Something went wrong! Please try again later.' });
    } catch (respondErr) {
      logger?.warn?.(`Failed to send error response for /fiona ask: ${respondErr.name}`);
    }
    recordInteraction({
      ...slashInteractionRecord(command, 'slash_ask'),
      status: 'error',
      errorType: 'unknown',
      rateLimited: false,
      logger,
    }).catch((recErr) => logger?.warn?.(`Failed to record slash_ask interaction: ${recErr.name}`));
  }
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
