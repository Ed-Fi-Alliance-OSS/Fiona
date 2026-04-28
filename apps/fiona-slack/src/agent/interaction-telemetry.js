// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { recordInteraction } from './interaction-store.js';
import {
  handleMetadataTimeout,
  MetadataLifecycleState,
  TOOL_CALL_DEPTH_EXCEEDED_CODE,
  TOOL_CALL_DEPTH_EXCEEDED_MESSAGE,
} from './llm-caller.js';
import { rollbackFinalization } from './utils/idempotent-finalize.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for metadata to reach a finalization-ready state with timeout.
 *
 * @param {Object} metadata - Metadata envelope
 * @param {number} [timeoutMs=2000] - Max wait time
 * @returns {Promise<void>}
 */
export async function waitForMetadataReady(metadata, timeoutMs = 2000) {
  if (!metadata) return;

  const startTime = Date.now();
  const readyStates = [
    MetadataLifecycleState.READY_TO_FINALIZE,
    MetadataLifecycleState.DEGRADED_NO_METADATA,
    MetadataLifecycleState.FINALIZED,
  ];

  while (true) {
    if (readyStates.includes(metadata.finalize_state)) {
      return;
    }

    if (Date.now() - startTime > timeoutMs) {
      // On timeout, transition via state machine to preserve strict consistency.
      handleMetadataTimeout(metadata);
      return;
    }

    await sleep(50);
  }
}

/**
 * Wraps a Slack interaction handler callback with error classification,
 * interaction recording, and finalization rollback.
 *
 * The `fn` callback receives a context object with three helpers:
 * - `claimResponseId(id)` — call when a finalization slot is claimed so the catch
 *   block can roll it back on failure.
 * - `markRateLimited()` — call before recording a rate-limit interaction so the
 *   finally block records `rateLimited: true`.
 * - `markInteractionRecorded()` — call after recording early (e.g. rate-limit path)
 *   so the finally block does not double-record.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.teamId
 * @param {string} params.channelId
 * @param {string} params.threadTs
 * @param {string} params.messageTs
 * @param {string} params.interactionType
 * @param {Object} params.logger
 * @param {Function} params.say
 * @param {Function} fn - Async handler body.
 */
export async function handleInteractionWithTelemetry(
  { userId, teamId, channelId, threadTs, messageTs, interactionType, logger, say },
  fn,
) {
  let responseId = null;
  let status = 'success';
  let errorType = null;
  let isRateLimited = false;
  let interactionRecorded = false;

  try {
    await fn({
      claimResponseId: (id) => {
        responseId = id;
      },
      markInteractionRecorded: () => {
        interactionRecorded = true;
      },
      markRateLimited: () => {
        isRateLimited = true;
      },
    });
  } catch (e) {
    // Roll back the claimed finalization slot so a future delivery attempt can retry.
    if (responseId) rollbackFinalization(responseId);

    status = 'error';

    if (e.code === 'COSMOS_ERROR') {
      errorType = 'cosmos_error';
    } else if (e.name === 'TimeoutError') {
      errorType = 'timeout';
    } else if (e.code?.includes('429') || e.message?.includes('rate_limit')) {
      errorType = 'llm_rate_limited';
    } else if (e.code?.includes('openai') || e.name?.includes('APIError')) {
      errorType = 'llm_error';
    } else if (e.code === TOOL_CALL_DEPTH_EXCEEDED_CODE) {
      errorType = 'max_tool_call_depth_exceeded';
    } else {
      errorType = 'unknown';
    }

    logger.error('Failed to handle a user message event:', e);
    const userErrorMessage =
      e.code === TOOL_CALL_DEPTH_EXCEEDED_CODE
        ? `:warning: ${TOOL_CALL_DEPTH_EXCEEDED_MESSAGE}`
        : ':warning: Something went wrong! Please try again later.';
    await say(userErrorMessage).catch(() => {
      logger.warn?.('Failed to send error message to Slack');
    });
  } finally {
    if (!interactionRecorded) {
      try {
        await recordInteraction({
          userId,
          teamId,
          channelId,
          threadTs,
          messageTs,
          interactionType,
          status,
          errorType: status === 'error' ? errorType : null,
          rateLimited: isRateLimited,
          logger,
        });
      } catch (cosmosError) {
        logger.warn?.(`Failed to record interaction: ${cosmosError.message}`);
      }
    }
  }
}
