// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreate = jest.fn();
jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
    search: { create: jest.fn() },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';
const { summarizeForEscalation } = await import('../../src/agent/llm-caller.js');

describe('summarizeForEscalation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the trimmed model summary on success', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '  User wants SIS help.  ' } }] });
    const result = await summarizeForEscalation('*<@U1>:* help with SIS');
    expect(result).toBe('User wants SIS help.');
  });

  it('returns null for empty transcript without calling the LLM', async () => {
    const result = await summarizeForEscalation('   ');
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null and warns when the LLM call throws', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const logger = { warn: jest.fn() };
    const result = await summarizeForEscalation('*<@U1>:* hi', logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('escalation summary'));
  });
});
