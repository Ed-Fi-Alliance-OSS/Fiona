// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Lifecycle states for strict consistency citation finalization.
 * @enum {string}
 */
export const MetadataLifecycleState = {
  STREAMING_TEXT: 'streaming_text', // Initial state: processing input, streaming text
  COLLECTING_METADATA: 'collecting_metadata', // Waiting for citation metadata from tools
  READY_TO_FINALIZE: 'ready_to_finalize', // Metadata resolved and ready
  FINALIZED: 'finalized', // Message finalized with citations
  DEGRADED_NO_METADATA: 'degraded_no_metadata', // Timeout/error: finalize without metadata
};
