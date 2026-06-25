// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock @azure/identity so no real credential is constructed
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({ kind: 'fake-credential' })),
}));

// Mock the Cosmos client. We capture the container handle so we can assert on it.
const mockItemsUpsert = jest.fn();
const mockItemRead = jest.fn();
const mockItemReplace = jest.fn();
const mockItem = jest.fn(() => ({ read: mockItemRead, replace: mockItemReplace }));
const mockContainer = jest.fn(() => ({
  items: { upsert: mockItemsUpsert },
  item: mockItem,
}));
const mockDatabase = jest.fn(() => ({ container: mockContainer }));

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: jest.fn().mockImplementation(() => ({ database: mockDatabase })),
}));

const { CosmosClient } = await import('@azure/cosmos');
const { DefaultAzureCredential } = await import('@azure/identity');
const { createRunRecord, updateRunRecord } = await import('../src/lib/run-store.js');

describe('run-store', () => {
  beforeEach(() => {
    process.env.COSMOS_ENDPOINT = 'https://example.documents.azure.com:443/';
    mockItemsUpsert.mockReset();
    mockItemRead.mockReset();
    mockItemReplace.mockReset();
    mockItem.mockClear();
    mockContainer.mockClear();
    mockDatabase.mockClear();
    CosmosClient.mockClear();
    DefaultAzureCredential.mockClear();
  });

  it('createRunRecord upserts a running record with the right shape into chatbot/agent-runs', async () => {
    mockItemsUpsert.mockResolvedValueOnce({});

    await createRunRecord({
      instanceId: 'inst-1',
      repoFullName: 'org/repo',
      issueNumber: 42,
    });

    expect(mockDatabase).toHaveBeenCalledWith('chatbot');
    expect(mockContainer).toHaveBeenCalledWith('agent-runs');

    expect(mockItemsUpsert).toHaveBeenCalledTimes(1);
    const doc = mockItemsUpsert.mock.calls[0][0];
    expect(doc.id).toBe('inst-1');
    expect(doc.repoFullName).toBe('org/repo');
    expect(doc.issueNumber).toBe(42);
    expect(doc.status).toBe('running');
    expect(typeof doc.createdAt).toBe('string');
    expect(Number.isNaN(new Date(doc.createdAt).getTime())).toBe(false);
  });

  it('updateRunRecord reads then replaces with status, completedAt, and prUrl', async () => {
    mockItemRead.mockResolvedValueOnce({
      resource: {
        id: 'inst-1',
        repoFullName: 'org/repo',
        issueNumber: 42,
        status: 'running',
        createdAt: '2026-06-24T00:00:00.000Z',
      },
    });
    mockItemReplace.mockResolvedValueOnce({});

    await updateRunRecord({
      instanceId: 'inst-1',
      repoFullName: 'org/repo',
      status: 'completed',
      prUrl: 'https://github.com/org/repo/pull/7',
    });

    // read uses id + partition key
    expect(mockItem).toHaveBeenCalledWith('inst-1', 'org/repo');

    const replaced = mockItemReplace.mock.calls[0][0];
    expect(replaced.status).toBe('completed');
    expect(replaced.prUrl).toBe('https://github.com/org/repo/pull/7');
    expect(typeof replaced.completedAt).toBe('string');
    // original fields preserved
    expect(replaced.id).toBe('inst-1');
    expect(replaced.createdAt).toBe('2026-06-24T00:00:00.000Z');
    expect(replaced.error).toBeUndefined();
  });

  it('updateRunRecord records an error when status is failed', async () => {
    mockItemRead.mockResolvedValueOnce({
      resource: { id: 'inst-1', repoFullName: 'org/repo', issueNumber: 42, status: 'running' },
    });
    mockItemReplace.mockResolvedValueOnce({});

    await updateRunRecord({
      instanceId: 'inst-1',
      repoFullName: 'org/repo',
      status: 'failed',
      error: 'boom',
    });

    const replaced = mockItemReplace.mock.calls[0][0];
    expect(replaced.status).toBe('failed');
    expect(replaced.error).toBe('boom');
    expect(replaced.prUrl).toBeUndefined();
  });
});
