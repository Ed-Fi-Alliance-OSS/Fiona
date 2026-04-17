// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);

if (Number.isNaN(MAX_REQUESTS) || MAX_REQUESTS < 0) {
  throw new Error(`RATE_LIMIT_MAX_REQUESTS must be a non-negative number, got: ${process.env.RATE_LIMIT_MAX_REQUESTS}`);
}
if (MAX_REQUESTS > 0 && (Number.isNaN(WINDOW_MS) || WINDOW_MS <= 0)) {
  throw new Error(`RATE_LIMIT_WINDOW_MS must be a positive number, got: ${process.env.RATE_LIMIT_WINDOW_MS}`);
}

/** @type {Map<string, number[]>} */
const userTimestamps = new Map();

/**
 * Removes all Map entries whose timestamps have all fallen outside the current
 * window. Called both by the periodic sweep timer and exposed via __testing so
 * unit tests can trigger it synchronously.
 */
function sweepExpiredEntries() {
  const windowStart = Date.now() - WINDOW_MS;
  for (const [userId, timestamps] of userTimestamps) {
    // Invariant: timestamps remain ordered oldest -> newest because filter()
    // preserves order and checkRateLimit() only appends via push(now).
    const newestTimestamp = timestamps[timestamps.length - 1];
    if (timestamps.length === 0 || newestTimestamp <= windowStart) {
      userTimestamps.delete(userId);
    }
  }
}

// Periodically remove entries for users who never call checkRateLimit again.
// Only active when rate limiting is enabled (MAX_REQUESTS === 0 means disabled).
// unref() lets Node.js exit even if this timer is still pending.
const sweepTimer = MAX_REQUESTS > 0 ? setInterval(sweepExpiredEntries, WINDOW_MS) : null;
if (sweepTimer?.unref) sweepTimer.unref();

/**
 * Returns the number of user entries currently in the rate-limit Map.
 * Internal helper, exposed only via the __testing object for test inspection.
 * @returns {number}
 */
function getUserTimestampsSize() {
  return userTimestamps.size;
}

export const __testing = { getUserTimestampsSize, sweepExpiredEntries };

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
    userTimestamps.set(userId, timestamps);
    const retryAfterMs = timestamps[0] - windowStart;
    return { allowed: false, retryAfterMs };
  }

  timestamps.push(now);
  userTimestamps.set(userId, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}
