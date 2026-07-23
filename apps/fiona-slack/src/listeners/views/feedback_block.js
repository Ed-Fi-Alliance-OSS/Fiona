// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * `feedbackBlock` are feedback buttons included with messages.
 *
 * @type {import("@slack/bolt").types.ContextActionsBlock}
 */
export const FEEDBACK_RESPONSE_TYPES = Object.freeze({
  SYNTHESIS: 'synthesis',
  SEARCH: 'search',
  ASK: 'ask',
});

const FEEDBACK_BLOCK_PREFIX = 'feedback';

export function buildFeedbackBlockId(responseType = FEEDBACK_RESPONSE_TYPES.SYNTHESIS, interactionType = null) {
  return `${FEEDBACK_BLOCK_PREFIX}|${responseType}|${interactionType ?? ''}`;
}

export function parseFeedbackBlockId(blockId) {
  if (typeof blockId !== 'string' || !blockId.startsWith(`${FEEDBACK_BLOCK_PREFIX}|`)) {
    return { responseType: FEEDBACK_RESPONSE_TYPES.SYNTHESIS, interactionType: null };
  }

  const [, responseType, interactionType = ''] = blockId.split('|');
  const normalizedResponseType = Object.values(FEEDBACK_RESPONSE_TYPES).includes(responseType)
    ? responseType
    : FEEDBACK_RESPONSE_TYPES.SYNTHESIS;

  return {
    responseType: normalizedResponseType,
    interactionType: interactionType || null,
  };
}

export function createFeedbackBlock({
  responseType = FEEDBACK_RESPONSE_TYPES.SYNTHESIS,
  interactionType = null,
} = {}) {
  return {
    type: 'context_actions',
    block_id: buildFeedbackBlockId(responseType, interactionType),
    elements: [
      {
        type: 'feedback_buttons',
        action_id: 'feedback',
        positive_button: {
          text: { type: 'plain_text', text: 'Good Response' },
          accessibility_label: 'Submit positive feedback on this response',
          value: 'good-feedback',
        },
        negative_button: {
          text: { type: 'plain_text', text: 'Bad Response' },
          accessibility_label: 'Submit negative feedback on this response',
          value: 'bad-feedback',
        },
      },
    ],
  };
};

export const feedbackBlock = createFeedbackBlock();
