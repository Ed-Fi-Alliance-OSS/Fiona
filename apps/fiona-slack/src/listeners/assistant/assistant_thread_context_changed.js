// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * The `assistant_thread_context_changed` event is sent when a user switches
 * channels while the Assistant container is open. If `threadContextChanged` is
 * not provided, context will be saved using the AssistantContextStore's `save`
 * method (either the DefaultAssistantContextStore or custom, if provided).
 *
 * @param {Object} params
 * @param {import("@slack/bolt").Logger} params.logger - Logger instance.
 * @param {Function} params.saveThreadContext - Function to save thread context.
 *
 * @see {@link https://docs.slack.dev/reference/events/assistant_thread_context_changed}
 */
export const assistantThreadContextChanged = async ({ logger, saveThreadContext }) => {
  // const { channel_id, thread_ts, context: assistantContext } = event.assistant_thread;
  try {
    await saveThreadContext();
  } catch (e) {
    logger.error(e);
  }
};
