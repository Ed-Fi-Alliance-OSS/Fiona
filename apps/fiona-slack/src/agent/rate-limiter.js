const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);

/** @type {Map<string, number[]>} */
const userTimestamps = new Map();

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

/**
 * Purge all entries whose timestamps have entirely expired from the rate limiter map.
 * This prevents unbounded memory growth in long-running deployments where many unique
 * users have made requests but are no longer active.
 */
export function purgeExpiredEntries() {
  const windowStart = Date.now() - WINDOW_MS;
  for (const [userId, timestamps] of userTimestamps) {
    if (!timestamps.some((t) => t > windowStart)) {
      userTimestamps.delete(userId);
    }
  }
}

// Periodically purge expired entries to prevent the map from growing indefinitely.
// The interval is intentionally unref'd so it does not keep the process alive.
const _cleanupInterval = setInterval(purgeExpiredEntries, WINDOW_MS);
if (typeof _cleanupInterval.unref === 'function') {
  _cleanupInterval.unref();
}
