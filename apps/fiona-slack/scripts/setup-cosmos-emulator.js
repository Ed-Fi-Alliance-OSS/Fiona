// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Creates the Cosmos DB database and containers in the local emulator,
 * matching the schema defined in infra/fiona-slack-container/main.bicep.
 *
 * Usage:
 *   node scripts/setup-cosmos-emulator.js
 *
 * The emulator must be running before you run this script.
 * Download: https://aka.ms/cosmosdb-emulator
 */

import { readFileSync } from 'node:fs';
import https from 'node:https';
import { CosmosClient } from '@azure/cosmos';

// Load .env if present so COSMOS_CONNECTION_STRING etc. are available
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  // .env not present — that's fine
}

const DATABASE_NAME = process.env.COSMOS_DATABASE || 'chatbot';
const FEEDBACK_CONTAINER = process.env.COSMOS_CONTAINER || 'feedback';
const INTERACTIONS_CONTAINER = 'interactions';

// Build CosmosClient from connection string if available, otherwise fall back
// to the well-known emulator endpoint + key.
const tlsAgent = new https.Agent({ rejectUnauthorized: false });
let client;

if (process.env.COSMOS_CONNECTION_STRING) {
  client = new CosmosClient({
    connectionString: process.env.COSMOS_CONNECTION_STRING,
    agent: tlsAgent,
  });
  console.log('Using COSMOS_CONNECTION_STRING from environment.');
} else {
  const endpoint = process.env.COSMOS_ENDPOINT || 'https://localhost:8081';
  // Well-known fixed key used by every default Cosmos DB Emulator install.
  // If your emulator was reset or reconfigured, copy the key from the emulator's
  // system tray icon → "Copy Connection String", then set COSMOS_CONNECTION_STRING
  // in your .env.
  const key =
    process.env.COSMOS_KEY || 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b5n5MBLzPU1z+OhS8OyX8+tU9J1A==';
  client = new CosmosClient({ endpoint, key, agent: tlsAgent });
  console.log(`Using endpoint ${endpoint} (set COSMOS_CONNECTION_STRING in .env to override).`);
}

async function main() {
  console.log('Connecting...');

  const { database } = await client.databases.createIfNotExists({ id: DATABASE_NAME });
  console.log(`Database '${DATABASE_NAME}' ready.`);

  // --- feedback container ---
  await database.containers.createIfNotExists({
    id: FEEDBACK_CONTAINER,
    partitionKey: {
      paths: ['/deploymentType', '/feedbackId'],
      kind: 'MultiHash',
      version: 2,
    },
    indexingPolicy: {
      indexingMode: 'consistent',
      includedPaths: [{ path: '/*' }],
      excludedPaths: [{ path: '/"_etag"/?' }],
      compositeIndexes: [
        [
          { path: '/timestamp', order: 'descending' },
          { path: '/value', order: 'ascending' },
        ],
      ],
    },
  });
  console.log(`Container '${FEEDBACK_CONTAINER}' ready.`);

  // --- interactions container ---
  await database.containers.createIfNotExists({
    id: INTERACTIONS_CONTAINER,
    partitionKey: {
      paths: ['/deploymentType', '/userId'],
      kind: 'MultiHash',
      version: 2,
    },
    indexingPolicy: {
      indexingMode: 'consistent',
      includedPaths: [{ path: '/*' }],
      excludedPaths: [{ path: '/"_etag"/?' }],
      compositeIndexes: [
        [
          { path: '/userId', order: 'ascending' },
          { path: '/timestamp', order: 'descending' },
        ],
        [
          { path: '/threadTs', order: 'ascending' },
          { path: '/messageTs', order: 'ascending' },
        ],
        [
          { path: '/status', order: 'ascending' },
          { path: '/timestamp', order: 'descending' },
        ],
        [
          { path: '/timestamp', order: 'descending' },
          { path: '/status', order: 'ascending' },
          { path: '/rateLimited', order: 'ascending' },
        ],
        [
          { path: '/timestamp', order: 'descending' },
          { path: '/rateLimited', order: 'ascending' },
        ],
      ],
    },
  });
  console.log(`Container '${INTERACTIONS_CONTAINER}' ready.`);

  // --- slack-users container ---
  const USERS_CONTAINER = process.env.COSMOS_USERS_CONTAINER || 'slack-users';
  await database.containers.createIfNotExists({
    id: USERS_CONTAINER,
    partitionKey: {
      paths: ['/id'],
      kind: 'Hash',
      version: 2,
    },
    indexingPolicy: {
      indexingMode: 'consistent',
      includedPaths: [{ path: '/*' }],
      excludedPaths: [{ path: '/"_etag"/?' }],
      compositeIndexes: [
        [
          { path: '/teamId', order: 'ascending' },
          { path: '/updatedAt', order: 'descending' },
        ],
      ],
    },
  });
  console.log(`Container '${USERS_CONTAINER}' ready.`);

  if (!process.env.COSMOS_CONNECTION_STRING) {
    console.log('\nDone. Add this to your .env to connect the app:');
    console.log('COSMOS_CONNECTION_STRING=<copy from emulator system tray → "Copy Connection String">');
    console.log(`COSMOS_DATABASE=${DATABASE_NAME}`);
    console.log(`COSMOS_CONTAINER=${FEEDBACK_CONTAINER}`);
  } else {
    console.log('\nDone. Your .env already has COSMOS_CONNECTION_STRING set.');
  }
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
