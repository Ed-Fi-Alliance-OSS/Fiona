import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  getAvgInteractionsPerUser,
  getDistinctUsers,
  getErrorCount,
  getFeedbackBreakdown,
  getFeedbackDetails,
  getFeedbackResponseRate,
  getNewUsersCount,
  getRateLimitedCount,
  getRepresentativeFeedback,
  getRepresentativeFeedbackInRange,
  getSessionCount,
  getTotalInteractions,
} from '../../lib/cosmos-queries.js';

describe('cosmos-queries', () => {
  let mockInteractionsContainer;
  let mockFeedbackContainer;

  const deploymentType = 'production';
  const oneWeekAgoISO = '2026-03-10T00:00:00.000Z';

  beforeEach(() => {
    const makeQueryable = (resources) => ({
      items: {
        query: jest.fn().mockReturnValue({
          fetchAll: jest.fn().mockResolvedValue({ resources }),
        }),
      },
    });

    mockInteractionsContainer = makeQueryable([42]);
    mockFeedbackContainer = makeQueryable([{ value: 'good-feedback', count: 29 }]);
  });

  describe('getDistinctUsers', () => {
    it('returns count of distinct users', async () => {
      const result = await getDistinctUsers(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(42);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getDistinctUsers(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });

    it('passes correct query parameters', async () => {
      await getDistinctUsers(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      const [querySpec] = mockInteractionsContainer.items.query.mock.calls[0];
      expect(querySpec.parameters).toContainEqual({ name: '@deploymentType', value: 'production' });
      expect(querySpec.parameters).toContainEqual({ name: '@oneWeekAgoISO', value: oneWeekAgoISO });
    });
  });

  describe('getSessionCount', () => {
    it('returns count of distinct sessions', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [118] }),
      });
      const result = await getSessionCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(118);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getSessionCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getTotalInteractions', () => {
    it('returns total interaction count', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [347] }),
      });
      const result = await getTotalInteractions(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(347);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getTotalInteractions(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getErrorCount', () => {
    it('returns count of error interactions', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [8] }),
      });
      const result = await getErrorCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(8);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getErrorCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getRateLimitedCount', () => {
    it('returns count of rate-limited requests', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [6] }),
      });
      const result = await getRateLimitedCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(6);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getRateLimitedCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getFeedbackBreakdown', () => {
    it('returns array of feedback value/count pairs', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({
          resources: [
            { value: 'good-feedback', count: 29 },
            { value: 'bad-feedback', count: 7 },
          ],
        }),
      });
      const result = await getFeedbackBreakdown(mockFeedbackContainer, deploymentType, oneWeekAgoISO);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ value: 'good-feedback', count: 29 });
      expect(result[1]).toEqual({ value: 'bad-feedback', count: 7 });
    });

    it('returns empty array when no feedback', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getFeedbackBreakdown(mockFeedbackContainer, deploymentType, oneWeekAgoISO);
      expect(result).toEqual([]);
    });
  });

  describe('getAvgInteractionsPerUser', () => {
    it('returns average interactions per user', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [8.3] }),
      });
      const result = await getAvgInteractionsPerUser(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(8.3);
    });

    it('returns 0 when no active users', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getAvgInteractionsPerUser(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getNewUsersCount', () => {
    it('returns count of current-period users with no prior successful interaction', async () => {
      mockInteractionsContainer.items.query
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: ['user-1', 'user-2', 'user-3'] }),
        })
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: ['user-2'] }),
        });

      const result = await getNewUsersCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(2);
    });

    it('returns 0 when there are no users in the period', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      const result = await getNewUsersCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
      expect(mockInteractionsContainer.items.query).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when all current-period users are returning users', async () => {
      mockInteractionsContainer.items.query
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: ['user-1', 'user-2'] }),
        })
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: ['user-1', 'user-2'] }),
        });

      const result = await getNewUsersCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });

    it('passes the current-period userIds as a parameter to the prior-history query', async () => {
      mockInteractionsContainer.items.query
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: ['user-1', 'user-2'] }),
        })
        .mockReturnValueOnce({
          fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
        });

      await getNewUsersCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);

      const [, secondQuerySpec] = mockInteractionsContainer.items.query.mock.calls;
      expect(secondQuerySpec[0].parameters).toContainEqual({
        name: '@currentUsers',
        value: ['user-1', 'user-2'],
      });
    });
  });

  describe('getFeedbackResponseRate', () => {
    it('divides feedback count by interaction count and returns percentage', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [200] }),
      });
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [50] }),
      });
      const result = await getFeedbackResponseRate(
        mockInteractionsContainer,
        mockFeedbackContainer,
        deploymentType,
        oneWeekAgoISO,
      );
      expect(result).toBe(25); // (50 / 200) * 100
    });

    it('returns 0 when no interactions', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getFeedbackResponseRate(
        mockInteractionsContainer,
        mockFeedbackContainer,
        deploymentType,
        oneWeekAgoISO,
      );
      expect(result).toBe(0);
    });
  });

  describe('getRepresentativeFeedback', () => {
    it('prioritizes entries with a reason over reason-less entries', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({
          resources: [
            {
              userMessage: 'no reason newest',
              botResponse: 'resp1',
              value: 'good-feedback',
              reason: null,
              timestamp: '2026-03-16T00:00:00.000Z',
            },
            {
              userMessage: 'has reason',
              botResponse: 'resp2',
              value: 'bad-feedback',
              reason: 'confusing answer',
              timestamp: '2026-03-15T00:00:00.000Z',
            },
          ],
        }),
      });

      const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ userMessage: 'has reason', hasReason: true });
      expect(result[1]).toMatchObject({ userMessage: 'no reason newest', hasReason: false });
    });

    it('fills remaining slots with reason-less entries when fewer than limit have reasons', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({
          resources: [
            {
              userMessage: 'reason A',
              botResponse: 'respA',
              value: 'good-feedback',
              reason: 'great',
              timestamp: '2026-03-16T00:00:00.000Z',
            },
            {
              userMessage: 'no reason B',
              botResponse: 'respB',
              value: 'good-feedback',
              reason: null,
              timestamp: '2026-03-15T00:00:00.000Z',
            },
            {
              userMessage: 'no reason C',
              botResponse: 'respC',
              value: 'bad-feedback',
              reason: null,
              timestamp: '2026-03-14T00:00:00.000Z',
            },
          ],
        }),
      });

      const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO, 5);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.userMessage)).toEqual(['reason A', 'no reason B', 'no reason C']);
    });

    it('caps results at the given limit', async () => {
      const resources = Array.from({ length: 8 }, (_, i) => ({
        userMessage: `msg-${i}`,
        botResponse: `resp-${i}`,
        value: 'good-feedback',
        reason: `reason-${i}`,
        timestamp: `2026-03-${10 + i}T00:00:00.000Z`,
      }));
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources }),
      });

      const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO, 5);

      expect(result).toHaveLength(5);
    });

    it('returns an empty array when there is no feedback in the window', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      const result = await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO);

      expect(result).toEqual([]);
    });

    it('passes correct query parameters', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      await getRepresentativeFeedback(mockFeedbackContainer, deploymentType, oneWeekAgoISO);

      const [querySpec] = mockFeedbackContainer.items.query.mock.calls[0];
      expect(querySpec.parameters).toContainEqual({ name: '@deploymentType', value: 'production' });
      expect(querySpec.parameters).toContainEqual({ name: '@oneWeekAgoISO', value: oneWeekAgoISO });
    });
  });

  describe('getFeedbackDetails', () => {
    const startISO = '2026-04-13T00:00:00.000Z';
    const endISO = '2026-04-20T00:00:00.000Z';

    it('returns a chronological (newest-first) unfiltered feedback listing', async () => {
      // Resources arrive already newest-first, as Cosmos's ORDER BY f.timestamp DESC would return them.
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({
          resources: [
            {
              timestamp: '2026-04-16T00:00:00.000Z',
              userId: 'u1',
              feedbackValue: 'good-feedback',
              userMessage: 'q1',
              botResponse: 'a1',
            },
            {
              timestamp: '2026-04-15T00:00:00.000Z',
              userId: 'u2',
              feedbackValue: 'bad-feedback',
              userMessage: 'q2',
              botResponse: 'a2',
            },
          ],
        }),
      });

      const result = await getFeedbackDetails(mockFeedbackContainer, deploymentType, startISO, endISO);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        timestamp: '2026-04-16T00:00:00.000Z',
        userId: 'u1',
        value: 'good-feedback',
        userMessage: 'q1',
        botResponse: 'a1',
      });
      expect(result[1].userId).toBe('u2');
    });

    it('caps results at the given limit', async () => {
      const resources = Array.from({ length: 30 }, (_, i) => ({
        timestamp: `2026-04-${(i % 28) + 1}T00:00:00.000Z`,
        userId: `u${i}`,
        feedbackValue: 'good-feedback',
        userMessage: `msg-${i}`,
        botResponse: `resp-${i}`,
      }));
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources }),
      });

      const result = await getFeedbackDetails(mockFeedbackContainer, deploymentType, startISO, endISO, 25);

      expect(result).toHaveLength(25);
    });

    it('returns an empty array when there is no feedback in range', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      const result = await getFeedbackDetails(mockFeedbackContainer, deploymentType, startISO, endISO);

      expect(result).toEqual([]);
    });

    it('passes correct query parameters', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      await getFeedbackDetails(mockFeedbackContainer, deploymentType, startISO, endISO);

      const [querySpec] = mockFeedbackContainer.items.query.mock.calls[0];
      expect(querySpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
      expect(querySpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
      expect(querySpec.parameters).toContainEqual({ name: '@endISO', value: endISO });
    });
  });

  describe('getRepresentativeFeedbackInRange', () => {
    const startISO = '2026-04-13T00:00:00.000Z';
    const endISO = '2026-04-20T00:00:00.000Z';

    it('prioritizes entries with a reason over reason-less entries', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({
          resources: [
            {
              userMessage: 'no reason newest',
              botResponse: 'resp1',
              value: 'good-feedback',
              reason: null,
              timestamp: '2026-04-16T00:00:00.000Z',
            },
            {
              userMessage: 'has reason',
              botResponse: 'resp2',
              value: 'bad-feedback',
              reason: 'confusing answer',
              timestamp: '2026-04-15T00:00:00.000Z',
            },
          ],
        }),
      });

      const result = await getRepresentativeFeedbackInRange(mockFeedbackContainer, deploymentType, startISO, endISO);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ userMessage: 'has reason', hasReason: true });
      expect(result[1]).toMatchObject({ userMessage: 'no reason newest', hasReason: false });
    });

    it('caps results at the given limit', async () => {
      const resources = Array.from({ length: 8 }, (_, i) => ({
        userMessage: `msg-${i}`,
        botResponse: `resp-${i}`,
        value: 'good-feedback',
        reason: `reason-${i}`,
        timestamp: `2026-04-1${i}T00:00:00.000Z`,
      }));
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources }),
      });

      const result = await getRepresentativeFeedbackInRange(mockFeedbackContainer, deploymentType, startISO, endISO, 5);

      expect(result).toHaveLength(5);
    });

    it('returns an empty array when there is no feedback in the window', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      const result = await getRepresentativeFeedbackInRange(mockFeedbackContainer, deploymentType, startISO, endISO);

      expect(result).toEqual([]);
    });

    it('passes startISO and endISO as bounded range parameters', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({ resources: [] }),
      });

      await getRepresentativeFeedbackInRange(mockFeedbackContainer, deploymentType, startISO, endISO);

      const [querySpec] = mockFeedbackContainer.items.query.mock.calls[0];
      expect(querySpec.parameters).toContainEqual({ name: '@deploymentType', value: deploymentType });
      expect(querySpec.parameters).toContainEqual({ name: '@startISO', value: startISO });
      expect(querySpec.parameters).toContainEqual({ name: '@endISO', value: endISO });
    });
  });
});
