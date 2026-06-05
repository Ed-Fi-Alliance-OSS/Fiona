// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals';

// Set COSMOS_CONNECTION_STRING before the module is imported so that the
// module-level constant picks it up at load time.
process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=dGVzdA==;';

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

describe('recordFeedback - with connection string', () => {
  let recordFeedback;

  beforeAll(async () => {
    ({ recordFeedback } = await import('../../src/agent/feedback-store.js'));
  });

  beforeEach(() => {
    mockUpsert.mockClear();
  });

  it('calls upsert with the correct feedbackId', async () => {
    await recordFeedback({
      userId: 'U123',
      channelId: 'C456',
      messageTs: '1234567890.000001',
      value: 'good-feedback',
      userMessage: 'What is Ed-Fi?',
      botResponse: 'Ed-Fi is a data standard.',
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.feedbackId).toBe('U123_1234567890.000001');
  });

  it('persists all feedback fields', async () => {
    await recordFeedback({
      userId: 'U123',
      channelId: 'C456',
      messageTs: '1234567890.000002',
      value: 'bad-feedback',
      userMessage: 'How do I use the API?',
      botResponse: 'Use the REST API.',
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.userId).toBe('U123');
    expect(doc.channelId).toBe('C456');
    expect(doc.messageTs).toBe('1234567890.000002');
    expect(doc.value).toBe('bad-feedback');
    expect(doc.userMessage).toBe('How do I use the API?');
    expect(doc.botResponse).toBe('Use the REST API.');
  });

  it('includes a timestamp in ISO 8601 format', async () => {
    await recordFeedback({
      userId: 'U789',
      channelId: 'C101',
      messageTs: '1234567890.000003',
      value: 'good-feedback',
      userMessage: null,
      botResponse: null,
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(typeof doc.timestamp).toBe('string');
    expect(new Date(doc.timestamp).toISOString()).toBe(doc.timestamp);
  });

  it('passes hierarchical partition key [deploymentType, feedbackId]', async () => {
    await recordFeedback({
      userId: 'U123',
      channelId: 'C456',
      messageTs: '1234567890.000005',
      value: 'good-feedback',
      userMessage: null,
      botResponse: null,
    });

    const [doc, options] = mockUpsert.mock.calls[0];
    expect(options).toEqual({
      partitionKey: [doc.deploymentType, doc.feedbackId],
    });
  });

  it('resolves without error on success', async () => {
    await expect(
      recordFeedback({
        userId: 'U999',
        channelId: 'C999',
        messageTs: '1234567890.000004',
        value: 'good-feedback',
        userMessage: null,
        botResponse: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('persists reason when provided', async () => {
    await recordFeedback({
      userId: 'U123',
      channelId: 'C456',
      messageTs: '1234567890.000010',
      value: 'bad-feedback',
      reason: 'The answer was factually wrong',
      userMessage: 'What is 2+2?',
      botResponse: '5',
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.reason).toBe('The answer was factually wrong');
  });

  it('stores reason as null when not provided', async () => {
    await recordFeedback({
      userId: 'U123',
      channelId: 'C456',
      messageTs: '1234567890.000011',
      value: 'good-feedback',
      userMessage: null,
      botResponse: null,
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.reason).toBeNull();
  });

  it('stores reason as null when empty string is provided', async () => {
    await recordFeedback({
      userId: 'U123',
      channelId: 'C456',
      messageTs: '1234567890.000012',
      value: 'good-feedback',
      reason: '',
      userMessage: null,
      botResponse: null,
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.reason).toBeNull();
  });
});
