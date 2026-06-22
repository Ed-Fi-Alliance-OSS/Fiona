// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'chatbot';
const COSMOS_CONTAINER = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';

let warnedMissingConfig = false;
const RETRYABLE_CODES = new Set([410, 429, 449, 500, 503]);
const RECONNECT_CODES = new Set([410, 503]);

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

/**
 * @param {unknown} error
 * @returns {string}
 */
function formatCosmosError(error) {
  const fallback = error instanceof Error ? error.message : String(error);
  const message = String(fallback || 'Unknown error')
    .replace(/\s+/g, ' ')
    .trim();
  const statusCode = Number(error?.statusCode);
  const code = Number(error?.code);
  const activityId = error?.activityId ?? error?.headers?.['x-ms-activity-id'];

  const details = [
    Number.isFinite(statusCode) ? `statusCode=${statusCode}` : null,
    Number.isFinite(code) ? `code=${code}` : null,
    activityId ? `activityId=${activityId}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return details ? `${message} (${details})` : message;
}

/**
 * @param {unknown} error
 * @returns {number | null}
 */
function toNumericCode(error) {
  const rawCode = error?.code ?? error?.statusCode;
  const code = Number(rawCode);
  if (Number.isFinite(code)) return code;

  const message = String(error?.message ?? '').toLowerCase();
  if (message.includes('410 response')) return 410;
  if (message.includes('service is currently unavailable')) return 503;
  return null;
}

function isEmulatorTarget() {
  const target = `${COSMOS_CONNECTION_STRING ?? ''} ${COSMOS_ENDPOINT ?? ''}`.toLowerCase();
  return target.includes('localhost') || target.includes('127.0.0.1');
}

function getRetryPolicy() {
  if (process.env.NODE_ENV === 'test') {
    return { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 };
  }
  if (isEmulatorTarget()) {
    return { maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 1000 };
  }
  return { maxAttempts: 3, baseDelayMs: 150, maxDelayMs: 800 };
}

function getDelayMs(policy, attempt) {
  const baseDelay = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelay * 0.2)));
  return baseDelay + jitter;
}

/**
 * Get or initialize the Cosmos DB container for interactions.
 * @param {{ warn?: (msg: string) => void } | null} [logger]
 * @returns {Promise<import('@azure/cosmos').Container | null>}
 */
export async function getContainer(logger) {
  if (container) return container;

  const connectionString = COSMOS_CONNECTION_STRING;
  const endpoint = COSMOS_ENDPOINT;
  const key = COSMOS_KEY;
  const database = COSMOS_DATABASE;
  const cosmosContainer = COSMOS_CONTAINER;

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
 * @param {string} interaction.interactionType - 'app_mention', 'assistant_message', 'slash_help', 'slash_ask', 'slash_search', 'slash_escalate', 'auto_escalation', or 'slash_unknown'
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

  const policy = getRetryPolicy();
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const activeContainer = attempt === 1 ? c : await getContainer(logger);
      if (!activeContainer) return;
      await activeContainer.items.upsert(doc, {
        partitionKey: [doc.deploymentType, doc.userId],
      });
      return;
    } catch (error) {
      const code = toNumericCode(error);
      const retryable = RETRYABLE_CODES.has(code);
      if (!retryable || attempt === policy.maxAttempts) {
        logger?.warn?.(`Failed to record interaction to Cosmos DB: ${formatCosmosError(error)}`);
        return;
      }
      if (RECONNECT_CODES.has(code)) {
        container = null;
      }
      await new Promise((resolve) => setTimeout(resolve, getDelayMs(policy, attempt)));
    }
  }
}
