// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, describe, expect, it } from '@jest/globals';
import { validateAzureAgentId, validateStartupConfig } from '../../src/agent/startup-validator.js';

describe('validateStartupConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('does not throw when LLM_PROVIDER is not foundry', () => {
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.AZURE_AGENT_ID;
    expect(() => validateStartupConfig()).not.toThrow();
  });

  it('throws when LLM_PROVIDER is foundry and AZURE_AGENT_ID is missing', () => {
    process.env.LLM_PROVIDER = 'foundry';
    delete process.env.AZURE_AGENT_ID;
    expect(() => validateStartupConfig()).toThrow('AZURE_AGENT_ID environment variable is required');
  });

  it('throws when LLM_PROVIDER is foundry and AZURE_AGENT_ID is empty string', () => {
    process.env.LLM_PROVIDER = 'foundry';
    process.env.AZURE_AGENT_ID = '';
    expect(() => validateStartupConfig()).toThrow('AZURE_AGENT_ID environment variable is required');
  });

  it('does not throw when LLM_PROVIDER is foundry and AZURE_AGENT_ID is set', () => {
    process.env.LLM_PROVIDER = 'foundry';
    process.env.AZURE_AGENT_ID = 'my-agent';
    expect(() => validateStartupConfig()).not.toThrow();
  });

  it('requires AZURE_AGENT_ID when provider is inferred from AZURE_PROJECT_ENDPOINT', () => {
    delete process.env.LLM_PROVIDER;
    process.env.AZURE_PROJECT_ENDPOINT = 'https://example.services.ai.azure.com';
    delete process.env.AZURE_AGENT_ID;
    expect(() => validateStartupConfig()).toThrow('AZURE_AGENT_ID environment variable is required');
  });

  it('does not require AZURE_AGENT_ID when provider is not foundry and endpoint is unset', () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.AZURE_PROJECT_ENDPOINT;
    delete process.env.AZURE_AGENT_ID;
    expect(() => validateStartupConfig()).not.toThrow();
  });

  describe('validateAzureAgentId', () => {
    it('accepts valid values', () => {
      const valid = ['agent', 'agent_name-1', 'agent:1', 'agent:1.0', 'agent:1.0.0'];
      for (const id of valid) {
        expect(validateAzureAgentId(id)).toBe(id);
      }
    });

    it('rejects missing or whitespace-only values', () => {
      expect(() => validateAzureAgentId(undefined)).toThrow('AZURE_AGENT_ID environment variable is required');
      expect(() => validateAzureAgentId('')).toThrow('AZURE_AGENT_ID environment variable is required');
      expect(() => validateAzureAgentId('   ')).toThrow('AZURE_AGENT_ID environment variable is required');
    });

    it('rejects invalid characters in agent name', () => {
      expect(() => validateAzureAgentId('agent name')).toThrow('AZURE_AGENT_ID name must contain only');
      expect(() => validateAzureAgentId('agent!')).toThrow('AZURE_AGENT_ID name must contain only');
      expect(() => validateAzureAgentId(':1.0.0')).toThrow('AZURE_AGENT_ID name must contain only');
    });

    it('rejects malformed version segments', () => {
      expect(() => validateAzureAgentId('agent:')).toThrow('AZURE_AGENT_ID version must be numeric or semver-like');
      expect(() => validateAzureAgentId('agent:1.0.0.1')).toThrow(
        'AZURE_AGENT_ID version must be numeric or semver-like',
      );
      expect(() => validateAzureAgentId('agent:v1')).toThrow('AZURE_AGENT_ID version must be numeric or semver-like');
    });

    it('rejects values with more than one colon', () => {
      expect(() => validateAzureAgentId('agent:1:extra')).toThrow('AZURE_AGENT_ID must be in the form');
    });
  });
});
