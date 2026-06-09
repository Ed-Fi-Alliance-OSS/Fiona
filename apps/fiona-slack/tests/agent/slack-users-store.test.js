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

let upsertUser, getUser;

beforeAll(async () => {
  delete process.env.COSMOS_CONNECTION_STRING;
  delete process.env.COSMOS_ENDPOINT;
  delete process.env.COSMOS_KEY;
  ({ upsertUser, getUser } = await import('../../src/agent/slack-users-store.js'));
});

afterAll(() => {
  delete process.env.COSMOS_CONNECTION_STRING;
  delete process.env.COSMOS_ENDPOINT;
});

beforeEach(() => {
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

describe('upsertUser — no Cosmos config', () => {
  it('warns once that CosmosDB is not configured', async () => {
    // Reload module to reset warnedMissingConfig flag
    jest.resetModules();
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    const mod = await import('../../src/agent/slack-users-store.js');
    const logger = { warn: jest.fn() };
    await mod.upsertUser(mockUser, logger);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CosmosDB not configured'));
  });

  it('returns false', async () => {
    expect(await upsertUser(mockUser, null)).toBe(false);
  });

  it('does not instantiate CosmosClient', async () => {
    await upsertUser(mockUser, null);
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });

  it('does not call items.upsert', async () => {
    await upsertUser(mockUser, null);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('getUser — no Cosmos config', () => {
  it('returns null', async () => {
    expect(await getUser('U12345', null)).toBeNull();
  });

  it('does not instantiate CosmosClient', async () => {
    await getUser('U12345', null);
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });
});
