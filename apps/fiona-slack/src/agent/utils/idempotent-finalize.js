/**
 * Idempotent finalization tracking for preventing duplicate citation blocks.
 * Ensures that streaming completions do not result in duplicate Sources blocks
 * on retries or reconnections.
 */

// In-memory tracking of finalized response IDs (thread_ts + channel)
// In a production system, this would be backed by persistent storage (Redis, DB)
const finalizedResponses = new Set();

/**
 * Generate a unique response identifier for idempotency.
 *
 * @param {string} channel - Slack channel ID
 * @param {string} threadTs - Thread timestamp (or message timestamp)
 * @returns {string} Unique response ID
 */
export function generateResponseId(channel, threadTs) {
  return `${channel}:${threadTs}`;
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
 * Guard function to prevent duplicate finalization.
 * Returns true if finalization should proceed, false if already finalized.
 *
 * @param {string} responseId - Response ID
 * @returns {boolean} True if safe to finalize
 */
export function shouldFinalize(responseId) {
  if (isResponseFinalized(responseId)) {
    console.warn(`Response ${responseId} already finalized, skipping duplicate finalization`);
    return false;
  }
  return true;
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
