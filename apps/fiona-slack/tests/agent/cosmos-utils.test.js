// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals';

const MockCosmosClient = jest.fn().mockImplementation(() => ({}));
const MockDefaultAzureCredential = jest.fn().mockImplementation(() => ({}));

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: MockCosmosClient,
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: MockDefaultAzureCredential,
}));

let isEmulatorTarget, getCosmosConfig, createCosmosClient;

beforeAll(async () => {
  ({ isEmulatorTarget, getCosmosConfig, createCosmosClient } = await import('../../src/agent/cosmos-utils.js'));
});

describe('isEmulatorTarget', () => {
  it('returns true when connection string contains localhost', () => {
    expect(isEmulatorTarget('AccountEndpoint=https://localhost:8081/', undefined)).toBe(true);
  });

  it('returns true when endpoint contains localhost', () => {
    expect(isEmulatorTarget(undefined, 'https://localhost:8081/')).toBe(true);
  });

  it('returns true when endpoint contains 127.0.0.1', () => {
    expect(isEmulatorTarget(undefined, 'https://127.0.0.1:8081/')).toBe(true);
  });

  it('returns false for a real production endpoint', () => {
    expect(isEmulatorTarget(undefined, 'https://my-account.documents.azure.com:443/')).toBe(false);
  });

  it('returns false when both arguments are undefined', () => {
    expect(isEmulatorTarget(undefined, undefined)).toBe(false);
  });
});

describe('getCosmosConfig', () => {
  afterEach(() => {
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_DATABASE;
  });

  it('reads endpoint, key, connectionString and database from environment variables', () => {
    process.env.COSMOS_ENDPOINT = 'https://test.documents.azure.com:443/';
    process.env.COSMOS_KEY = 'test-key';
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc==';
    process.env.COSMOS_DATABASE = 'mydb';

    const config = getCosmosConfig();
    expect(config.endpoint).toBe('https://test.documents.azure.com:443/');
    expect(config.key).toBe('test-key');
    expect(config.connectionString).toBe('AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc==');
    expect(config.database).toBe('mydb');
  });

  it('defaults database to "chatbot" when COSMOS_DATABASE is not set', () => {
    const config = getCosmosConfig();
    expect(config.database).toBe('chatbot');
  });

  it('returns undefined for endpoint, key and connectionString when env vars are absent', () => {
    const config = getCosmosConfig();
    expect(config.endpoint).toBeUndefined();
    expect(config.key).toBeUndefined();
    expect(config.connectionString).toBeUndefined();
  });

  it('applies overrides over environment variables', () => {
    process.env.COSMOS_ENDPOINT = 'https://real.documents.azure.com:443/';
    process.env.COSMOS_KEY = 'env-key';

    const config = getCosmosConfig({
      endpoint: 'https://override.documents.azure.com:443/',
      key: 'override-key',
    });

    expect(config.endpoint).toBe('https://override.documents.azure.com:443/');
    expect(config.key).toBe('override-key');
  });

  it('falls back to env var when the corresponding override key is not provided', () => {
    process.env.COSMOS_KEY = 'env-key';
    const config = getCosmosConfig({ endpoint: 'https://test.documents.azure.com:443/' });
    expect(config.key).toBe('env-key');
  });

  it('override can set database, superseding COSMOS_DATABASE', () => {
    process.env.COSMOS_DATABASE = 'default-db';
    const config = getCosmosConfig({ database: 'override-db' });
    expect(config.database).toBe('override-db');
  });
});

describe('createCosmosClient', () => {
  beforeEach(() => {
    MockCosmosClient.mockClear();
    MockDefaultAzureCredential.mockClear();
    delete process.env.DEPLOYMENT_TYPE;
  });

  afterEach(() => {
    delete process.env.DEPLOYMENT_TYPE;
  });

  it('returns null and does not instantiate CosmosClient when no config is provided', () => {
    const client = createCosmosClient({});
    expect(client).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });

  it('does not warn when no config is provided', () => {
    const logger = { warn: jest.fn() };
    createCosmosClient({}, logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('creates a client from a connection string', () => {
    const cs = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc==';
    const client = createCosmosClient({ connectionString: cs });
    expect(client).not.toBeNull();
    expect(MockCosmosClient).toHaveBeenCalledWith(cs);
  });

  it('creates a client from endpoint + key in non-production environments', () => {
    process.env.DEPLOYMENT_TYPE = 'local';
    const client = createCosmosClient({
      endpoint: 'https://test.documents.azure.com:443/',
      key: 'test-key',
    });
    expect(client).not.toBeNull();
    expect(MockCosmosClient).toHaveBeenCalledWith({
      endpoint: 'https://test.documents.azure.com:443/',
      key: 'test-key',
    });
  });

  it('creates a client from endpoint + key when DEPLOYMENT_TYPE is absent (defaults to local)', () => {
    const client = createCosmosClient({
      endpoint: 'https://test.documents.azure.com:443/',
      key: 'test-key',
    });
    expect(client).not.toBeNull();
    expect(MockCosmosClient).toHaveBeenCalledWith({
      endpoint: 'https://test.documents.azure.com:443/',
      key: 'test-key',
    });
  });

  it('creates a client with managed identity when only endpoint is provided', () => {
    const client = createCosmosClient({ endpoint: 'https://test.documents.azure.com:443/' });
    expect(client).not.toBeNull();
    expect(MockDefaultAzureCredential).toHaveBeenCalledTimes(1);
    expect(MockCosmosClient).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://test.documents.azure.com:443/',
        aadCredentials: expect.any(Object),
      }),
    );
  });

  it('returns null and warns when COSMOS_KEY auth is used in production', () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    const logger = { warn: jest.fn() };
    const client = createCosmosClient(
      { endpoint: 'https://prod.documents.azure.com:443/', key: 'secret-key' },
      logger,
    );
    expect(client).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not support COSMOS_KEY auth in production'),
    );
  });

  it('does not instantiate CosmosClient when the production auth guard fires', () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    createCosmosClient({ endpoint: 'https://prod.documents.azure.com:443/', key: 'secret-key' });
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });

  it('prefers connection string over endpoint + key', () => {
    const cs = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc==';
    createCosmosClient({
      connectionString: cs,
      endpoint: 'https://test.documents.azure.com:443/',
      key: 'test-key',
    });
    expect(MockCosmosClient).toHaveBeenCalledTimes(1);
    expect(MockCosmosClient).toHaveBeenCalledWith(cs);
  });

  it('does not warn when production guard fires and no logger is provided', () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    expect(() =>
      createCosmosClient({ endpoint: 'https://prod.documents.azure.com:443/', key: 'secret-key' }),
    ).not.toThrow();
  });
});
