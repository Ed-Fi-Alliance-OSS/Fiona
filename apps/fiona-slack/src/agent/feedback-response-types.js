// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

export const FEEDBACK_RESPONSE_TYPES = Object.freeze({
  SYNTHESIS: 'synthesis',
  SEARCH: 'search',
  ASK: 'ask',
});

/**
 * Response types whose context is stored in the feedback modal's
 * private_metadata when the button is clicked. Their messages are ephemeral on
 * at least one surface and cannot be fetched back later. A synthesis answer
 * always lives in a thread, so it is read back instead.
 */
export const STORED_CONTEXT_TYPES = Object.freeze(
  new Set([FEEDBACK_RESPONSE_TYPES.SEARCH, FEEDBACK_RESPONSE_TYPES.ASK]),
);
