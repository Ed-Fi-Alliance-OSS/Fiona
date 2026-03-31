import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  generateResponseId,
  isResponseFinalized,
  markResponseFinalized,
  shouldFinalize,
  clearFinalizedResponses,
  getFinalizedResponseCount,
} from '../../../src/agent/utils/idempotent-finalize.js';

describe('idempotent-finalize', () => {
  beforeEach(() => {
    // Clear state before each test
    clearFinalizedResponses();
  });

  describe('generateResponseId', () => {
    it('generates unique ID from channel, thread_ts, and request_ts', () => {
      const id = generateResponseId('C123', 't456', 'req001');
      expect(id).toBe('C123:t456:req001');
    });

    it('falls back to thread_ts as request token when requestTs is omitted', () => {
      const id = generateResponseId('C123', 't456');
      expect(id).toBe('C123:t456:t456');
    });

    it('creates consistent IDs for same inputs', () => {
      const id1 = generateResponseId('C123', 't456', 'req001');
      const id2 = generateResponseId('C123', 't456', 'req001');
      expect(id1).toBe(id2);
    });

    it('creates different IDs for different channels', () => {
      const id1 = generateResponseId('C123', 't456', 'req001');
      const id2 = generateResponseId('C999', 't456', 'req001');
      expect(id1).not.toBe(id2);
    });

    it('creates different IDs for different threads', () => {
      const id1 = generateResponseId('C123', 't456', 'req001');
      const id2 = generateResponseId('C123', 't999', 'req001');
      expect(id1).not.toBe(id2);
    });

    it('creates different IDs for different request timestamps', () => {
      const id1 = generateResponseId('C123', 't456', 'req001');
      const id2 = generateResponseId('C123', 't456', 'req002');
      expect(id1).not.toBe(id2);
    });
  });

  describe('isResponseFinalized', () => {
    it('returns false for unfinal response', () => {
      const id = generateResponseId('C123', 't456');
      expect(isResponseFinalized(id)).toBe(false);
    });

    it('returns true after marking finalized', () => {
      const id = generateResponseId('C123', 't456');
      markResponseFinalized(id);
      expect(isResponseFinalized(id)).toBe(true);
    });
  });

  describe('shouldFinalize', () => {
    it('allows finalization for new response', () => {
      const id = generateResponseId('C123', 't456');
      expect(shouldFinalize(id)).toBe(true);
    });

    it('prevents finalization of already-finalized response', () => {
      const id = generateResponseId('C123', 't456');
      markResponseFinalized(id);
      expect(shouldFinalize(id)).toBe(false);
    });

    it('is idempotent check and does not modify state', () => {
      const id = generateResponseId('C123', 't456');
      expect(shouldFinalize(id)).toBe(true);
      expect(shouldFinalize(id)).toBe(true); // Still true, no state change
    });
  });

  describe('markResponseFinalized', () => {
    it('marks response as finalized', () => {
      const id = generateResponseId('C123', 't456');
      markResponseFinalized(id);
      expect(isResponseFinalized(id)).toBe(true);
    });

    it('allows marking multiple responses', () => {
      const id1 = generateResponseId('C123', 't456');
      const id2 = generateResponseId('C999', 't789');

      markResponseFinalized(id1);
      markResponseFinalized(id2);

      expect(isResponseFinalized(id1)).toBe(true);
      expect(isResponseFinalized(id2)).toBe(true);
    });

    it('is idempotent - marking twice is safe', () => {
      const id = generateResponseId('C123', 't456');
      markResponseFinalized(id);
      markResponseFinalized(id); // Mark again
      expect(isResponseFinalized(id)).toBe(true);
    });
  });

  describe('getFinalizedResponseCount', () => {
    it('returns 0 when no responses finalized', () => {
      expect(getFinalizedResponseCount()).toBe(0);
    });

    it('returns count of finalized responses', () => {
      markResponseFinalized(generateResponseId('C1', 't1'));
      markResponseFinalized(generateResponseId('C2', 't2'));
      expect(getFinalizedResponseCount()).toBe(2);
    });
  });

  describe('clearFinalizedResponses', () => {
    it('clears all finalized responses', () => {
      markResponseFinalized(generateResponseId('C1', 't1'));
      markResponseFinalized(generateResponseId('C2', 't2'));

      clearFinalizedResponses();

      expect(getFinalizedResponseCount()).toBe(0);
    });

    it('allows responses to be finalized again after clear', () => {
      const id = generateResponseId('C1', 't1');

      markResponseFinalized(id);
      expect(shouldFinalize(id)).toBe(false);

      clearFinalizedResponses();
      expect(shouldFinalize(id)).toBe(true);
    });
  });

  describe('Duplicate finalization prevention', () => {
    it('prevents duplicate streamer.stop() calls for same response', () => {
      const channel = 'C123';
      const threadTs = 't456';
      const id = generateResponseId(channel, threadTs);

      // First call succeeds
      expect(shouldFinalize(id)).toBe(true);
      markResponseFinalized(id);

      // Second call for same response fails
      expect(shouldFinalize(id)).toBe(false);
    });

    it('allows finalization for different threads', () => {
      const channel = 'C123';
      const id1 = generateResponseId(channel, 't456');
      const id2 = generateResponseId(channel, 't999');

      markResponseFinalized(id1);

      // Different thread can still finalize
      expect(shouldFinalize(id2)).toBe(true);
    });

    it('allows finalization for different channels', () => {
      const thread = 't456';
      const id1 = generateResponseId('C123', thread);
      const id2 = generateResponseId('C999', thread);

      markResponseFinalized(id1);

      // Different channel can still finalize
      expect(shouldFinalize(id2)).toBe(true);
    });
  });
});
