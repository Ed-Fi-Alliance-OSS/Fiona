// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// The action_id the feedback buttons dispatch under. Declared here, with the block
// that owns it, and imported by the listener registration — the two must match
// exactly or the buttons silently stop being handled.
export const FEEDBACK_ACTION = 'feedback';

/**
 * `feedbackBlock` are feedback buttons included with messages.
 *
 * @type {import("@slack/bolt").types.ContextActionsBlock}
 */
export const feedbackBlock = {
  type: 'context_actions',
  elements: [
    {
      type: 'feedback_buttons',
      action_id: FEEDBACK_ACTION,
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
