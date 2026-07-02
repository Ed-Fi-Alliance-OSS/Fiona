// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, afterEach } from '@jest/globals';

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

afterEach(() => {
  MockCosmosClient.mockClear();
  MockDefaultAzureCredential.mockClear();
});

// ---------------------------------------------------------------------------
// isEmulatorTarget
// ---------------------------------------------------------------------------

describe('isEmulatorTarget', () => {
  it('returns true for localhost in connection string', () => {
    expect(isEmulatorTarget('AccountEndpoint=https://localhost:8081/;AccountKey=xyz', undefined)).toBe(true);
  });

  it('returns true for 127.0.0.1 in connection string', () => {
    expect(isEmulatorTarget('AccountEndpoint=https://127.0.0.1:8081/;AccountKey=xyz', undefined)).toBe(true);
  });

  it('returns true for localhost in endpoint', () => {
    expect(isEmulatorTarget(undefined, 'https://localhost:8081')).toBe(true);
  });

  it('returns true for 127.0.0.1 in endpoint', () => {
    expect(isEmulatorTarget(undefined, 'https://127.0.0.1:8081')).toBe(true);
  });

  it('returns false for a cloud endpoint', () => {
    expect(isEmulatorTarget(undefined, 'https://myaccount.documents.azure.com:443')).toBe(false);
  });

  it('returns false when both arguments are undefined', () => {
    expect(isEmulatorTarget(undefined, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCosmosConfig
// ---------------------------------------------------------------------------

describe('getCosmosConfig', () => {
  afterEach(() => {
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    delete process.env.COSMOS_DATABASE;
  });

  it('returns undefined connection fields when env vars are absent', () => {
    const config = getCosmosConfig();
    expect(config.connectionString).toBeUndefined();
    expect(config.endpoint).toBeUndefined();
    expect(config.key).toBeUndefined();
  });

  it('uses chatbot as the default database', () => {
    const config = getCosmosConfig();
    expect(config.database).toBe('chatbot');
  });

  it('reads COSMOS_CONNECTION_STRING from env', () => {
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc';
    const config = getCosmosConfig();
    expect(config.connectionString).toBe(process.env.COSMOS_CONNECTION_STRING);
  });

  it('reads COSMOS_ENDPOINT and COSMOS_KEY from env', () => {
    process.env.COSMOS_ENDPOINT = 'https://test.documents.azure.com:443/';
    process.env.COSMOS_KEY = 'secret-key';
    const config = getCosmosConfig();
    expect(config.endpoint).toBe('https://test.documents.azure.com:443/');
    expect(config.key).toBe('secret-key');
  });

  it('reads COSMOS_DATABASE from env', () => {
    process.env.COSMOS_DATABASE = 'mydb';
    const config = getCosmosConfig();
    expect(config.database).toBe('mydb');
  });

  it('applies overrides over env vars', () => {
    process.env.COSMOS_ENDPOINT = 'https://env-endpoint.documents.azure.com/';
    const config = getCosmosConfig({ endpoint: 'https://localhost:8081', key: 'emulator-key' });
    expect(config.endpoint).toBe('https://localhost:8081');
    expect(config.key).toBe('emulator-key');
  });

  it('override can supply a connection string when env var is absent', () => {
    const config = getCosmosConfig({ connectionString: 'AccountEndpoint=https://localhost:8081/;AccountKey=xyz' });
    expect(config.connectionString).toBe('AccountEndpoint=https://localhost:8081/;AccountKey=xyz');
  });
});

// ---------------------------------------------------------------------------
// createCosmosClient
// ---------------------------------------------------------------------------

describe('createCosmosClient - connection string', () => {
  it('returns a CosmosClient constructed with the connection string', () => {
    const config = { connectionString: 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc', endpoint: undefined, key: undefined, database: 'chatbot' };
    const client = createCosmosClient(config);
    expect(MockCosmosClient).toHaveBeenCalledTimes(1);
    expect(MockCosmosClient).toHaveBeenCalledWith(config.connectionString);
    expect(client).not.toBeNull();
  });
});

describe('createCosmosClient - endpoint + key (non-production)', () => {
  afterEach(() => {
    delete process.env.DEPLOYMENT_TYPE;
  });

  it('returns a CosmosClient with endpoint and key in dev', () => {
    process.env.DEPLOYMENT_TYPE = 'local';
    const config = { connectionString: undefined, endpoint: 'https://test.documents.azure.com:443/', key: 'secret', database: 'chatbot' };
    const client = createCosmosClient(config);
    expect(MockCosmosClient).toHaveBeenCalledWith({ endpoint: config.endpoint, key: config.key });
    expect(client).not.toBeNull();
  });

  it('returns a CosmosClient with endpoint and key when DEPLOYMENT_TYPE is not set', () => {
    delete process.env.DEPLOYMENT_TYPE;
    const config = { connectionString: undefined, endpoint: 'https://test.documents.azure.com:443/', key: 'secret', database: 'chatbot' };
    const client = createCosmosClient(config);
    expect(client).not.toBeNull();
  });
});

describe('createCosmosClient - managed identity (endpoint only)', () => {
  it('returns a CosmosClient with DefaultAzureCredential when only endpoint is set', () => {
    const config = { connectionString: undefined, endpoint: 'https://test.documents.azure.com:443/', key: undefined, database: 'chatbot' };
    const client = createCosmosClient(config);
    expect(MockDefaultAzureCredential).toHaveBeenCalledTimes(1);
    expect(MockCosmosClient).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: config.endpoint, aadCredentials: expect.anything() }),
    );
    expect(client).not.toBeNull();
  });
});

describe('createCosmosClient - no config', () => {
  it('returns null when neither connectionString nor endpoint is set', () => {
    const config = { connectionString: undefined, endpoint: undefined, key: undefined, database: 'chatbot' };
    const client = createCosmosClient(config);
    expect(client).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });

  it('does not log a warning when config is absent', () => {
    const logger = { warn: jest.fn() };
    const config = { connectionString: undefined, endpoint: undefined, key: undefined, database: 'chatbot' };
    createCosmosClient(config, logger);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('createCosmosClient - production auth guard', () => {
  let captureConversation;

  beforeAll(async () => {
    // Load a fresh cosmos-utils module with production env vars set so the
    // warnedInsecureProductionCosmosKey flag starts at false.
    process.env.DEPLOYMENT_TYPE = 'production';
    jest.resetModules();
    jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
    jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: MockDefaultAzureCredential }));
    ({ createCosmosClient } = await import('../../src/agent/cosmos-utils.js'));
    void captureConversation; // suppress unused variable warning
  });

  afterEach(() => {
    delete process.env.DEPLOYMENT_TYPE;
  });

  it('returns null and logs warning when endpoint + key auth is used in production', () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    const logger = { warn: jest.fn() };
    const config = { connectionString: undefined, endpoint: 'https://prod.documents.azure.com:443/', key: 'secret', database: 'chatbot' };
    const client = createCosmosClient(config, logger);
    expect(client).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('COSMOS_KEY auth is not supported in production'),
    );
  });

  it('still allows connection string auth in production', () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    MockCosmosClient.mockClear();
    const config = { connectionString: 'AccountEndpoint=https://prod.documents.azure.com:443/;AccountKey=abc', endpoint: undefined, key: undefined, database: 'chatbot' };
    const client = createCosmosClient(config);
    expect(client).not.toBeNull();
    expect(MockCosmosClient).toHaveBeenCalledTimes(1);
  });

  it('still allows managed identity (endpoint only) in production', () => {
    process.env.DEPLOYMENT_TYPE = 'production';
    MockCosmosClient.mockClear();
    MockDefaultAzureCredential.mockClear();
    const config = { connectionString: undefined, endpoint: 'https://prod.documents.azure.com:443/', key: undefined, database: 'chatbot' };
    const client = createCosmosClient(config);
    expect(client).not.toBeNull();
    expect(MockDefaultAzureCredential).toHaveBeenCalledTimes(1);
  });
});
