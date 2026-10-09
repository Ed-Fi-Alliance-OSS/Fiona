// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest } from '@jest/globals';

/** Mirrors `MetadataLifecycleState` in src/agent/llm-caller.js. */
export const METADATA_LIFECYCLE_STATE = {
  STREAMING_TEXT: 'streaming_text',
  COLLECTING_METADATA: 'collecting_metadata',
  READY_TO_FINALIZE: 'ready_to_finalize',
  FINALIZED: 'finalized',
  DEGRADED_NO_METADATA: 'degraded_no_metadata',
};

/**
 * A `finalizeMetadataEnvelope` stand-in that changes state the way the real one
 * does. A bare `jest.fn()` leaves the envelope READY_TO_FINALIZE, so a Sources
 * block built after finalizing would still render and the ordering bug it is
 * meant to catch would pass unnoticed.
 */
export function createFinalizeMetadataEnvelopeMock() {
  return jest.fn((metadata) => {
    const settles = [METADATA_LIFECYCLE_STATE.READY_TO_FINALIZE, METADATA_LIFECYCLE_STATE.DEGRADED_NO_METADATA];
    if (metadata && settles.includes(metadata.finalize_state)) {
      metadata.finalize_state = METADATA_LIFECYCLE_STATE.FINALIZED;
    }
  });
}
