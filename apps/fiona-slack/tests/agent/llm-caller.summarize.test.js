// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreate = jest.fn();
jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: { create: mockCreate },
    search: { create: jest.fn() },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';
const { summarizeForEscalation } = await import('../../src/agent/llm-caller.js');

describe('summarizeForEscalation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the trimmed model summary from output_text on success', async () => {
    mockCreate.mockResolvedValue({ status: 'completed', output_text: '  User wants SIS help.  ' });
    const result = await summarizeForEscalation('*<@U1>:* help with SIS');
    expect(result).toBe('User wants SIS help.');
  });

  it('sends Agent API fields with no web_search tool', async () => {
    mockCreate.mockResolvedValue({ status: 'completed', output_text: 'summary' });
    await summarizeForEscalation('*<@U1>:* help with SIS');

    const body = mockCreate.mock.calls[0][0];
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: '*<@U1>:* help with SIS' },
    ]);
    expect(body.instructions).toEqual(expect.stringContaining('summarize a Slack conversation'));
    expect(body.stream).toBe(false);
    // Summarizing a transcript we already hold needs no grounding.
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('messages');
  });

  it('returns null and warns when a failed run arrives over an HTTP 200', async () => {
    mockCreate.mockResolvedValue({ status: 'failed', error: { message: 'upstream refused' } });
    const logger = { warn: jest.fn() };
    const result = await summarizeForEscalation('*<@U1>:* hi', logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('upstream refused'));
  });

  it('still returns the summary when the run is incomplete but produced text', async () => {
    mockCreate.mockResolvedValue({ status: 'incomplete', output_text: 'Partial summary.' });
    const result = await summarizeForEscalation('*<@U1>:* hi');
    expect(result).toBe('Partial summary.');
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
