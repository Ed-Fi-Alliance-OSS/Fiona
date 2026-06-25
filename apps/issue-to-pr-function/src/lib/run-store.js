// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const DATABASE_NAME = 'chatbot';
const CONTAINER_NAME = 'agent-runs';

/**
 * Lazily-initialised Cosmos container handle for the agent-runs container.
 * Partition key is `/repoFullName`.
 * @type {import('@azure/cosmos').Container | undefined}
 */
let containerHandle;

/**
 * Returns the `agent-runs` container, constructing the Cosmos client on first use.
 * Uses AAD auth via DefaultAzureCredential against `process.env.COSMOS_ENDPOINT`.
 *
 * @returns {import('@azure/cosmos').Container}
 */
function getContainer() {
  if (!containerHandle) {
    const client = new CosmosClient({
      endpoint: process.env.COSMOS_ENDPOINT,
      aadCredentials: new DefaultAzureCredential(),
    });
    containerHandle = client.database(DATABASE_NAME).container(CONTAINER_NAME);
  }
  return containerHandle;
}

/**
 * Creates (upserts) the agent-run record for a Durable orchestration instance.
 *
 * @param {{ instanceId: string, repoFullName: string, issueNumber: number }} params
 * @returns {Promise<void>}
 */
export async function createRunRecord({ instanceId, repoFullName, issueNumber }) {
  const container = getContainer();
  await container.items.upsert({
    id: instanceId,
    repoFullName,
    issueNumber,
    status: 'running',
    createdAt: new Date().toISOString(),
  });
}

/**
 * Patches the agent-run record with terminal status and outcome using Cosmos
 * partial-update (patch) operations.  This avoids the read-then-replace race
 * condition that could resurrect a thin document or lose concurrent writes.
 *
 * @param {{ instanceId: string, repoFullName: string, status: string, prUrl?: string, error?: string }} params
 * @returns {Promise<void>}
 */
export async function updateRunRecord({ instanceId, repoFullName, status, prUrl, error }) {
  const container = getContainer();

  const operations = [
    { op: 'set', path: '/status', value: status },
    { op: 'set', path: '/completedAt', value: new Date().toISOString() },
  ];

  if (prUrl !== undefined) {
    operations.push({ op: 'set', path: '/prUrl', value: prUrl });
  }
  if (error !== undefined) {
    operations.push({ op: 'set', path: '/error', value: error });
  }

  await container.item(instanceId, repoFullName).patch(operations);
}
