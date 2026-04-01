// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, afterEach } from '@jest/globals';
import { validateStartupConfig } from '../../src/agent/startup-validator.js';

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
    expect(() => validateStartupConfig()).toThrow(
      'AZURE_AGENT_ID environment variable is required when LLM_PROVIDER=foundry',
    );
  });

  it('throws when LLM_PROVIDER is foundry and AZURE_AGENT_ID is empty string', () => {
    process.env.LLM_PROVIDER = 'foundry';
    process.env.AZURE_AGENT_ID = '';
    expect(() => validateStartupConfig()).toThrow(
      'AZURE_AGENT_ID environment variable is required when LLM_PROVIDER=foundry',
    );
  });

  it('does not throw when LLM_PROVIDER is foundry and AZURE_AGENT_ID is set', () => {
    process.env.LLM_PROVIDER = 'foundry';
    process.env.AZURE_AGENT_ID = 'my-agent';
    expect(() => validateStartupConfig()).not.toThrow();
  });
});
