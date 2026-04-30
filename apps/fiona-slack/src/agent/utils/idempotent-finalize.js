// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Idempotent finalization tracking for preventing duplicate citation blocks.
 * Ensures that streaming completions do not result in duplicate Sources blocks
 * on retries or reconnections.
 *
 * Uses a TTL-evicting Map (keyed by response ID, value is expiry timestamp)
 * so entries are automatically removed after IDEMPOTENT_FINALIZE_TTL_MS
 * (default: 1 hour). A periodic sweep timer purges stale entries, preventing
 * unbounded memory growth in long-running processes.
 */

const rawTtl = process.env.IDEMPOTENT_FINALIZE_TTL_MS ?? '3600000';
const TTL_MS = Number.parseInt(rawTtl, 10);

if (!Number.isFinite(TTL_MS) || TTL_MS <= 0) {
  throw new Error(`Invalid IDEMPOTENT_FINALIZE_TTL_MS: "${rawTtl}". Expected a positive integer (ms).`);
}

// Sweep at 10% of TTL, at least 1s, at most 10m, and never slower than TTL.
const SWEEP_INTERVAL_MS = Math.min(Math.max(Math.floor(TTL_MS * 0.1), 1_000), 600_000, TTL_MS);

/**
 * Map<responseId, expiresAt> — value is the absolute expiry timestamp (ms since epoch).
 *
 * @type {Map<string, number>}
 */
const finalizedResponses = new Map();

/**
 * Remove all entries whose expiry timestamp is in the past.
 * Called automatically by the sweep timer; also exported for testing convenience.
 */
export function sweepExpired() {
  const now = Date.now();
  for (const [id, expiresAt] of finalizedResponses) {
    if (now >= expiresAt) {
      finalizedResponses.delete(id);
    }
  }
}

// Periodic background sweep — uses unref() so the timer does not prevent process exit.
const _sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
if (typeof _sweepTimer.unref === 'function') {
  _sweepTimer.unref();
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Return true if the entry exists AND has not yet expired.
 *
 * @param {string} responseId
 * @returns {boolean}
 */
function _isLive(responseId) {
  const expiresAt = finalizedResponses.get(responseId);
  if (expiresAt === undefined) return false;
  if (Date.now() >= expiresAt) {
    // Lazy eviction on read
    finalizedResponses.delete(responseId);
    return false;
  }
  return true;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a unique response identifier for idempotency.
 *
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread timestamp (or message timestamp)
 * @param {string} [requestTs] - Unique inbound request/message timestamp
 * @returns {string} Unique response ID
 */
export function generateResponseId(channel, threadTs, requestTs) {
  const uniqueRequestToken = requestTs || threadTs;
  return `${channel}:${threadTs}:${uniqueRequestToken}`;
}

/**
 * Check if a response has already been finalized (and has not yet expired).
 *
 * @param {string} responseId - Response ID
 * @returns {boolean} True if already finalized and within TTL
 */
export function isResponseFinalized(responseId) {
  return _isLive(responseId);
}

/**
 * Mark a response as finalized with a TTL expiry.
 * Should be called after `streamer.stop()` completes.
 *
 * NOTE: Calling this multiple times on the same responseId will reset the TTL
 * to a new expiry (now + TTL_MS). This is intentional — finalization timestamps
 * are updated on each attempt, allowing the entry to stay live across retries.
 *
 * @param {string} responseId - Response ID
 */
export function markResponseFinalized(responseId) {
  finalizedResponses.set(responseId, Date.now() + TTL_MS);
}

/**
 * Atomically claim the finalization slot for a response.
 * Returns `true` and immediately marks the response as in-progress on the first call,
 * preventing any concurrent handler from claiming the same slot.
 * Returns `false` (and logs a warning) if another handler has already claimed this response.
 *
 * Because Node.js is single-threaded, the Map check + Map set are executed atomically
 * within the current microtask, eliminating the race window that existed when the guard
 * and the mark were separate operations.
 *
 * @param {string} responseId - Response ID
 * @param {import("@slack/logger").Logger} [logger] - Optional logger for warning on duplicate finalization
 * @returns {boolean} True if this handler should proceed with finalization
 */
export function shouldFinalize(responseId, logger) {
  if (_isLive(responseId)) {
    logger?.warn(`Response ${responseId} already finalized, skipping duplicate finalization`);
    return false;
  }
  // Atomically claim the slot before any async work begins
  finalizedResponses.set(responseId, Date.now() + TTL_MS);
  return true;
}

/**
 * Roll back a previously claimed finalization slot, allowing a future delivery
 * attempt to retry. Should be called in error-handling paths after `shouldFinalize`
 * returned `true` but the subsequent operation (e.g. `streamer.stop()`) failed.
 *
 * @param {string} responseId - Response ID to release
 */
export function rollbackFinalization(responseId) {
  finalizedResponses.delete(responseId);
}

/**
 * Clear finalized responses (for testing or periodic cleanup).
 * Use with caution in production.
 */
export function clearFinalizedResponses() {
  finalizedResponses.clear();
}

/**
 * Get count of tracked live (non-expired) finalized responses (for monitoring).
 *
 * @returns {number} Count of non-expired finalized responses
 */
export function getFinalizedResponseCount() {
  sweepExpired();
  return finalizedResponses.size;
}
