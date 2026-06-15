// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

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

  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const database = process.env.COSMOS_DATABASE || 'fiona';
  const cosmosContainer = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';

  let client;
  if (connectionString) {
    client = new CosmosClient({ connectionString });
  } else if (endpoint && key) {
    client = new CosmosClient({ endpoint, key });
  } else if (endpoint) {
    client = new CosmosClient({
      endpoint,
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

  try {
    const { database: db } = await client.databases.createIfNotExists({ id: database });
    const { container: c } = await db.containers.createIfNotExists({
      id: cosmosContainer,
      partitionKey: { paths: ['/deploymentType', '/userId'], kind: 'MultiHash', version: 2 },
    });
    container = c;
    return container;
  } catch (error) {
    logger?.warn?.(`Failed to initialize Cosmos DB interactions container: ${error.message}`);
    return null;
  }
}

/**
 * Record a user interaction to Cosmos DB. No-ops silently if Cosmos is not configured.
 *
 * @param {Object} interaction
 * @param {string} interaction.userId - Slack user ID
 * @param {string} [interaction.teamId] - Slack team/workspace ID
 * @param {string} interaction.channelId - Slack channel ID
 * @param {string} interaction.threadTs - Interaction session identifier (`thread_ts` for message flows, `trigger_id` for slash commands)
 * @param {string} interaction.messageTs - Interaction event identifier (`message_ts` for message flows, `trigger_id` for slash commands)
 * @param {string} interaction.interactionType - 'app_mention', 'assistant_message', 'slash_help', 'slash_ask', 'slash_search', or 'slash_unknown'
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
    deploymentType: process.env.DEPLOYMENT_TYPE || 'local',
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
