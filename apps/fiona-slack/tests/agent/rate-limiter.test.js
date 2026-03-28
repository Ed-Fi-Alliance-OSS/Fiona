import { describe, it, expect, jest } from '@jest/globals';
import { checkRateLimit, getMapSize, cleanupExpiredEntries } from '../../src/agent/rate-limiter.js';

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

describe('memory leak prevention', () => {
  it('getMapSize reflects the number of tracked users', () => {
    const before = getMapSize();
    checkRateLimit(uniqueUserId());
    expect(getMapSize()).toBe(before + 1);
  });

  it('cleanupExpiredEntries removes entries whose timestamps have all expired', () => {
    // Add a fresh entry so we know exactly one was added
    const userId = uniqueUserId();
    checkRateLimit(userId);
    const sizeAfterAdd = getMapSize();

    // Advance time far past the window so all current entries expire
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + windowMs + 1000);
    cleanupExpiredEntries();
    dateSpy.mockRestore();

    // All entries expired — map should now be empty
    expect(getMapSize()).toBe(0);
    expect(getMapSize()).toBeLessThan(sizeAfterAdd);
  });

  it('cleanupExpiredEntries does not remove entries with active timestamps', () => {
    const userId = uniqueUserId();
    checkRateLimit(userId);
    const sizeBefore = getMapSize();

    // Call cleanup without advancing time — entry is still fresh
    cleanupExpiredEntries();

    expect(getMapSize()).toBe(sizeBefore);
  });

  it('rate limiting still works correctly after expired entries are cleaned up', () => {
    const userId = uniqueUserId();
    checkRateLimit(userId); // creates entry

    // Expire all entries
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + windowMs + 1000);
    cleanupExpiredEntries();
    dateSpy.mockRestore();

    // User's entry was removed — they should get a fresh allow
    const result = checkRateLimit(userId);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });
});
