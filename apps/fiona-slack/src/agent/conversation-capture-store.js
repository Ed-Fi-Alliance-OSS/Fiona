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
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'chatbot';
const COSMOS_CONVERSATIONS_CONTAINER = process.env.COSMOS_CONVERSATIONS_CONTAINER || 'conversations';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'local';

// 360 days in seconds for per-document TTL
const CONVERSATION_TTL_SECONDS = 31_104_000;

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

let warnedMissingConfig = false;
const RETRYABLE_CODES = new Set([410, 429, 449, 500, 503]);
const RECONNECT_CODES = new Set([410, 503]);

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
      threadHistory: Array.isArray(threadHistory) ? threadHistory : [],
      llmProvider,
      llmModel,
      sources: sources ?? [],
      deploymentType: DEPLOYMENT_TYPE,
      timestamp: new Date().toISOString(),
      ttl: CONVERSATION_TTL_SECONDS,
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
          logger?.warn?.(`Failed to capture conversation to Cosmos DB: ${formatCosmosError(error)}`);
          return;
        }
        if (RECONNECT_CODES.has(code)) {
          container = null;
        }
        await new Promise((resolve) => setTimeout(resolve, getDelayMs(policy, attempt)));
      }
    }
  } catch (error) {
    logger?.warn?.(`Failed to capture conversation to Cosmos DB: ${formatCosmosError(error)}`);
  }
}
