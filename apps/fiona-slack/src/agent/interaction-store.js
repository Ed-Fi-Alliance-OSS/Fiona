// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'fiona';
const COSMOS_CONTAINER = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'local';

let warnedMissingConfig = false;

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

/**
 * Get or initialize the Cosmos DB container for interactions.
 * @param {{ warn?: (msg: string) => void } | null} [logger]
 * @returns {Promise<import('@azure/cosmos').Container | null>}
 */
export async function getContainer(logger) {
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
        'CosmosDB not configured — interactions will not be persisted. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  container = client.database(COSMOS_DATABASE).container(COSMOS_CONTAINER);
  return container;
}

/**
 * Record a user interaction to Cosmos DB. No-ops silently if Cosmos is not configured.
 *
 * @param {Object} interaction
 * @param {string} interaction.userId - Slack user ID
 * @param {string} [interaction.teamId] - Slack team/workspace ID
 * @param {string} interaction.channelId - Slack channel ID
 * @param {string} interaction.threadTs - Slack thread timestamp (session identifier)
 * @param {string} interaction.messageTs - Timestamp of the user's message
 * @param {string} interaction.interactionType - 'app_mention' or 'assistant_message'
 * @param {string} interaction.status - 'success' or 'error'
 * @param {string|null} [interaction.errorType] - Error category if status is 'error'
 * @param {boolean} interaction.rateLimited - true if request was rate-limited
 * @param {{ warn?: (msg: string) => void }} [interaction.logger] - Optional logger
 */
export async function recordInteraction({
  userId,
  teamId,
  channelId,
  threadTs,
  messageTs,
  interactionType,
  status,
  errorType,
  rateLimited,
  logger,
}) {
  const c = await getContainer(logger);
  if (!c) return;

  // Guard against missing required fields that would cause Cosmos DB to reject the document
  if (!userId || !channelId || !threadTs || !messageTs || !interactionType || !status) {
    logger?.warn?.(
      `Missing required fields for recording interaction: ${JSON.stringify({
        userId,
        channelId,
        threadTs,
        messageTs,
        interactionType,
        status,
      })}`,
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
    interactionType,
    status,
    errorType: status === 'error' ? (errorType ?? null) : null,
    rateLimited,
    deploymentType: DEPLOYMENT_TYPE,
    timestamp: new Date().toISOString(),
  };

  try {
    await c.items.upsert(doc, {
      partitionKey: [doc.deploymentType, doc.userId],
    });
  } catch (error) {
    logger?.warn?.(`Failed to record interaction to Cosmos DB: ${error.message}`);
  }
}
