// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreate = jest.fn();
jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

delete process.env.PERPLEXITY_API_KEY;
const { summarizeForEscalation } = await import('../../src/agent/llm-caller.js');

describe('summarizeForEscalation (no client)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when no LLM client is configured, without calling the LLM', async () => {
    const result = await summarizeForEscalation('*<@U1>:* hello');
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
