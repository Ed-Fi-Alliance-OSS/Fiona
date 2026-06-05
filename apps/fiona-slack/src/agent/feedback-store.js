// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import https from 'node:https';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let warnedMissingConfig = false;

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

/**
 * @param {{ warn?: (msg: string) => void }} [logger]
 */
async function getContainer(logger) {
  if (container) return container;

  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const database = process.env.COSMOS_DATABASE || 'chatbot';
  const cosmosContainer = process.env.COSMOS_CONTAINER || 'feedback';

  const target = connectionString || endpoint || '';
  const agent =
    target.includes('localhost') || target.includes('127.0.0.1')
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

  let client;
  if (connectionString) {
    client = new CosmosClient({ connectionString, agent });
  } else if (endpoint && key) {
    client = new CosmosClient({ endpoint, key, agent });
  } else if (endpoint) {
    client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential(), agent });
  } else {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger?.warn?.(
        'CosmosDB not configured — feedback will not be persisted. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  const { database: db } = await client.databases.createIfNotExists({ id: database });
  const { container: c } = await db.containers.createIfNotExists({
    id: cosmosContainer,
    partitionKey: { paths: ['/deploymentType', '/feedbackId'], kind: 'MultiHash', version: 2 },
  });
  container = c;
  return container;
}

/**
 * Record user feedback to Cosmos DB. No-ops silently if Cosmos is not configured.
 *
 * Uses userId + messageTs as the document id so that if a user changes their
 * feedback (thumbs up → thumbs down), the record is updated in place.
 *
 * @param {Object} feedback
 * @param {string} feedback.userId - Slack user ID
 * @param {string} feedback.channelId - Slack channel ID
 * @param {string} feedback.messageTs - Timestamp of the bot message being rated
 * @param {string} feedback.value - 'good-feedback' or 'bad-feedback'
 * @param {string|null} [feedback.reason] - Optional reason for the feedback
 * @param {string|null} feedback.userMessage - The user's message that prompted the response
 * @param {string|null} feedback.botResponse - The bot's response being rated
 * @param {{ warn?: (msg: string) => void }} [feedback.logger] - Optional logger for warnings
 */
export async function recordFeedback({
  userId,
  channelId,
  messageTs,
  value,
  reason,
  userMessage,
  botResponse,
  logger,
}) {
  const c = await getContainer(logger);
  if (!c) return;

  const doc = {
    feedbackId: `${userId}_${messageTs}`,
    userId,
    channelId,
    messageTs,
    value,
    reason: reason || null,
    userMessage,
    botResponse,
    deploymentType: process.env.DEPLOYMENT_TYPE || 'local',
    timestamp: new Date().toISOString(),
  };

  try {
    await c.items.upsert(doc, {
      partitionKey: [doc.deploymentType, doc.feedbackId],
    });
  } catch (error) {
    logger?.warn?.(`Failed to record feedback to Cosmos DB: ${error.message}`);
  }
}
