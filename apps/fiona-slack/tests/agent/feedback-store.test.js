// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll } from '@jest/globals';

// Mock @azure/cosmos and @azure/identity BEFORE the module under test is imported
const mockUpsert = jest.fn().mockResolvedValue({});
const mockContainerObj = { items: { upsert: mockUpsert } };
const mockDatabase = {
  container: jest.fn().mockReturnValue(mockContainerObj),
  containers: {
    createIfNotExists: jest.fn().mockResolvedValue({ container: mockContainerObj })
  }
};
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
  databases: {
    createIfNotExists: jest.fn().mockResolvedValue({ database: mockDatabase })
  }
}));

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: MockCosmosClient,
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

describe('recordFeedback - no cosmos config', () => {
  let recordFeedback;

  beforeAll(async () => {
    // Ensure no Cosmos env vars are set so getContainer() returns null
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    delete process.env.COSMOS_CONNECTION_STRING;

    ({ recordFeedback } = await import('../../src/agent/feedback-store.js'));
  });

  it('resolves without error when cosmos is not configured', async () => {
    await expect(
      recordFeedback({
        userId: 'U001',
        channelId: 'C001',
        messageTs: '1234567890.000001',
        value: 'good-feedback',
        userMessage: null,
        botResponse: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('does not call CosmosClient when not configured', async () => {
    MockCosmosClient.mockClear();
    await recordFeedback({
      userId: 'U002',
      channelId: 'C002',
      messageTs: '1234567890.000002',
      value: 'bad-feedback',
      userMessage: 'test question',
      botResponse: 'test response',
    });
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });

  it('does not call upsert when not configured', async () => {
    mockUpsert.mockClear();
    await recordFeedback({
      userId: 'U003',
      channelId: 'C003',
      messageTs: '1234567890.000003',
      value: 'good-feedback',
      userMessage: null,
      botResponse: null,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
