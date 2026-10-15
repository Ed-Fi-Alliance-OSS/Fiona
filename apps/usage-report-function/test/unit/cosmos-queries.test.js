import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getFeedbackDetails, getRepresentativeFeedbackInRange } from '../../lib/cosmos-queries.js';

describe('cosmos-queries', () => {
  let mockFeedbackContainer;

  const deploymentType = 'production';

  beforeEach(() => {
    const makeQueryable = (resources) => ({
      items: {
        query: jest.fn().mockReturnValue({
          fetchAll: jest.fn().mockResolvedValue({ resources }),
        }),
      },
    });

    mockFeedbackContainer = makeQueryable([]);
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
              userId: 'first-user',
              userMessage: 'no reason newest',
              botResponse: 'resp1',
              value: 'good-feedback',
              reason: null,
              timestamp: '2026-04-16T00:00:00.000Z',
            },
            {
              userId: 'second-user',
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
      expect(result[0].userId).toBe('second-user');
      expect(mockFeedbackContainer.items.query.mock.calls[0][0].query).toContain('SELECT f.userId');
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
              timestamp: '2026-04-16T00:00:00.000Z',
            },
            {
              userMessage: 'no reason B',
              botResponse: 'respB',
              value: 'good-feedback',
              reason: null,
              timestamp: '2026-04-15T00:00:00.000Z',
            },
            {
              userMessage: 'no reason C',
              botResponse: 'respC',
              value: 'bad-feedback',
              reason: null,
              timestamp: '2026-04-14T00:00:00.000Z',
            },
          ],
        }),
      });

      const result = await getRepresentativeFeedbackInRange(mockFeedbackContainer, deploymentType, startISO, endISO, 5);

      expect(result.map((r) => r.userMessage)).toEqual(['reason A', 'no reason B', 'no reason C']);
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

    it('excludes in-range feedback entries where both question and answer are empty', async () => {
      mockFeedbackContainer.items.query.mockReturnValue({
        fetchAll: jest.fn().mockResolvedValue({
          resources: [
            {
              userMessage: null,
              botResponse: null,
              value: 'good-feedback',
              reason: 'thumb only',
              timestamp: '2026-04-16T00:00:00.000Z',
            },
            {
              userMessage: null,
              botResponse: 'has answer',
              value: 'bad-feedback',
              reason: null,
              timestamp: '2026-04-15T00:00:00.000Z',
            },
          ],
        }),
      });

      const result = await getRepresentativeFeedbackInRange(mockFeedbackContainer, deploymentType, startISO, endISO);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ botResponse: 'has answer' });
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
