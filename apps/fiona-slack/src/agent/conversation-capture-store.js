// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const CAPTURE_ALL_CONVERSATIONS = process.env.CAPTURE_ALL_CONVERSATIONS === 'true';
const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'fiona';
const COSMOS_CONVERSATIONS_CONTAINER = process.env.COSMOS_CONVERSATIONS_CONTAINER || 'conversations';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'local';

// 360 days in seconds for per-document TTL
const CONVERSATION_TTL_SECONDS = 31_104_000;

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

let warnedMissingConfig = false;

/**
 * @param {{ warn?: (msg: string) => void } | null} [logger]
 * @returns {Promise<import('@azure/cosmos').Container | null>}
 */
async function getContainer(logger) {
  if (container) return container;

  let client;
  if (COSMOS_CONNECTION_STRING) {
    client = new CosmosClient(COSMOS_CONNECTION_STRING);
  } else if (COSMOS_ENDPOINT && COSMOS_KEY) {
    client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
  } else if (COSMOS_ENDPOINT) {
    client = new CosmosClient({
      endpoint: COSMOS_ENDPOINT,
      aadCredentials: new DefaultAzureCredential(),
    });
  } else {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger?.warn?.(
        'CosmosDB not configured — conversations will not be captured. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  container = client.database(COSMOS_DATABASE).container(COSMOS_CONVERSATIONS_CONTAINER);
  return container;
}

/**
 * Capture a full conversation to Cosmos DB for human evaluation.
 * No-ops silently when CAPTURE_ALL_CONVERSATIONS is false or Cosmos is unconfigured.
 *
 * @param {Object} capture
 * @param {string} capture.userId - Slack user ID
 * @param {string} [capture.teamId] - Slack workspace ID
 * @param {string} capture.channelId - Slack channel ID
 * @param {string} capture.threadTs - Thread timestamp (session identifier)
 * @param {string} capture.messageTs - Message timestamp (event identifier)
 * @param {string} capture.entryPoint - 'app_mention' or 'assistant_message'
 * @param {string} capture.userMessage - The user's message text
 * @param {string} capture.botResponse - The full bot response text
 * @param {Array<{role: string, content: string}>} capture.threadHistory - Full thread context sent to LLM
 * @param {string} capture.llmProvider - LLM provider name (e.g. 'perplexity')
 * @param {string} capture.llmModel - LLM model name (e.g. 'sonar')
 * @param {Array} [capture.sources] - Citation sources from metadata
 * @param {{ warn?: (msg: string) => void }} [capture.logger] - Optional logger
 */
export async function captureConversation({
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  entryPoint,
  userMessage,
  botResponse,
  threadHistory,
  llmProvider,
  llmModel,
  sources,
  logger,
}) {
  if (!CAPTURE_ALL_CONVERSATIONS) return;

  try {
    const c = await getContainer(logger);
    if (!c) return;

    if (!userId || !channelId || !threadTs || !messageTs || !entryPoint) {
      logger?.warn?.(
        `Missing required fields for capturing conversation: ${JSON.stringify({ userId, channelId, threadTs, messageTs, entryPoint })}`,
      );
      return;
    }

    const doc = {
      id: `${userId}_${threadTs}_${messageTs}`,
      userId,
      teamId,
      channelId,
      threadTs,
      messageTs,
      entryPoint,
      userMessage,
      botResponse,
      threadHistory,
      llmProvider,
      llmModel,
      sources: sources ?? [],
      deploymentType: DEPLOYMENT_TYPE,
      timestamp: new Date().toISOString(),
      ttl: CONVERSATION_TTL_SECONDS,
    };

    await c.items.upsert(doc, {
      partitionKey: [doc.deploymentType, doc.userId],
    });
  } catch (error) {
    logger?.warn?.(`Failed to capture conversation to Cosmos DB: ${error.message}`);
  }
}
