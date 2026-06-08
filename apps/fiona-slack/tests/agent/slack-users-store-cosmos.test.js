// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';

const mockUpsert = jest.fn().mockResolvedValue({});
const mockRead = jest.fn();
const mockContainerObj = {
  items: { upsert: mockUpsert },
  item: jest.fn(() => ({ read: mockRead })),
};
const mockDatabase = { container: jest.fn().mockReturnValue(mockContainerObj) };
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
}));

jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

// Set BEFORE import so getContainer() sees it on first call.
process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=dGVzdA==;';

let upsertUser, getUser, ensureStoreReady;

beforeAll(async () => {
  ({ upsertUser, getUser, ensureStoreReady } = await import('../../src/agent/slack-users-store.js'));
});

afterAll(() => {
  delete process.env.COSMOS_CONNECTION_STRING;
});

beforeEach(() => {
  MockCosmosClient.mockClear();
  mockUpsert.mockClear();
  mockRead.mockClear();
});

const mockUser = {
  id: 'U12345',
  userId: 'U12345',
  teamId: 'T9999',
  name: 'testuser',
  realName: 'Test User',
  displayName: 'Test',
  email: 'test@example.com',
  isBot: false,
  isAdmin: false,
  isOwner: false,
  deleted: false,
};

describe('upsertUser — with connection string', () => {
  it('returns true on success', async () => {
    expect(await upsertUser(mockUser, null)).toBe(true);
  });

  it('calls upsert with all user fields plus updatedAt', async () => {
    await upsertUser(mockUser, null);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.id).toBe('U12345');
    expect(doc.userId).toBe('U12345');
    expect(doc.teamId).toBe('T9999');
    expect(doc.name).toBe('testuser');
    expect(doc.email).toBe('test@example.com');
    expect(doc.isBot).toBe(false);
    expect(doc.deleted).toBe(false);
    expect(typeof doc.updatedAt).toBe('string');
    expect(new Date(doc.updatedAt).toISOString()).toBe(doc.updatedAt);
  });

  it('uses the user id as partition key', async () => {
    await upsertUser(mockUser, null);
    const [, opts] = mockUpsert.mock.calls[0];
    expect(opts).toEqual({ partitionKey: 'U12345' });
  });

  it('returns false and logs a warning when upsert throws', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('cosmos timeout'));
    const logger = { warn: jest.fn() };
    const result = await upsertUser(mockUser, logger);
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to upsert Slack user U12345'),
    );
  });

  it('does not throw when upsert fails', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('cosmos timeout'));
    await expect(upsertUser(mockUser, null)).resolves.toBe(false);
  });

  it('retries transient upsert failures and succeeds', async () => {
    const retryable = Object.assign(new Error('Too many requests'), { code: 429 });
    mockUpsert.mockRejectedValueOnce(retryable).mockResolvedValueOnce({});
    await expect(upsertUser(mockUser, null)).resolves.toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it('rebuilds Cosmos client on reconnect-worthy failures', async () => {
    jest.resetModules();
    // Re-register ESM mocks after resetModules so the fresh import stays fully mocked.
    jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
    jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
    process.env.COSMOS_CONNECTION_STRING =
      'AccountEndpoint=https://localhost:8081/;AccountKey=dGVzdA==;';
    const mod = await import('../../src/agent/slack-users-store.js');
    MockCosmosClient.mockClear();
    mockUpsert.mockClear();

    const reconnect = Object.assign(new Error('Partition moved'), { code: 410 });
    mockUpsert.mockRejectedValueOnce(reconnect).mockResolvedValueOnce({});

    await expect(mod.upsertUser(mockUser, null)).resolves.toBe(true);
    expect(MockCosmosClient).toHaveBeenCalledTimes(2);
  });
});

describe('getUser — with connection string', () => {
  it('returns the stored resource on success', async () => {
    mockRead.mockResolvedValueOnce({ resource: { id: 'U12345', name: 'testuser' } });
    const result = await getUser('U12345', null);
    expect(result).toEqual({ id: 'U12345', name: 'testuser' });
  });

  it('returns null on 404', async () => {
    const err = Object.assign(new Error('Not Found'), { code: 404 });
    mockRead.mockRejectedValueOnce(err);
    expect(await getUser('U12345', null)).toBeNull();
  });

  it('returns null and warns on non-404 errors', async () => {
    const err = Object.assign(new Error('Service Unavailable'), { code: 503 });
    mockRead.mockRejectedValueOnce(err);
    const logger = { warn: jest.fn() };
    const result = await getUser('U12345', logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read Slack user U12345'),
    );
  });
});

describe('ensureStoreReady', () => {
  it('returns true when warmup read returns 404', async () => {
    const notFound = Object.assign(new Error('Not Found'), { code: 404 });
    mockRead.mockRejectedValueOnce(notFound);
    await expect(ensureStoreReady(null)).resolves.toBe(true);
  });

  it('returns true when warmup read succeeds (resource found)', async () => {
    mockRead.mockResolvedValueOnce({ resource: { id: '__fiona_warmup__' } });
    await expect(ensureStoreReady(null)).resolves.toBe(true);
  });

  it('returns false and logs warning when warmup fails with non-retryable error', async () => {
    const err = Object.assign(new Error('Bad Gateway'), { code: 502 });
    mockRead.mockRejectedValue(err);
    const logger = { warn: jest.fn() };
    const result = await ensureStoreReady(logger);
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cosmos DB warmup failed'));
    mockRead.mockReset();
  });

  it('retries on 429 and returns false after exhausting all attempts', async () => {
    const tooMany = Object.assign(new Error('Too Many Requests'), { code: 429 });
    mockRead.mockRejectedValue(tooMany);
    const logger = { warn: jest.fn() };
    const result = await ensureStoreReady(logger);
    expect(result).toBe(false);
    expect(mockRead).toHaveBeenCalledTimes(3); // maxAttempts in test env
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cosmos DB warmup failed'));
    mockRead.mockReset();
  });
});
