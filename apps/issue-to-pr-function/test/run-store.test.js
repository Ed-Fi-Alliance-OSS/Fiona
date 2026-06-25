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
const mockItemPatch = jest.fn();
const mockItem = jest.fn(() => ({ patch: mockItemPatch }));
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
    mockItemPatch.mockReset();
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

  it('updateRunRecord uses patch with set operations for status, completedAt, and prUrl', async () => {
    mockItemPatch.mockResolvedValueOnce({});

    await updateRunRecord({
      instanceId: 'inst-1',
      repoFullName: 'org/repo',
      status: 'completed',
      prUrl: 'https://github.com/org/repo/pull/7',
    });

    // item() must be called with id + partition key
    expect(mockItem).toHaveBeenCalledWith('inst-1', 'org/repo');

    // patch() must be called exactly once
    expect(mockItemPatch).toHaveBeenCalledTimes(1);
    const ops = mockItemPatch.mock.calls[0][0];

    // Must include set ops for status and completedAt
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: 'set', path: '/status', value: 'completed' },
        { op: 'set', path: '/prUrl', value: 'https://github.com/org/repo/pull/7' },
      ]),
    );
    const completedAtOp = ops.find((o) => o.path === '/completedAt');
    expect(completedAtOp).toBeDefined();
    expect(completedAtOp.op).toBe('set');
    expect(typeof completedAtOp.value).toBe('string');
    expect(Number.isNaN(new Date(completedAtOp.value).getTime())).toBe(false);

    // No error op when none provided
    expect(ops.some((o) => o.path === '/error')).toBe(false);
  });

  it('updateRunRecord includes error set-op and no prUrl op when status is failed', async () => {
    mockItemPatch.mockResolvedValueOnce({});

    await updateRunRecord({
      instanceId: 'inst-1',
      repoFullName: 'org/repo',
      status: 'failed',
      error: 'boom',
    });

    expect(mockItemPatch).toHaveBeenCalledTimes(1);
    const ops = mockItemPatch.mock.calls[0][0];

    expect(ops).toEqual(
      expect.arrayContaining([
        { op: 'set', path: '/status', value: 'failed' },
        { op: 'set', path: '/error', value: 'boom' },
      ]),
    );
    // No prUrl op when none provided
    expect(ops.some((o) => o.path === '/prUrl')).toBe(false);
  });
});
