// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockRead = jest.fn();
const mockItem = jest.fn(() => ({ read: mockRead }));
const mockContainerObj = { item: mockItem };
const mockDatabase = { container: jest.fn().mockReturnValue(mockContainerObj) };
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
}));

jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

async function loadFresh() {
  jest.resetModules();
  return import('../../src/agent/feature-flags-store.js');
}

beforeEach(() => {
  mockRead.mockReset();
  mockItem.mockClear();
  MockCosmosClient.mockClear();
  delete process.env.COSMOS_CONNECTION_STRING;
  delete process.env.COSMOS_ENDPOINT;
  delete process.env.COSMOS_KEY;
  delete process.env.DEPLOYMENT_TYPE;
});

describe('no Cosmos config', () => {
  it('getGlobalFlags returns null and does not instantiate a client', async () => {
    const store = await loadFresh();
    expect(await store.getGlobalFlags(null)).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });

  it('getUserFlags returns null and does not instantiate a client', async () => {
    const store = await loadFresh();
    expect(await store.getUserFlags('U123', null)).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });
});

describe('reads with Cosmos configured', () => {
  beforeEach(() => {
    process.env.COSMOS_ENDPOINT = 'https://acct.documents.azure.com:443/';
    process.env.COSMOS_KEY = 'k';
    process.env.NODE_ENV = 'test';
  });

  it('getGlobalFlags reads the DEPLOYMENT_TYPE-scoped global id and returns its flags', async () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    mockRead.mockResolvedValue({ resource: { id: 'production:global', flags: { escalate: false } } });
    const store = await loadFresh();
    const flags = await store.getGlobalFlags(null);
    expect(mockItem).toHaveBeenCalledWith('production:global', 'production:global');
    expect(flags).toEqual({ escalate: false });
  });

  it('getUserFlags reads the scoped per-user id', async () => {
    process.env.DEPLOYMENT_TYPE = 'insiders';
    mockRead.mockResolvedValue({ resource: { id: 'insiders:U123', flags: { newCommand: true } } });
    const store = await loadFresh();
    const flags = await store.getUserFlags('U123', null);
    expect(mockItem).toHaveBeenCalledWith('insiders:U123', 'insiders:U123');
    expect(flags).toEqual({ newCommand: true });
  });

  it('defaults the scope to "local" when DEPLOYMENT_TYPE is unset', async () => {
    mockRead.mockResolvedValue({ resource: { flags: {} } });
    const store = await loadFresh();
    await store.getGlobalFlags(null);
    expect(mockItem).toHaveBeenCalledWith('local:global', 'local:global');
  });

  it('returns null on a 404 (document absent)', async () => {
    mockRead.mockRejectedValue({ code: 404 });
    const store = await loadFresh();
    expect(await store.getGlobalFlags(null)).toBeNull();
  });

  it('returns null and warns when a read fails non-retryably', async () => {
    mockRead.mockRejectedValue({ code: 400, message: 'bad request' });
    const store = await loadFresh();
    const logger = { warn: jest.fn() };
    expect(await store.getUserFlags('U123', logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to read feature-flags doc'));
  });

  it('retries on a retryable error and returns the flags after a successful retry', async () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    mockRead
      .mockRejectedValueOnce({ code: 503, message: 'service unavailable' })
      .mockResolvedValueOnce({ resource: { id: 'production:global', flags: { escalate: true } } });
    const store = await loadFresh();
    const flags = await store.getGlobalFlags(null);
    expect(flags).toEqual({ escalate: true });
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it('getDeliveryFlag reads the scoped delivery id and returns the whole doc', async () => {
    process.env.DEPLOYMENT_TYPE = 'insiders';
    mockRead.mockResolvedValue({
      resource: { id: 'insiders:delivery:AI-12345', kind: 'delivery', enabled: false, targetUsers: ['U1'] },
    });
    const store = await loadFresh();
    const doc = await store.getDeliveryFlag('AI-12345', null);
    expect(mockItem).toHaveBeenCalledWith('insiders:delivery:AI-12345', 'insiders:delivery:AI-12345');
    expect(doc).toMatchObject({ kind: 'delivery', enabled: false, targetUsers: ['U1'] });
  });

  it('getDeliveryFlag returns null on 404', async () => {
    mockRead.mockRejectedValue({ code: 404 });
    const store = await loadFresh();
    expect(await store.getDeliveryFlag('AI-99999', null)).toBeNull();
  });
});
