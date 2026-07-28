// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { isEmulatorTarget } from './cosmos-utils.js';

let warnedMissingConfig = false;
/** @type {import('@azure/cosmos').CosmosClient | null} */
let cosmosClient = null;
/** @type {Promise<import('@azure/cosmos').Container | null> | null} */
let containerPromise = null;

function getConfig() {
  return {
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    connectionString: process.env.COSMOS_CONNECTION_STRING,
    database: process.env.COSMOS_DATABASE || 'chatbot',
    container: process.env.COSMOS_FEATURE_FLAGS_CONTAINER || 'feature-flags',
  };
}

function scopePrefix() {
  return process.env.DEPLOYMENT_TYPE || 'local';
}

function resetContainerCache() {
  containerPromise = null;
  cosmosClient = null;
}

async function _buildContainer(logger) {
  const config = getConfig();
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
          'CosmosDB not configured — feature-flags store unavailable. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
        );
      }
      return null;
    }
  }
  return cosmosClient.database(config.database).container(config.container);
}

function getContainer(logger, options = {}) {
  if (options.forceRefresh) resetContainerCache();
  if (!containerPromise) {
    containerPromise = _buildContainer(logger).catch((err) => {
      containerPromise = null;
      throw err;
    });
  }
  return containerPromise;
}

const RETRYABLE_CODES = new Set([410, 429, 449, 503]);
const RECONNECT_CODES = new Set([410, 503]);

function toNumericCode(error) {
  const raw = error?.code ?? error?.statusCode;
  const code = Number(raw);
  return Number.isFinite(code) ? code : null;
}

function getRetryPolicy() {
  const config = getConfig();
  if (process.env.NODE_ENV === 'test') return { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 };
  if (isEmulatorTarget(config.connectionString, config.endpoint)) {
    return { maxAttempts: 8, baseDelayMs: 400, maxDelayMs: 5000 };
  }
  return { maxAttempts: 3, baseDelayMs: 150, maxDelayMs: 1200 };
}

function getDelayMs(policy, attempt) {
  const base = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(base * 0.2)));
  return base + jitter;
}

/**
 * Read a document by id with retry. Returns the raw Cosmos resource,
 * or null when Cosmos is unconfigured, the document is absent, or reads fail.
 * @param {string} id
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<Record<string, any> | null>}
 */
async function readItem(id, logger) {
  const policy = getRetryPolicy();
  let forceRefresh = false;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const c = await getContainer(logger, { forceRefresh });
      if (!c) return null;
      const { resource } = await c.item(id, id).read();
      return resource ?? null;
    } catch (error) {
      const code = toNumericCode(error);
      if (code === 404) return null;
      if (!RETRYABLE_CODES.has(code) || attempt === policy.maxAttempts) {
        logger?.warn?.(`Failed to read feature-flags doc ${id}: ${error.message}`);
        return null;
      }
      forceRefresh = RECONNECT_CODES.has(code);
      if (forceRefresh) resetContainerCache();
      await new Promise((resolve) => setTimeout(resolve, getDelayMs(policy, attempt)));
    }
  }
  return null;
}

/**
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<Record<string, boolean> | null>}
 */
export async function getGlobalFlags(logger) {
  return (await readItem(`${scopePrefix()}:global`, logger))?.flags ?? null;
}

/**
 * @param {string} userId
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<Record<string, boolean> | null>}
 */
export async function getUserFlags(userId, logger) {
  return (await readItem(`${scopePrefix()}:${userId}`, logger))?.flags ?? null;
}

/**
 * Read a delivery flag document (id `<scope>:delivery:<ticket>`).
 * Returns the whole document, or null when unconfigured / absent / unreachable.
 * @param {string} ticket
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<{ enabled?: boolean, targetUsers?: string[], [k: string]: any } | null>}
 */
export function getDeliveryFlag(ticket, logger) {
  return readItem(`${scopePrefix()}:delivery:${ticket}`, logger);
}
