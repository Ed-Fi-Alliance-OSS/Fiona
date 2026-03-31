/**
 * Idempotent finalization tracking for preventing duplicate citation blocks.
 * Ensures that streaming completions do not result in duplicate Sources blocks
 * on retries or reconnections.
 */

// In-memory tracking of finalized response IDs (thread_ts + channel + request_ts)
// In a production system, this would be backed by persistent storage (Redis, DB)
const finalizedResponses = new Set();

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
 * Check if a response has already been finalized.
 *
 * @param {string} responseId - Response ID
 * @returns {boolean} True if already finalized
 */
export function isResponseFinalized(responseId) {
  return finalizedResponses.has(responseId);
}

/**
 * Mark a response as finalized.
 * Should be called after `streamer.stop()` completes.
 *
 * @param {string} responseId - Response ID
 */
export function markResponseFinalized(responseId) {
  finalizedResponses.add(responseId);
}

/**
 * Atomically claim the finalization slot for a response.
 * Returns `true` and immediately marks the response as in-progress on the first call,
 * preventing any concurrent handler from claiming the same slot.
 * Returns `false` (and logs a warning) if another handler has already claimed this response.
 *
 * Because Node.js is single-threaded, the Set check + Set add are executed atomically
 * within the current microtask, eliminating the race window that existed when the guard
 * and the mark were separate operations.
 *
 * @param {string} responseId - Response ID
 * @param {import("@slack/logger").Logger} [logger] - Optional logger for warning on duplicate finalization
 * @returns {boolean} True if this handler should proceed with finalization
 */
export function shouldFinalize(responseId, logger) {
  if (finalizedResponses.has(responseId)) {
    logger?.warn(`Response ${responseId} already finalized, skipping duplicate finalization`);
    return false;
  }
  // Atomically claim the slot before any async work begins
  finalizedResponses.add(responseId);
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
 * Get count of tracked finalized responses (for monitoring).
 *
 * @returns {number} Count of finalized responses
 */
export function getFinalizedResponseCount() {
  return finalizedResponses.size;
}
