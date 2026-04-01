// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, beforeAll } from '@jest/globals';

describe('callOpenAICompatible recursion depth', () => {
  let MAX_RECURSION_DEPTH;

  beforeAll(async () => {
    // Set dummy env vars so llm-caller.js module-level client init doesn't throw
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
    process.env.AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || 'test-key';
    ({ MAX_RECURSION_DEPTH } = await import('../../src/agent/llm-caller.js'));
  });

  it('exports MAX_RECURSION_DEPTH as a positive number no greater than 20', () => {
    expect(typeof MAX_RECURSION_DEPTH).toBe('number');
    expect(MAX_RECURSION_DEPTH).toBeGreaterThan(0);
    expect(MAX_RECURSION_DEPTH).toBeLessThanOrEqual(20);
  });
});
