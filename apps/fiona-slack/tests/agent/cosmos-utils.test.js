// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const MockCosmosClient = jest.fn().mockImplementation(() => ({}));
const MockDefaultAzureCredential = jest.fn().mockImplementation(() => ({}));

jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: MockDefaultAzureCredential,
}));

let isEmulatorTarget, getCosmosConfig, createCosmosClient;

// Import after mocks are registered
const mod = await import('../../src/agent/cosmos-utils.js');
isEmulatorTarget = mod.isEmulatorTarget;
getCosmosConfig = mod.getCosmosConfig;
createCosmosClient = mod.createCosmosClient;

// ── isEmulatorTarget ──────────────────────────────────────────────────────────

describe('isEmulatorTarget', () => {
  it('returns true when connectionString contains localhost', () => {
    expect(
      isEmulatorTarget('AccountEndpoint=https://localhost:8081/;AccountKey=abc;', undefined),
    ).toBe(true);
  });

  it('returns true when endpoint is 127.0.0.1', () => {
    expect(isEmulatorTarget(undefined, 'https://127.0.0.1:8081')).toBe(true);
  });

  it('returns false for a real Azure endpoint', () => {
    expect(isEmulatorTarget(undefined, 'https://prod.documents.azure.com:443/')).toBe(false);
  });

  it('returns false when both args are undefined', () => {
    expect(isEmulatorTarget(undefined, undefined)).toBe(false);
  });
});

// ── getCosmosConfig ───────────────────────────────────────────────────────────

describe('getCosmosConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.COSMOS_ENDPOINT = 'https://my.documents.azure.com:443/';
    process.env.COSMOS_KEY = 'test-key';
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc;';
    process.env.COSMOS_DATABASE = 'my-db';
    process.env.DEPLOYMENT_TYPE = 'staging';
  });

  afterEach(() => {
    for (const key of ['COSMOS_ENDPOINT', 'COSMOS_KEY', 'COSMOS_CONNECTION_STRING', 'COSMOS_DATABASE', 'DEPLOYMENT_TYPE']) {
      if (ORIGINAL_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = ORIGINAL_ENV[key];
      }
    }
  });

  it('reads all expected env vars', () => {
    const config = getCosmosConfig();
    expect(config.endpoint).toBe('https://my.documents.azure.com:443/');
    expect(config.key).toBe('test-key');
    expect(config.connectionString).toBe(
      'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc;',
    );
    expect(config.database).toBe('my-db');
    expect(config.deploymentType).toBe('staging');
  });

  it('defaults database to "chatbot" when COSMOS_DATABASE is not set', () => {
    delete process.env.COSMOS_DATABASE;
    expect(getCosmosConfig().database).toBe('chatbot');
  });

  it('defaults deploymentType to "local" when DEPLOYMENT_TYPE is not set', () => {
    delete process.env.DEPLOYMENT_TYPE;
    expect(getCosmosConfig().deploymentType).toBe('local');
  });

  it('applies overrides on top of env vars', () => {
    const config = getCosmosConfig({ endpoint: 'https://override.documents.azure.com/' });
    expect(config.endpoint).toBe('https://override.documents.azure.com/');
    expect(config.key).toBe('test-key'); // unchanged
  });

  it('returns undefined for endpoint when COSMOS_ENDPOINT is not set', () => {
    delete process.env.COSMOS_ENDPOINT;
    expect(getCosmosConfig().endpoint).toBeUndefined();
  });
});

// ── createCosmosClient ────────────────────────────────────────────────────────

describe('createCosmosClient - connection string', () => {
  beforeEach(() => {
    MockCosmosClient.mockClear();
    jest.resetModules();
    jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
    jest.unstable_mockModule('@azure/identity', () => ({
      DefaultAzureCredential: MockDefaultAzureCredential,
    }));
  });

  it('returns a CosmosClient when connectionString is provided', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=abc;',
      endpoint: undefined,
      key: undefined,
      database: 'chatbot',
      deploymentType: 'local',
    };
    const client = freshCreate(config);
    expect(client).not.toBeNull();
    expect(MockCosmosClient).toHaveBeenCalledTimes(1);
    expect(MockCosmosClient).toHaveBeenCalledWith(config.connectionString);
  });

  it('returns a CosmosClient with endpoint+key in non-production', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: undefined,
      endpoint: 'https://test.documents.azure.com:443/',
      key: 'test-key',
      database: 'chatbot',
      deploymentType: 'local',
    };
    const client = freshCreate(config);
    expect(client).not.toBeNull();
    expect(MockCosmosClient).toHaveBeenCalledWith({ endpoint: config.endpoint, key: config.key });
  });

  it('returns a CosmosClient with AAD when only endpoint is set', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: undefined,
      endpoint: 'https://test.documents.azure.com:443/',
      key: undefined,
      database: 'chatbot',
      deploymentType: 'local',
    };
    const client = freshCreate(config);
    expect(client).not.toBeNull();
    expect(MockDefaultAzureCredential).toHaveBeenCalledTimes(1);
    expect(MockCosmosClient).toHaveBeenCalledWith({
      endpoint: config.endpoint,
      aadCredentials: expect.any(Object),
    });
  });

  it('returns null when no auth credentials are configured', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: undefined,
      endpoint: undefined,
      key: undefined,
      database: 'chatbot',
      deploymentType: 'local',
    };
    const client = freshCreate(config);
    expect(client).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });
});

describe('createCosmosClient - production auth guard', () => {
  beforeEach(() => {
    MockCosmosClient.mockClear();
    MockDefaultAzureCredential.mockClear();
    jest.resetModules();
    jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
    jest.unstable_mockModule('@azure/identity', () => ({
      DefaultAzureCredential: MockDefaultAzureCredential,
    }));
  });

  it('returns null and warns when endpoint+key auth is used in production', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: undefined,
      endpoint: 'https://prod.documents.azure.com:443/',
      key: 'secret-key',
      database: 'chatbot',
      deploymentType: 'production',
    };
    const logger = { warn: jest.fn() };
    const client = freshCreate(config, logger);
    expect(client).toBeNull();
    expect(MockCosmosClient).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not supported in production'));
  });

  it('allows connection string auth in production', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: 'AccountEndpoint=https://prod.documents.azure.com:443/;AccountKey=abc;',
      endpoint: 'https://prod.documents.azure.com:443/',
      key: 'secret-key',
      database: 'chatbot',
      deploymentType: 'production',
    };
    const logger = { warn: jest.fn() };
    const client = freshCreate(config, logger);
    expect(client).not.toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('allows managed identity (endpoint only) in production', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: undefined,
      endpoint: 'https://prod.documents.azure.com:443/',
      key: undefined,
      database: 'chatbot',
      deploymentType: 'production',
    };
    const logger = { warn: jest.fn() };
    const client = freshCreate(config, logger);
    expect(client).not.toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('deduplicates the production key auth warning within a module instance', async () => {
    const { createCosmosClient: freshCreate } = await import('../../src/agent/cosmos-utils.js');
    const config = {
      connectionString: undefined,
      endpoint: 'https://prod.documents.azure.com:443/',
      key: 'secret-key',
      database: 'chatbot',
      deploymentType: 'production',
    };
    const logger = { warn: jest.fn() };
    freshCreate(config, logger);
    freshCreate(config, logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
