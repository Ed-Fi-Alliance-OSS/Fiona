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
 * Reads the existing agent-run record and patches it with terminal status and outcome.
 *
 * @param {{ instanceId: string, repoFullName: string, status: string, prUrl?: string, error?: string }} params
 * @returns {Promise<void>}
 */
export async function updateRunRecord({ instanceId, repoFullName, status, prUrl, error }) {
  const container = getContainer();
  const item = container.item(instanceId, repoFullName);
  const { resource } = await item.read();

  const updated = {
    ...(resource ?? { id: instanceId, repoFullName }),
    status,
    completedAt: new Date().toISOString(),
  };

  if (prUrl !== undefined) {
    updated.prUrl = prUrl;
  }
  if (error !== undefined) {
    updated.error = error;
  }

  await item.replace(updated);
}
