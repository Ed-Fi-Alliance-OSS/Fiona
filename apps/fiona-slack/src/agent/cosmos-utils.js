// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * Detect if the target Cosmos endpoint is a local emulator.
 * @param {string} [connectionString]
 * @param {string} [endpoint]
 * @returns {boolean}
 */
export function isEmulatorTarget(connectionString, endpoint) {
  const target = `${connectionString ?? ''} ${endpoint ?? ''}`.toLowerCase();
  return target.includes('localhost') || target.includes('127.0.0.1');
}

/**
 * @typedef {Object} CosmosConfig
 * @property {string | undefined} connectionString - Full Cosmos DB connection string (highest priority)
 * @property {string | undefined} endpoint - Cosmos DB account endpoint URL
 * @property {string | undefined} key - Cosmos DB account key (not supported in production)
 * @property {string} database - Database name (defaults to 'chatbot')
 */

/**
 * Read and normalize Cosmos DB connection configuration from environment variables.
 *
 * Pass `overrides` to substitute specific values — for example, to supply default
 * emulator credentials when the env vars are absent, or to force a different database.
 *
 * @param {Partial<CosmosConfig>} [overrides]
 * @returns {CosmosConfig}
 */
export function getCosmosConfig(overrides = {}) {
  return {
    connectionString: process.env.COSMOS_CONNECTION_STRING,
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    database: process.env.COSMOS_DATABASE || 'chatbot',
    ...overrides,
  };
}

let warnedInsecureProductionCosmosKey = false;

/**
 * Instantiate a {@link CosmosClient} from the provided configuration using the
 * appropriate authentication strategy.
 *
 * **Authentication precedence:**
 * 1. **Connection string** — used when `config.connectionString` is set.
 * 2. **Endpoint + key** — used when both `config.endpoint` and `config.key` are set.
 *    Blocked in production deployments (`DEPLOYMENT_TYPE=production`): logs a warning
 *    and returns `null`.
 * 3. **Managed identity** — used when only `config.endpoint` is set (no `config.key`),
 *    authenticating via `DefaultAzureCredential`.
 *
 * Returns `null` without a warning when neither `connectionString` nor `endpoint` is
 * present. Callers are responsible for logging a "not configured" warning in that case.
 *
 * @param {CosmosConfig} config
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {import('@azure/cosmos').CosmosClient | null}
 */
export function createCosmosClient(config, logger) {
  const { connectionString, endpoint, key } = config;

  if (connectionString) {
    return new CosmosClient(connectionString);
  }

  if (endpoint && key) {
    const deploymentType = process.env.DEPLOYMENT_TYPE || 'local';
    if (deploymentType === 'production') {
      if (!warnedInsecureProductionCosmosKey) {
        warnedInsecureProductionCosmosKey = true;
        logger?.warn?.(
          'COSMOS_KEY auth is not supported in production. Use COSMOS_CONNECTION_STRING or managed identity (COSMOS_ENDPOINT only).',
        );
      }
      return null;
    }
    return new CosmosClient({ endpoint, key });
  }

  if (endpoint) {
    return new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }

  return null;
}
