// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let warnedMissingConfig = false;

/** @type {import('@azure/cosmos').CosmosClient | null} */
let cosmosClient = null;

/** @type {Promise<import('@azure/cosmos').Container | null> | null} */
let containerPromise = null;

function getCosmosConfig() {
  return {
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    connectionString: process.env.COSMOS_CONNECTION_STRING,
    database: process.env.COSMOS_DATABASE || 'chatbot',
    usersContainer: process.env.COSMOS_USERS_CONTAINER || 'slack-users',
  };
}

function isEmulatorTarget(config) {
  const target = `${config.connectionString ?? ''} ${config.endpoint ?? ''}`.toLowerCase();
  return target.includes('localhost') || target.includes('127.0.0.1');
}

function resetContainerCache() {
  containerPromise = null;
  cosmosClient = null;
}

async function _buildContainer(logger) {
  const config = getCosmosConfig();
  if (!cosmosClient) {
    if (config.connectionString) {
      cosmosClient = new CosmosClient(config.connectionString);
    } else if (config.endpoint && config.key) {
      cosmosClient = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    } else if (config.endpoint) {
      cosmosClient = new CosmosClient({ endpoint: config.endpoint, aadCredentials: new DefaultAzureCredential() });
    } else {
      if (!warnedMissingConfig) {
        warnedMissingConfig = true;
        logger?.warn?.(
          'CosmosDB not configured — slack-users store unavailable. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
        );
      }
      return null;
    }
  }
  return cosmosClient.database(config.database).container(config.usersContainer);
}

/**
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<import('@azure/cosmos').Container | null>}
 */
function getContainer(logger, options = {}) {
  if (options.forceRefresh) {
    resetContainerCache();
  }
  if (!containerPromise) {
    containerPromise = _buildContainer(logger).catch((err) => {
      containerPromise = null;
      throw err;
    });
  }
  return containerPromise;
}

/**
 * @typedef {Object} SlackUser
 * @property {string} id          - Slack user ID (e.g. U12345678)
 * @property {string} userId      - Same as id; kept for readability in queries
 * @property {string} teamId      - Slack workspace/team ID
 * @property {string} name        - Slack username (handle)
 * @property {string} realName    - Full display name
 * @property {string} displayName - Display name from profile
 * @property {string} email       - Email address (may be empty if not accessible)
 * @property {boolean} isBot      - True for bot users
 * @property {boolean} isAdmin    - True for workspace admins
 * @property {boolean} isOwner    - True for workspace owner
 * @property {boolean} deleted    - True for deactivated accounts
 * @property {string} updatedAt   - ISO-8601 timestamp of last upsert
 */

/**
 * Upsert a Slack user record. No-ops silently if Cosmos is not configured.
 *
 * @param {SlackUser} user
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<boolean>} True if upsert succeeded, false if it failed or Cosmos is not configured
 */
const RETRYABLE_CODES = new Set([410, 429, 449, 503]);
const RECONNECT_CODES = new Set([410, 503]);

function toNumericCode(error) {
  const rawCode = error?.code ?? error?.statusCode;
  const code = Number(rawCode);
  return Number.isFinite(code) ? code : null;
}

function getRetryPolicy() {
  const config = getCosmosConfig();
  const isTest = process.env.NODE_ENV === 'test';
  if (isTest) {
    return { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 };
  }

  if (isEmulatorTarget(config)) {
    return { maxAttempts: 8, baseDelayMs: 400, maxDelayMs: 5000 };
  }

  return { maxAttempts: 3, baseDelayMs: 150, maxDelayMs: 1200 };
}

function getDelayMs(policy, attempt) {
  const baseDelay = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelay * 0.2)));
  return baseDelay + jitter;
}

async function executeWithRetry(operation, logger) {
  const policy = getRetryPolicy();
  let forceRefresh = false;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const c = await getContainer(logger, { forceRefresh });
      if (!c) return false;
      await operation(c);
      return true;
    } catch (error) {
      const code = toNumericCode(error);
      if (!RETRYABLE_CODES.has(code) || attempt === policy.maxAttempts) throw error;
      forceRefresh = RECONNECT_CODES.has(code);
      if (forceRefresh) {
        resetContainerCache();
      }
      const delayMs = getDelayMs(policy, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

export async function upsertUser(user, logger) {
  const doc = { ...user, updatedAt: new Date().toISOString() };

  try {
    return await executeWithRetry((c) => c.items.upsert(doc, { partitionKey: doc.id }), logger);
  } catch (error) {
    logger?.warn?.(`Failed to upsert Slack user ${user.id} to Cosmos DB: ${error.message}`);
    return false;
  }
}

/**
 * Warm up Cosmos container connectivity before a bulk load.
 *
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<boolean>}
 */
export async function ensureStoreReady(logger) {
  try {
    return await executeWithRetry(async (c) => {
      try {
        await c.item('__fiona_warmup__', '__fiona_warmup__').read();
      } catch (error) {
        if (toNumericCode(error) !== 404) throw error;
      }
    }, logger);
  } catch (error) {
    logger?.warn?.(`Cosmos DB warmup failed for slack-users store: ${error.message}`);
    return false;
  }
}

/**
 * Retrieve a Slack user by their Slack user ID. Returns null if not found or
 * if Cosmos is not configured.
 *
 * @param {string} userId - Slack user ID (e.g. U12345678)
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<SlackUser | null>}
 */
export async function getUser(userId, logger) {
  const c = await getContainer(logger);
  if (!c) return null;

  try {
    const { resource } = await c.item(userId, userId).read();
    return resource ?? null;
  } catch (error) {
    if (toNumericCode(error) !== 404) {
      logger?.warn?.(`Failed to read Slack user ${userId} from Cosmos DB: ${error.message}`);
    }
    return null;
  }
}
