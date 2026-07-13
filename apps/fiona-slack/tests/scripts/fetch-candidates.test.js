// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll } from '@jest/globals';

// Mocks must be declared before the dynamic import below
jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: jest.fn(),
}));
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));
jest.unstable_mockModule('dotenv', () => ({ config: jest.fn() }));

let buildSlackUrl, fetchConversations, joinFeedback;

beforeAll(async () => {
  // Containers are injected as parameters, so a single module load suffices
  ({ buildSlackUrl, fetchConversations, joinFeedback } = await import('../../scripts/fetch-candidates.js'));
});

describe('buildSlackUrl', () => {
  it('constructs URL stripping the dot from messageTs', () => {
    expect(buildSlackUrl('C123ABC', '1783737161.950319')).toBe(
      'https://ed-fi-alliance.slack.com/archives/C123ABC/p1783737161950319',
    );
  });

  it('pads the numeric portion to 16 characters after removing dot', () => {
    expect(buildSlackUrl('C123', '1234.56')).toBe(
      'https://ed-fi-alliance.slack.com/archives/C123/p1234560000000000',
    );
  });

  it('handles messageTs with no dot', () => {
    expect(buildSlackUrl('C123', '1783737161950319')).toBe(
      'https://ed-fi-alliance.slack.com/archives/C123/p1783737161950319',
    );
  });
});

describe('fetchConversations', () => {
  it('returns conversations mapped with threadTurns and without threadHistory', async () => {
    const mockFetchAll = jest.fn()
      .mockResolvedValueOnce({
        resources: [
          {
            id: 'U1_ts1_ts2',
            userId: 'U1',
            channelId: 'D123',
            threadTs: 'ts1',
            messageTs: 'ts2',
            userMessage: 'Q?',
            botResponse: 'A.',
            sources: [],
            threadHistory: ['a', 'b', 'c'],
            timestamp: '2026-07-01T00:00:00Z',
            entryPoint: 'assistant_message',
            deploymentType: 'production',
          },
        ],
      })
      // Second call returns empty to signal end of pagination
      .mockResolvedValue({ resources: [] });
    const mockContainer = {
      items: { query: jest.fn().mockReturnValue({ fetchAll: mockFetchAll }) },
    };

    const results = await fetchConversations(mockContainer, {
      deploymentType: 'production',
      since: '2026-06-01T00:00:00Z',
    });

    expect(results).toHaveLength(1);
    expect(results[0].threadTurns).toBe(3);
    expect(results[0]).not.toHaveProperty('threadHistory');
    expect(results[0].source).toBe('cosmos');
  });

  it('filters out records older than since', async () => {
    const mockFetchAll = jest.fn().mockResolvedValue({
      resources: [
        { id: 'new', timestamp: '2026-07-01T00:00:00Z', threadHistory: [], sources: [] },
        { id: 'old', timestamp: '2026-05-01T00:00:00Z', threadHistory: [], sources: [] },
      ],
    });
    const mockContainer = {
      items: { query: jest.fn().mockReturnValue({ fetchAll: mockFetchAll }) },
    };

    const results = await fetchConversations(mockContainer, {
      deploymentType: 'production',
      since: '2026-06-01T00:00:00Z',
    });

    expect(results.map((r) => r.id)).toEqual(['new']);
  });

  it('returns empty array when container returns no resources', async () => {
    const mockFetchAll = jest.fn().mockResolvedValue({ resources: [] });
    const mockContainer = {
      items: { query: jest.fn().mockReturnValue({ fetchAll: mockFetchAll }) },
    };

    const results = await fetchConversations(mockContainer, {
      deploymentType: 'production',
      since: '2026-06-01T00:00:00Z',
    });

    expect(results).toEqual([]);
  });
});

describe('joinFeedback', () => {
  it('sets hasBadFeedback true and reason when matching bad-feedback record exists', async () => {
    const mockRead = jest.fn().mockResolvedValue({
      resource: { value: 'bad-feedback', reason: 'wrong answer' },
    });
    const mockFeedbackContainer = {
      item: jest.fn().mockReturnValue({ read: mockRead }),
    };

    const conversations = [
      { userId: 'U1', messageTs: '1234.56', deploymentType: 'production' },
    ];
    const result = await joinFeedback(conversations, mockFeedbackContainer, {
      deploymentType: 'production',
    });

    expect(result[0].hasBadFeedback).toBe(true);
    expect(result[0].badFeedbackReason).toBe('wrong answer');
  });

  it('sets hasBadFeedback false when feedback record is good-feedback', async () => {
    const mockRead = jest.fn().mockResolvedValue({
      resource: { value: 'good-feedback', reason: null },
    });
    const mockFeedbackContainer = {
      item: jest.fn().mockReturnValue({ read: mockRead }),
    };

    const conversations = [{ userId: 'U1', messageTs: '1234.56', deploymentType: 'production' }];
    const result = await joinFeedback(conversations, mockFeedbackContainer, {
      deploymentType: 'production',
    });

    expect(result[0].hasBadFeedback).toBe(false);
    expect(result[0].badFeedbackReason).toBeNull();
  });

  it('sets hasBadFeedback false when no feedback record exists (404)', async () => {
    const mockRead = jest.fn().mockResolvedValue({ resource: undefined });
    const mockFeedbackContainer = {
      item: jest.fn().mockReturnValue({ read: mockRead }),
    };

    const conversations = [{ userId: 'U1', messageTs: '1234.56', deploymentType: 'production' }];
    const result = await joinFeedback(conversations, mockFeedbackContainer, {
      deploymentType: 'production',
    });

    expect(result[0].hasBadFeedback).toBe(false);
    expect(result[0].badFeedbackReason).toBeNull();
  });

  it('constructs feedback item id as {userId}_{messageTs}', async () => {
    const mockRead = jest.fn().mockResolvedValue({ resource: undefined });
    const mockItem = jest.fn().mockReturnValue({ read: mockRead });
    const mockFeedbackContainer = { item: mockItem };

    await joinFeedback(
      [{ userId: 'UA7S95MU2', messageTs: '1783737161.950319', deploymentType: 'production' }],
      mockFeedbackContainer,
      { deploymentType: 'production' },
    );

    expect(mockItem).toHaveBeenCalledWith(
      'UA7S95MU2_1783737161.950319',
      ['production', 'UA7S95MU2_1783737161.950319'],
    );
  });
});
