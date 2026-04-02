// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '20', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);

/** @type {Map<string, number[]>} */
const userTimestamps = new Map();

/**
 * Returns the number of user entries currently in the rate-limit Map.
 * Internal helper, exposed only via the __testing object for test inspection.
 * @returns {number}
 */
function getUserTimestampsSize() {
  return userTimestamps.size;
}

export const __testing = { getUserTimestampsSize };
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

  // Clean up: remove Map entry entirely when no valid timestamps remain
  if (timestamps.length === 0) {
    userTimestamps.delete(userId);
  }

  if (timestamps.length >= MAX_REQUESTS) {
    if (timestamps.length > 0) userTimestamps.set(userId, timestamps);
    const retryAfterMs = timestamps[0] - windowStart;
    return { allowed: false, retryAfterMs };
  }

  timestamps.push(now);
  userTimestamps.set(userId, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}
