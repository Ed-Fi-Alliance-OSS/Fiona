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
 * Extract and normalize Cosmos DB authentication configuration from environment variables,
 * with optional property-level overrides.
 *
 * @param {Object} [overrides] - Optional per-property overrides (take precedence over env vars).
 * @param {string} [overrides.endpoint]         - Overrides COSMOS_ENDPOINT
 * @param {string} [overrides.key]              - Overrides COSMOS_KEY
 * @param {string} [overrides.connectionString] - Overrides COSMOS_CONNECTION_STRING
 * @param {string} [overrides.database]         - Overrides COSMOS_DATABASE (default: 'chatbot')
 * @returns {{ endpoint: string|undefined, key: string|undefined, connectionString: string|undefined, database: string }}
 */
export function getCosmosConfig(overrides = {}) {
  return {
    endpoint: overrides.endpoint ?? process.env.COSMOS_ENDPOINT,
    key: overrides.key ?? process.env.COSMOS_KEY,
    connectionString: overrides.connectionString ?? process.env.COSMOS_CONNECTION_STRING,
    database: overrides.database ?? (process.env.COSMOS_DATABASE || 'chatbot'),
  };
}

/**
 * Create a {@link CosmosClient} using 3-branch authentication logic:
 *
 * 1. **Connection string** — highest priority; used as-is.
 * 2. **Endpoint + key** — blocked in production (`DEPLOYMENT_TYPE=production`) to enforce
 *    managed-identity usage; allowed in all other environments.
 * 3. **Endpoint only** — uses {@link DefaultAzureCredential} (managed identity / workload identity).
 *
 * Returns `null` (without throwing) when:
 * - No auth configuration is present (`connectionString`, `endpoint`, and `key` are all falsy).
 * - The production auth guard blocks key-based authentication.
 *
 * When the production guard fires, a warning is emitted via `logger.warn` before returning `null`.
 *
 * @param {{ endpoint?: string, key?: string, connectionString?: string }} config
 * @param {{ warn?: (msg: string) => void } | null} [logger]
 * @returns {import('@azure/cosmos').CosmosClient | null}
 */
export function createCosmosClient(config, logger) {
  const { connectionString, endpoint, key } = config;

  if (connectionString) {
    return new CosmosClient(connectionString);
  }

  if (endpoint && key) {
    if ((process.env.DEPLOYMENT_TYPE || 'local') === 'production') {
      logger?.warn?.(
        'CosmosDB does not support COSMOS_KEY auth in production. Use COSMOS_CONNECTION_STRING or managed identity (COSMOS_ENDPOINT only).',
      );
      return null;
    }
    return new CosmosClient({ endpoint, key });
  }

  if (endpoint) {
    return new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }

  return null;
}
