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
 * @property {string | undefined} endpoint      - Value of COSMOS_ENDPOINT env var.
 * @property {string | undefined} key           - Value of COSMOS_KEY env var.
 * @property {string | undefined} connectionString - Value of COSMOS_CONNECTION_STRING env var.
 * @property {string} database                  - Value of COSMOS_DATABASE, defaults to 'chatbot'.
 * @property {string} deploymentType            - Value of DEPLOYMENT_TYPE, defaults to 'local'.
 */

/**
 * Extract and normalize Cosmos DB configuration from environment variables.
 *
 * All values are read from `process.env` at call time so that tests can
 * configure the environment before calling this function. Any field can be
 * overridden by passing a plain object as `overrides`.
 *
 * @param {Partial<CosmosConfig>} [overrides] - Optional field-level overrides applied on top of
 *   the environment-variable defaults. Useful for providing emulator fallback values in scripts.
 * @returns {CosmosConfig}
 */
export function getCosmosConfig(overrides = {}) {
  return {
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY,
    connectionString: process.env.COSMOS_CONNECTION_STRING,
    database: process.env.COSMOS_DATABASE || 'chatbot',
    deploymentType: process.env.DEPLOYMENT_TYPE || 'local',
    ...overrides,
  };
}

/** @type {boolean} */
let _warnedProductionKeyAuth = false;

/**
 * Create a CosmosClient from the given configuration using the canonical
 * 3-branch authentication logic:
 *
 * 1. **Connection string** — used when `config.connectionString` is set.
 * 2. **Endpoint + key** — used when both `config.endpoint` and `config.key`
 *    are set, *and* `config.deploymentType` is not `'production'`. A
 *    production auth guard rejects key-based auth and warns via `logger`.
 * 3. **Managed identity** — used when only `config.endpoint` is set;
 *    authenticates via `DefaultAzureCredential` (workload / managed identity).
 *
 * Returns `null` when no auth credentials are configured or when the
 * production auth guard blocks key-based auth. The caller is responsible for
 * logging store-specific "not configured" warnings when `null` is returned
 * because no credentials are available.
 *
 * @param {CosmosConfig} config - Cosmos DB configuration, typically the return value of
 *   {@link getCosmosConfig}.
 * @param {{ warn?: (msg: string) => void }} [logger] - Optional logger used to emit the
 *   production auth guard warning. The warning is emitted at most once per module lifetime.
 * @returns {import('@azure/cosmos').CosmosClient | null}
 */
export function createCosmosClient(config, logger) {
  const { connectionString, endpoint, key, deploymentType } = config;

  if (connectionString) {
    return new CosmosClient(connectionString);
  }

  if (endpoint && key) {
    if (deploymentType === 'production') {
      if (!_warnedProductionKeyAuth) {
        _warnedProductionKeyAuth = true;
        logger?.warn?.(
          'CosmosDB key-based auth is not supported in production. Use COSMOS_CONNECTION_STRING or managed identity (COSMOS_ENDPOINT only).',
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
