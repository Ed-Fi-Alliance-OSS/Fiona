// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';

const mockUpsert = jest.fn().mockResolvedValue({});
const mockContainerObj = { items: { upsert: mockUpsert } };
const mockDatabase = { container: jest.fn().mockReturnValue(mockContainerObj) };
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
}));

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: MockCosmosClient,
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

const VALID_CAPTURE = {
  userId: 'U123',
  teamId: 'T456',
  channelId: 'C789',
  threadTs: '1000.0001',
  messageTs: '1000.0002',
  entryPoint: 'app_mention',
  userMessage: 'What is Ed-Fi?',
  botResponse: 'Ed-Fi is a data standard.',
  threadHistory: [{ role: 'user', content: 'What is Ed-Fi?' }],
  llmProvider: 'perplexity',
  llmModel: 'sonar',
  sources: [{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs', index: 1 }],
};

describe('conversation-capture-store - CAPTURE_ALL_CONVERSATIONS disabled', () => {
  let captureConversation;

  beforeAll(async () => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_CONVERSATIONS_CONTAINER;
    ({ captureConversation } = await import('../../src/agent/conversation-capture-store.js'));
  });

  it('is a no-op when CAPTURE_ALL_CONVERSATIONS is not set', async () => {
    await captureConversation(VALID_CAPTURE);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('conversation-capture-store - Cosmos not configured', () => {
  let captureConversation;

  beforeAll(async () => {
    process.env.CAPTURE_ALL_CONVERSATIONS = 'true';
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_CONVERSATIONS_CONTAINER;
    jest.resetModules();
    ({ captureConversation } = await import('../../src/agent/conversation-capture-store.js'));
  });

  afterAll(() => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
  });

  it('warns exactly once per module lifetime when Cosmos is not configured', async () => {
    const logger = { warn: jest.fn() };
    await captureConversation({ ...VALID_CAPTURE, logger });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CosmosDB not configured'));

    // Second call — same or different logger — flag is already set, no additional warning
    await captureConversation({ ...VALID_CAPTURE, logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('conversation-capture-store - Cosmos configured via connection string', () => {
  let captureConversation;

  beforeAll(async () => {
    process.env.CAPTURE_ALL_CONVERSATIONS = 'true';
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=dGVzdA==';
    process.env.COSMOS_CONVERSATIONS_CONTAINER = 'conversations';
    process.env.DEPLOYMENT_TYPE = 'local';
    jest.resetModules();
    MockCosmosClient.mockClear();
    mockUpsert.mockClear();
    ({ captureConversation } = await import('../../src/agent/conversation-capture-store.js'));
  });

  afterAll(() => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_CONVERSATIONS_CONTAINER;
  });

  beforeEach(() => {
    mockUpsert.mockClear();
  });

  it('upserts a document with all required fields', async () => {
    await captureConversation(VALID_CAPTURE);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.id).toBe('U123_1000.0001_1000.0002');
    expect(doc.userId).toBe('U123');
    expect(doc.teamId).toBe('T456');
    expect(doc.channelId).toBe('C789');
    expect(doc.threadTs).toBe('1000.0001');
    expect(doc.messageTs).toBe('1000.0002');
    expect(doc.entryPoint).toBe('app_mention');
    expect(doc.userMessage).toBe('What is Ed-Fi?');
    expect(doc.botResponse).toBe('Ed-Fi is a data standard.');
    expect(doc.threadHistory).toEqual([{ role: 'user', content: 'What is Ed-Fi?' }]);
    expect(doc.llmProvider).toBe('perplexity');
    expect(doc.llmModel).toBe('sonar');
    expect(doc.sources).toEqual([{ url: 'https://docs.ed-fi.org', title: 'Ed-Fi Docs', index: 1 }]);
    expect(doc.deploymentType).toBe('local');
    expect(doc.ttl).toBe(31_104_000);
    expect(doc.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('uses deploymentType and userId as the partition key', async () => {
    await captureConversation(VALID_CAPTURE);
    const [, options] = mockUpsert.mock.calls[0];
    expect(options.partitionKey).toEqual(['local', 'U123']);
  });

  it('defaults sources to empty array when not provided', async () => {
    await captureConversation({ ...VALID_CAPTURE, sources: undefined });
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.sources).toEqual([]);
  });

  it('silently swallows Cosmos write errors and warns', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('cosmos timeout'));
    const logger = { warn: jest.fn() };
    await expect(captureConversation({ ...VALID_CAPTURE, logger })).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to capture conversation'));
  });

  it('skips write and warns when required fields are missing', async () => {
    const logger = { warn: jest.fn() };
    await captureConversation({ ...VALID_CAPTURE, userId: undefined, logger });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Missing required fields'));
  });
});
