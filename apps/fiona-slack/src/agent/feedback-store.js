// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { createCosmosClient, getCosmosConfig, isEmulatorTarget } from './cosmos-utils.js';

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

function getRetryPolicy() {
  if (process.env.NODE_ENV === 'test') {
    return { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5 };
  }
  const config = getCosmosConfig();
  if (isEmulatorTarget(config.connectionString, config.endpoint)) {
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
 * @param {{ warn?: (msg: string) => void }} [logger]
 */
async function getContainer(logger) {
  if (container) return container;

  const config = getCosmosConfig();
  const cosmosContainer = process.env.COSMOS_CONTAINER || 'feedback';

  if (!config.connectionString && !config.endpoint) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger?.warn?.(
        'CosmosDB not configured — feedback will not be persisted. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  const client = createCosmosClient(config, logger);
  if (!client) return null;

  try {
    const { database: db } = await client.databases.createIfNotExists({ id: config.database });
    const { container: c } = await db.containers.createIfNotExists({
      id: cosmosContainer,
      partitionKey: { paths: ['/deploymentType', '/feedbackId'], kind: 'MultiHash', version: 2 },
    });
    container = c;
    return container;
  } catch (error) {
    logger?.warn?.(`Failed to initialize Cosmos DB feedback container: ${error.message}`);
    return null;
  }
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
 * @param {string} feedback.messageTs - Bot message timestamp or slash-command trigger_id for escalations
 * @param {string} feedback.value - 'good-feedback', 'bad-feedback', or 'escalation'
 * @param {string|null} [feedback.reason] - Optional reason for the feedback
 * @param {string|null} feedback.userMessage - The user's message that prompted the response
 * @param {string|null} feedback.botResponse - The bot's response being rated
 * @param {string} [feedback.interactionType] - Optional interaction type (e.g., 'slash_escalate')
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
  interactionType,
  logger,
}) {
  const c = await getContainer(logger);
  if (!c) return;

  const doc = {
    id: `${userId}_${messageTs}`,
    // feedbackId duplicates id because the partition key path requires /feedbackId;
    // removing it would silently break upsert routing.
    feedbackId: `${userId}_${messageTs}`,
    userId,
    channelId,
    messageTs,
    value,
    reason: reason?.trim() ? reason.trim() : null,
    userMessage,
    botResponse,
    ...(interactionType ? { interactionType } : {}),
    deploymentType: process.env.DEPLOYMENT_TYPE || 'local',
    timestamp: new Date().toISOString(),
  };

  const policy = getRetryPolicy();
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const activeContainer = attempt === 1 ? c : await getContainer(logger);
      if (!activeContainer) return;
      await activeContainer.items.upsert(doc, {
        partitionKey: [doc.deploymentType, doc.feedbackId],
      });
      return;
    } catch (error) {
      const code = toNumericCode(error);
      const retryable = RETRYABLE_CODES.has(code);
      if (!retryable || attempt === policy.maxAttempts) {
        logger?.warn?.(`Failed to record feedback to Cosmos DB: ${formatCosmosError(error)}`);
        return;
      }
      if (RECONNECT_CODES.has(code)) {
        container = null;
      }
      await new Promise((resolve) => setTimeout(resolve, getDelayMs(policy, attempt)));
    }
  }
}
