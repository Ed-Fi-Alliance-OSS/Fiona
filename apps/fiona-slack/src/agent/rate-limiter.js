const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);
const CLEANUP_INTERVAL = 100;

/** @type {Map<string, number[]>} */
const userTimestamps = new Map();
let requestCount = 0;

/**
 * Return the current number of users tracked in the rate limiter Map.
 * Useful for monitoring memory usage and for tests.
 *
 * @returns {number}
 */
export function getMapSize() {
  return userTimestamps.size;
}

/**
 * Remove Map entries whose timestamps have all expired outside the current window.
 * Called automatically every CLEANUP_INTERVAL requests. Safe to call manually for
 * testing or on-demand monitoring.
 */
export function cleanupExpiredEntries() {
  const windowStart = Date.now() - WINDOW_MS;
  for (const [userId, timestamps] of userTimestamps.entries()) {
    if (!timestamps.some((t) => t > windowStart)) {
      userTimestamps.delete(userId);
    }
  }
}

/**
 * Check whether a user is within their rate limit.
 *
 * @param {string} userId - Slack user ID
 * @returns {{ allowed: boolean, retryAfterMs: number }}
 */
export function checkRateLimit(userId) {
  if (MAX_REQUESTS === 0) {
    return { allowed: true, retryAfterMs: 0 };
  }

  // Periodically remove stale entries to prevent unbounded Map growth.
  requestCount++;
  if (requestCount % CLEANUP_INTERVAL === 0) {
    cleanupExpiredEntries();
  }

  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const timestamps = (userTimestamps.get(userId) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= MAX_REQUESTS) {
    const retryAfterMs = timestamps[0] - windowStart;
    userTimestamps.set(userId, timestamps);
    return { allowed: false, retryAfterMs };
  }

  timestamps.push(now);
  userTimestamps.set(userId, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}
