// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  generateResponseId,
  isResponseFinalized,
  markResponseFinalized,
  shouldFinalize,
  rollbackFinalization,
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

    it('atomically claims the response ID so a second call returns false', () => {
      const id = generateResponseId('C123', 't456');
      expect(shouldFinalize(id)).toBe(true);  // claims the slot
      expect(shouldFinalize(id)).toBe(false); // slot already claimed
    });

    it('marks the response as finalized when it returns true', () => {
      const id = generateResponseId('C123', 't456');
      shouldFinalize(id);
      expect(isResponseFinalized(id)).toBe(true);
    });

    it('calls logger.warn when response is already finalized', () => {
      const id = generateResponseId('C123', 't456');
      markResponseFinalized(id);
      const mockLogger = { warn: jest.fn() };
      shouldFinalize(id, mockLogger);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(id));
    });

    it('does not call logger.warn for a new (unfinalized) response', () => {
      const id = generateResponseId('C123', 't456');
      const mockLogger = { warn: jest.fn() };
      shouldFinalize(id, mockLogger);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('works without a logger (no error thrown)', () => {
      const id = generateResponseId('C123', 't456');
      markResponseFinalized(id);
      expect(() => shouldFinalize(id)).not.toThrow();
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

  describe('rollbackFinalization', () => {
    it('removes a previously claimed response ID, allowing a future shouldFinalize to succeed', () => {
      const id = generateResponseId('C123', 't456');
      expect(shouldFinalize(id)).toBe(true); // claims the slot
      rollbackFinalization(id);
      expect(shouldFinalize(id)).toBe(true); // slot released - can claim again
    });

    it('is safe to call on an ID that was never claimed (no-op)', () => {
      const id = generateResponseId('C123', 't456');
      expect(() => rollbackFinalization(id)).not.toThrow();
      expect(isResponseFinalized(id)).toBe(false);
    });

    it('only removes the specified ID, leaving others intact', () => {
      const id1 = generateResponseId('C123', 't456');
      const id2 = generateResponseId('C999', 't789');
      shouldFinalize(id1);
      shouldFinalize(id2);

      rollbackFinalization(id1);

      expect(isResponseFinalized(id1)).toBe(false);
      expect(isResponseFinalized(id2)).toBe(true);
    });
  });

  describe('Duplicate finalization prevention', () => {
    it('prevents duplicate streamer.stop() calls for same response', () => {
      const channel = 'C123';
      const threadTs = 't456';
      const id = generateResponseId(channel, threadTs);

      // First call atomically claims the slot
      expect(shouldFinalize(id)).toBe(true);

      // Second call for same response is rejected (no markResponseFinalized needed)
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

  describe('TTL eviction', () => {
    it('treats an expired entry as not finalized', () => {
      jest.useFakeTimers();
      try {
        const id = generateResponseId('C1', 't1', 'req1');
        markResponseFinalized(id);
        expect(isResponseFinalized(id)).toBe(true);

        jest.advanceTimersByTime(3600001);

        expect(isResponseFinalized(id)).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('shouldFinalize returns true after TTL expiry allowing retry', () => {
      jest.useFakeTimers();
      try {
        const id = generateResponseId('C1', 't1', 'req2');
        expect(shouldFinalize(id)).toBe(true);
        expect(shouldFinalize(id)).toBe(false);

        jest.advanceTimersByTime(3600001);

        expect(shouldFinalize(id)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('getFinalizedResponseCount excludes expired entries', () => {
      jest.useFakeTimers();
      try {
        markResponseFinalized(generateResponseId('C1', 't1'));
        markResponseFinalized(generateResponseId('C2', 't2'));
        expect(getFinalizedResponseCount()).toBe(2);

        jest.advanceTimersByTime(3600001);

        expect(getFinalizedResponseCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('respects a short TTL from env configuration', async () => {
      const priorTtl = process.env.IDEMPOTENT_FINALIZE_TTL_MS;
      jest.useFakeTimers();

      try {
        process.env.IDEMPOTENT_FINALIZE_TTL_MS = '30000';
        jest.resetModules();

        const mod = await import('../../../src/agent/utils/idempotent-finalize.js');
        const id = mod.generateResponseId('C1', 't1', 'req-short');

        mod.markResponseFinalized(id);
        expect(mod.isResponseFinalized(id)).toBe(true);

        jest.advanceTimersByTime(30001);
        expect(mod.isResponseFinalized(id)).toBe(false);
      } finally {
        if (priorTtl === undefined) {
          delete process.env.IDEMPOTENT_FINALIZE_TTL_MS;
        } else {
          process.env.IDEMPOTENT_FINALIZE_TTL_MS = priorTtl;
        }
        jest.useRealTimers();
      }
    });
  });

  describe('sweepExpired', () => {
    it('removes expired entries and preserves live ones', () => {
      jest.useFakeTimers();
      try {
        const id1 = generateResponseId('C1', 't1', 'req1');
        const id2 = generateResponseId('C2', 't2', 'req2');

        markResponseFinalized(id1);
        markResponseFinalized(id2);

        expect(getFinalizedResponseCount()).toBe(2);

        // Advance past TTL expiry (3600000ms = 1 hour + 1ms)
        jest.advanceTimersByTime(3600001);

        // Both should now be expired since they were marked at same time
        expect(isResponseFinalized(id1)).toBe(false);
        expect(isResponseFinalized(id2)).toBe(false);
        expect(getFinalizedResponseCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is idempotent (calling it multiple times is safe)', () => {
      jest.useFakeTimers();
      try {
        const id = generateResponseId('C1', 't1');
        markResponseFinalized(id);

        // Advance past expiry
        jest.advanceTimersByTime(3600001);

        // sweepExpired is called by getFinalizedResponseCount
        // Call getFinalizedResponseCount twice to trigger sweep twice
        const count1 = getFinalizedResponseCount();
        const count2 = getFinalizedResponseCount();

        expect(count1).toBe(0);
        expect(count2).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('startup validation', () => {
    it('throws error when IDEMPOTENT_FINALIZE_TTL_MS is NaN', async () => {
      const priorTtl = process.env.IDEMPOTENT_FINALIZE_TTL_MS;
      try {
        process.env.IDEMPOTENT_FINALIZE_TTL_MS = 'not-a-number';
        jest.resetModules();

        // Dynamic import should throw
        await expect(import('../../../src/agent/utils/idempotent-finalize.js')).rejects.toThrow(
          'Invalid IDEMPOTENT_FINALIZE_TTL_MS'
        );
      } finally {
        if (priorTtl) {
          process.env.IDEMPOTENT_FINALIZE_TTL_MS = priorTtl;
        } else {
          delete process.env.IDEMPOTENT_FINALIZE_TTL_MS;
        }
        jest.resetModules();
      }
    });

    it('throws error when IDEMPOTENT_FINALIZE_TTL_MS is 0', async () => {
      const priorTtl = process.env.IDEMPOTENT_FINALIZE_TTL_MS;
      try {
        process.env.IDEMPOTENT_FINALIZE_TTL_MS = '0';
        jest.resetModules();

        await expect(import('../../../src/agent/utils/idempotent-finalize.js')).rejects.toThrow(
          'Invalid IDEMPOTENT_FINALIZE_TTL_MS'
        );
      } finally {
        if (priorTtl) {
          process.env.IDEMPOTENT_FINALIZE_TTL_MS = priorTtl;
        } else {
          delete process.env.IDEMPOTENT_FINALIZE_TTL_MS;
        }
        jest.resetModules();
      }
    });

    it('throws error when IDEMPOTENT_FINALIZE_TTL_MS is negative', async () => {
      const priorTtl = process.env.IDEMPOTENT_FINALIZE_TTL_MS;
      try {
        process.env.IDEMPOTENT_FINALIZE_TTL_MS = '-1000';
        jest.resetModules();

        await expect(import('../../../src/agent/utils/idempotent-finalize.js')).rejects.toThrow(
          'Invalid IDEMPOTENT_FINALIZE_TTL_MS'
        );
      } finally {
        if (priorTtl) {
          process.env.IDEMPOTENT_FINALIZE_TTL_MS = priorTtl;
        } else {
          delete process.env.IDEMPOTENT_FINALIZE_TTL_MS;
        }
        jest.resetModules();
      }
    });
  });
});
