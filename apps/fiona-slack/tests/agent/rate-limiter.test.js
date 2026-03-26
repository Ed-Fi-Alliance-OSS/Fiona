// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { checkRateLimit } from '../../src/agent/rate-limiter.js';

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
});
