import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDistinctUsers,
  getSessionCount,
  getTotalInteractions,
  getErrorCount,
  getRateLimitedCount,
  getFeedbackBreakdown,
  getAvgInteractionsPerUser,
  getFeedbackResponseRate,
} from '../../lib/cosmos-queries.js';

describe('cosmos-queries', () => {
  let mockInteractionsContainer;
  let mockFeedbackContainer;

  const deploymentType = 'production';
  const oneWeekAgoISO = '2026-03-10T00:00:00.000Z';

  beforeEach(() => {
    const makeQueryable = (resources) => ({
      items: {
        query: vi.fn().mockReturnValue({
          fetchAll: vi.fn().mockResolvedValue({ resources }),
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
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getDistinctUsers(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });

    it('passes correct query parameters', async () => {
      await getDistinctUsers(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      const [, options] = mockInteractionsContainer.items.query.mock.calls[0];
      expect(options.parameters).toContainEqual({ name: '@deploymentType', value: 'production' });
      expect(options.parameters).toContainEqual({ name: '@oneWeekAgoISO', value: oneWeekAgoISO });
    });
  });

  describe('getSessionCount', () => {
    it('returns count of distinct sessions', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [118] }),
      });
      const result = await getSessionCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(118);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getSessionCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getTotalInteractions', () => {
    it('returns total interaction count', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [347] }),
      });
      const result = await getTotalInteractions(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(347);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getTotalInteractions(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getErrorCount', () => {
    it('returns count of error interactions', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [8] }),
      });
      const result = await getErrorCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(8);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getErrorCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getRateLimitedCount', () => {
    it('returns count of rate-limited requests', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [6] }),
      });
      const result = await getRateLimitedCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(6);
    });

    it('returns 0 when no results', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getRateLimitedCount(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getFeedbackBreakdown', () => {
    it('returns array of feedback value/count pairs', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({
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
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getFeedbackBreakdown(mockFeedbackContainer, deploymentType, oneWeekAgoISO);
      expect(result).toEqual([]);
    });
  });

  describe('getAvgInteractionsPerUser', () => {
    it('returns average interactions per user', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [8.3] }),
      });
      const result = await getAvgInteractionsPerUser(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(8.3);
    });

    it('returns 0 when no active users', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
      });
      const result = await getAvgInteractionsPerUser(mockInteractionsContainer, deploymentType, oneWeekAgoISO);
      expect(result).toBe(0);
    });
  });

  describe('getFeedbackResponseRate', () => {
    it('returns feedback response rate percentage', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [9.8] }),
      });
      const result = await getFeedbackResponseRate(
        mockInteractionsContainer,
        mockFeedbackContainer,
        deploymentType,
        oneWeekAgoISO,
      );
      expect(result).toBe(9.8);
    });

    it('returns 0 when no interactions', async () => {
      mockInteractionsContainer.items.query.mockReturnValue({
        fetchAll: vi.fn().mockResolvedValue({ resources: [] }),
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
});
