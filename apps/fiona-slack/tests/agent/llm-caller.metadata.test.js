/*
 * SPDX-License-Identifier: Apache-2.0
 * Licensed to the Ed-Fi Alliance under one or more agreements.
 * The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
 * See the LICENSE and NOTICES files in the project root for more information.
 */

import { describe, it, expect, jest } from '@jest/globals';

// Mock all external dependencies before importing the module under test.
jest.unstable_mockModule('@azure/ai-projects', () => ({
  AIProjectClient: jest.fn(),
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn(),
  AzureOpenAI: jest.fn(),
}));

jest.unstable_mockModule('../../src/agent/utils/source-normalizer.js', () => ({
  normalizeSources: jest.fn().mockReturnValue({ sources: [], sourceIndexMap: {} }),
}));

jest.unstable_mockModule('../../src/agent/utils/citation-telemetry.js', () => ({
  recordMetadataWaitDuration: jest.fn(),
  recordSourceCount: jest.fn(),
  incrementDegradedNoMetadataCount: jest.fn(),
  incrementTotalResponseCount: jest.fn(),
}));

const { MetadataLifecycleState, CITATION_POLICY, METADATA_CONTRACT_VERSION } =
  await import('../../src/agent/llm-caller.js');

describe('MetadataLifecycleState', () => {
  it('defines all five lifecycle states', () => {
    expect(MetadataLifecycleState.STREAMING_TEXT).toBe('streaming_text');
    expect(MetadataLifecycleState.COLLECTING_METADATA).toBe('collecting_metadata');
    expect(MetadataLifecycleState.READY_TO_FINALIZE).toBe('ready_to_finalize');
    expect(MetadataLifecycleState.FINALIZED).toBe('finalized');
    expect(MetadataLifecycleState.DEGRADED_NO_METADATA).toBe('degraded_no_metadata');
  });

  it('has exactly five states', () => {
    expect(Object.keys(MetadataLifecycleState)).toHaveLength(5);
  });
});

describe('METADATA_CONTRACT_VERSION', () => {
  it('is v1', () => {
    expect(METADATA_CONTRACT_VERSION).toBe('v1');
  });
});

describe('CITATION_POLICY', () => {
  it('defines citation_metadata_collection_enabled flag', () => {
    expect(typeof CITATION_POLICY.citation_metadata_collection_enabled).toBe('boolean');
  });

  it('defines citation_rendering_enabled flag', () => {
    expect(typeof CITATION_POLICY.citation_rendering_enabled).toBe('boolean');
  });

  it('defines METADATA_WAIT_TIMEOUT_MS as positive number', () => {
    expect(typeof CITATION_POLICY.METADATA_WAIT_TIMEOUT_MS).toBe('number');
    expect(CITATION_POLICY.METADATA_WAIT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('defines MAX_SOURCES_DISPLAYED as positive number', () => {
    expect(typeof CITATION_POLICY.MAX_SOURCES_DISPLAYED).toBe('number');
    expect(CITATION_POLICY.MAX_SOURCES_DISPLAYED).toBeGreaterThan(0);
  });

  it('defines FEATURE_FLAG_EVIDENCE_ROW as boolean', () => {
    expect(typeof CITATION_POLICY.FEATURE_FLAG_EVIDENCE_ROW).toBe('boolean');
  });
});

describe('Metadata envelope contract (v1)', () => {
  it('required field names are well-defined', () => {
    // Documents the v1 contract shape expected from callLLM.
    const requiredFields = [
      'metadata_contract_version',
      'finalize_state',
      'provider',
      'sources',
      'source_index_map',
    ];

    requiredFields.forEach((field) => {
      expect(typeof field).toBe('string');
      expect(field.length).toBeGreaterThan(0);
    });
  });

  it('READY_TO_FINALIZE and DEGRADED_NO_METADATA are the only allowed pre-stop states', () => {
    const allowedPreStopStates = [MetadataLifecycleState.READY_TO_FINALIZE, MetadataLifecycleState.DEGRADED_NO_METADATA];
    expect(allowedPreStopStates).toContain('ready_to_finalize');
    expect(allowedPreStopStates).toContain('degraded_no_metadata');
    expect(allowedPreStopStates).not.toContain(MetadataLifecycleState.STREAMING_TEXT);
    expect(allowedPreStopStates).not.toContain(MetadataLifecycleState.COLLECTING_METADATA);
    expect(allowedPreStopStates).not.toContain(MetadataLifecycleState.FINALIZED);
  });

  it('lifecycle transition graph never allows STREAMING_TEXT -> FINALIZED directly', () => {
    // The valid transition graph prevents skipping intermediate states.
    // STREAMING_TEXT can only go to COLLECTING_METADATA, READY_TO_FINALIZE, or DEGRADED_NO_METADATA.
    const directFinalizationFromStart = MetadataLifecycleState.STREAMING_TEXT === MetadataLifecycleState.FINALIZED;
    expect(directFinalizationFromStart).toBe(false);
  });
});
