// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest } from '@jest/globals';
import { checkRateLimit, __testing } from '../../src/agent/rate-limiter.js';

const { getUserTimestampsSize, sweepExpiredEntries } = __testing;

// Use a counter + timestamp to guarantee unique user IDs across all tests,
// preventing the module-level Map from leaking state between test cases.
let counter = 0;
const uniqueUserId = () => `test-user-${++counter}-${Date.now()}`;

describe('checkRateLimit', () => {
  it('allows a request for a new user', () => {
    const result = checkRateLimit(uniqueUserId());
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('allows multiple requests within the default limit', () => {
    const userId = uniqueUserId();
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(userId);
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    }
  });

  it('blocks a user who has exhausted the rate limit', () => {
    const userId = uniqueUserId();
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10);

    for (let i = 0; i < maxRequests; i++) {
      const r = checkRateLimit(userId);
      expect(r.allowed).toBe(true);
    }

    const result = checkRateLimit(userId);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('provides retryAfterMs within the rate limit window', () => {
    const userId = uniqueUserId();
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10);
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);

    for (let i = 0; i < maxRequests; i++) {
      checkRateLimit(userId);
    }

    const result = checkRateLimit(userId);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(windowMs);
  });

  it('tracks each user independently', () => {
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10);
    const userId1 = uniqueUserId();
    const userId2 = uniqueUserId();

    // Fill user1's bucket to the limit
    for (let i = 0; i < maxRequests; i++) {
      checkRateLimit(userId1);
    }

    // user1 is now blocked
    expect(checkRateLimit(userId1).allowed).toBe(false);

    // user2 has a fresh bucket and should still be allowed
    expect(checkRateLimit(userId2).allowed).toBe(true);
  });

  it('getUserTimestampsSize returns a number', () => {
    expect(typeof getUserTimestampsSize()).toBe('number');
  });

  it('Map entry is added after a request', () => {
    const userId = uniqueUserId();
    const sizeBefore = getUserTimestampsSize();
    checkRateLimit(userId);
    expect(getUserTimestampsSize()).toBe(sizeBefore + 1);
  });

  it('sweepExpiredEntries removes entries whose timestamps have all expired', () => {
    const userId = uniqueUserId();
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);

    // Set fake time to epoch 0 so this entry's timestamp is far enough in the
    // past that only it gets swept, while real-clock entries from other tests
    // (timestamped ~2024) remain untouched.
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));

    try {
      checkRateLimit(userId); // entry stored at timestamp 0
      const sizeBefore = getUserTimestampsSize();

      // Still within the window – sweep should keep the entry
      sweepExpiredEntries();
      expect(getUserTimestampsSize()).toBe(sizeBefore);

      // Advance past the window – sweep should remove the entry
      jest.setSystemTime(new Date(windowMs + 1));
      sweepExpiredEntries();
      expect(getUserTimestampsSize()).toBe(sizeBefore - 1);
    } finally {
      jest.useRealTimers();
    }
  });
});
