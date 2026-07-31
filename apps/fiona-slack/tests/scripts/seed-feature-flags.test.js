// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals';

// Mock dotenv so the test file's CWD doesn't need a real .env
jest.unstable_mockModule('dotenv', () => ({ config: jest.fn() }));

const mockRead = jest.fn();
const mockUpsert = jest.fn().mockResolvedValue({});
const mockDelete = jest.fn().mockResolvedValue({});
const mockItem = jest.fn(() => ({ read: mockRead, delete: mockDelete }));
const mockContainerObj = { item: mockItem, items: { upsert: mockUpsert } };
const mockDatabase = { container: jest.fn().mockReturnValue(mockContainerObj) };
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
}));

jest.unstable_mockModule('@azure/cosmos', () => ({ CosmosClient: MockCosmosClient }));
jest.unstable_mockModule('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));

let resolveEnvironment, resolveDocId, parseFlagPairs, parseBool, upsertFlags, main;

beforeAll(async () => {
  ({ resolveEnvironment, resolveDocId, parseFlagPairs, parseBool, upsertFlags, main } = await import(
    '../../scripts/seed-feature-flags.js'
  ));
});

beforeEach(() => {
  mockRead.mockReset().mockResolvedValue({ resource: undefined });
  mockUpsert.mockClear().mockResolvedValue({});
  mockDelete.mockClear().mockResolvedValue({});
  mockItem.mockClear();
  MockCosmosClient.mockClear();
  process.env.COSMOS_ENDPOINT = 'https://acct.documents.azure.com:443/';
  process.env.COSMOS_KEY = 'k';
  delete process.env.COSMOS_CONNECTION_STRING;
  delete process.env.DEPLOYMENT_TYPE;
});

afterEach(() => {
  delete process.env.COSMOS_ENDPOINT;
  delete process.env.COSMOS_KEY;
  delete process.env.DEPLOYMENT_TYPE;
});

// ── environment resolution ──────────────────────────────────────────────────

describe('resolveEnvironment', () => {
  it('uses --environment when provided', () => {
    expect(resolveEnvironment(['--environment=production'])).toBe('production');
  });

  it('falls back to DEPLOYMENT_TYPE when --environment is absent', () => {
    process.env.DEPLOYMENT_TYPE = 'insiders';
    expect(resolveEnvironment([])).toBe('insiders');
  });

  it('falls back to "local" when neither is set', () => {
    expect(resolveEnvironment([])).toBe('local');
  });
});

// ── scoped id resolution ────────────────────────────────────────────────────

describe('resolveDocId', () => {
  it('builds the <env>:global id for --global', () => {
    expect(resolveDocId(['--global'], 'production')).toBe('production:global');
  });

  it('builds the <env>:<userId> id for --user', () => {
    expect(resolveDocId(['--user=U123'], 'insiders')).toBe('insiders:U123');
  });

  it('throws when no scope is provided', () => {
    expect(() => resolveDocId([], 'local')).toThrow(/Scope required/);
  });

  it('throws when both --global and --user are provided', () => {
    expect(() => resolveDocId(['--global', '--user=U1'], 'local')).toThrow(/only one/);
  });
});

// ── flag pair parsing ───────────────────────────────────────────────────────

describe('parseFlagPairs', () => {
  it('parses a single flag with the space form', () => {
    expect(parseFlagPairs(['--flag', 'escalate=true'])).toEqual({ escalate: true });
  });

  it('parses multiple flags into one object', () => {
    expect(parseFlagPairs(['--flag=conversationCapture=false', '--flag', 'escalate=true'])).toEqual({
      conversationCapture: false,
      escalate: true,
    });
  });

  it('throws on a --flag without a name=value pair', () => {
    expect(() => parseFlagPairs(['--flag', '--global'])).toThrow(/name=value/);
  });
});

describe('parseBool', () => {
  it('parses truthy values', () => {
    for (const v of ['true', '1', 'yes', 'on']) expect(parseBool(v)).toBe(true);
  });

  it('parses falsy values', () => {
    for (const v of ['false', '0', 'no', 'off']) expect(parseBool(v)).toBe(false);
  });

  it('throws on an unrecognized value', () => {
    expect(() => parseBool('maybe')).toThrow(/Invalid boolean/);
  });
});

// ── upsertFlags ─────────────────────────────────────────────────────────────

describe('upsertFlags', () => {
  it('upserts a new global document with the correct scoped id', async () => {
    mockRead.mockRejectedValueOnce({ code: 404 });
    const written = await upsertFlags('production:global', { conversationCapture: true });
    expect(written).toBe(true);
    expect(mockItem).toHaveBeenCalledWith('production:global', 'production:global');
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc, options] = mockUpsert.mock.calls[0];
    expect(doc).toEqual({ id: 'production:global', flags: { conversationCapture: true } });
    expect(options).toEqual({ partitionKey: 'production:global' });
  });

  it('upserts a per-user document with the correct scoped id', async () => {
    mockRead.mockRejectedValueOnce({ code: 404 });
    await upsertFlags('insiders:U123', { escalate: true });
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc).toEqual({ id: 'insiders:U123', flags: { escalate: true } });
  });

  it('merges new flags into an existing document, overriding only supplied keys', async () => {
    mockRead.mockResolvedValueOnce({
      resource: { id: 'local:global', flags: { conversationCapture: true, escalate: true } },
    });
    await upsertFlags('local:global', { escalate: false });
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.flags).toEqual({ conversationCapture: true, escalate: false });
  });

  it('no-ops (returns false, no client) when Cosmos is unconfigured', async () => {
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    const written = await upsertFlags('local:global', { escalate: true });
    expect(written).toBe(false);
    expect(MockCosmosClient).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

// ── delivery mode (main) ────────────────────────────────────────────────────

describe('delivery mode', () => {
  it('creates a delivery doc with the DEPLOYMENT_TYPE-scoped id and metadata, disabled by default', async () => {
    mockRead.mockRejectedValueOnce({ code: 404 });
    await main([
      'node',
      'seed-feature-flags.js',
      '--delivery',
      '--ticket',
      'AI-12345',
      '--capability',
      'escalate',
      '--owner',
      'agent:x',
      '--environment',
      'insiders',
    ]);
    expect(mockItem).toHaveBeenCalledWith('insiders:delivery:AI-12345', 'insiders:delivery:AI-12345');
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc, options] = mockUpsert.mock.calls[0];
    expect(doc).toMatchObject({
      id: 'insiders:delivery:AI-12345',
      kind: 'delivery',
      ticket: 'AI-12345',
      capability: 'escalate',
      owner: 'agent:x',
      enabled: false,
      targetUsers: [],
    });
    expect(options).toEqual({ partitionKey: 'insiders:delivery:AI-12345' });
  });

  it('sets enabled and targetUsers when provided', async () => {
    mockRead.mockRejectedValueOnce({ code: 404 });
    await main([
      'node',
      'seed-feature-flags.js',
      '--delivery',
      '--ticket',
      'AI-12345',
      '--enabled',
      'true',
      '--target',
      'U1,U2',
      '--environment',
      'production',
    ]);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc).toMatchObject({
      id: 'production:delivery:AI-12345',
      enabled: true,
      targetUsers: ['U1', 'U2'],
    });
  });

  it('--remove deletes the scoped delivery doc', async () => {
    await main([
      'node',
      'seed-feature-flags.js',
      '--delivery',
      '--ticket',
      'AI-12345',
      '--remove',
      '--environment',
      'insiders',
    ]);
    expect(mockItem).toHaveBeenCalledWith('insiders:delivery:AI-12345', 'insiders:delivery:AI-12345');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('no-ops when Cosmos is unconfigured', async () => {
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    await main(['node', 'seed-feature-flags.js', '--delivery', '--ticket', 'AI-12345', '--environment', 'insiders']);
    expect(MockCosmosClient).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
