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
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {Promise<import('@azure/cosmos').Container | null>}
 */
async function getContainer(logger) {
  if (container) return container;

  const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
  const COSMOS_KEY = process.env.COSMOS_KEY;
  const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
  const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'chatbot';
  const COSMOS_USERS_CONTAINER = process.env.COSMOS_USERS_CONTAINER || 'slack-users';

  let client;
  if (COSMOS_CONNECTION_STRING) {
    client = new CosmosClient(COSMOS_CONNECTION_STRING);
  } else if (COSMOS_ENDPOINT && COSMOS_KEY) {
    client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
  } else if (COSMOS_ENDPOINT) {
    client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential() });
  } else {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger?.warn?.(
        'CosmosDB not configured — slack-users store unavailable. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  container = client.database(COSMOS_DATABASE).container(COSMOS_USERS_CONTAINER);
  return container;
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
export async function upsertUser(user, logger) {
  const c = await getContainer(logger);
  if (!c) return false;

  const doc = { ...user, updatedAt: new Date().toISOString() };

  try {
    await c.items.upsert(doc, { partitionKey: doc.id });
    return true;
  } catch (error) {
    logger?.warn?.(`Failed to upsert Slack user ${user.id} to Cosmos DB: ${error.message}`);
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
    if (error.code !== 404) {
      logger?.warn?.(`Failed to read Slack user ${userId} from Cosmos DB: ${error.message}`);
    }
    return null;
  }
}
