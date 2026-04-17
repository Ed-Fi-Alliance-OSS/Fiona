// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const createMock = jest.fn();

jest.unstable_mockModule('@azure/ai-projects', () => ({
  AIProjectClient: jest.fn(),
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    responses: { create: createMock },
  })),
  AzureOpenAI: jest.fn().mockImplementation(() => ({
    responses: { create: createMock },
  })),
}));

jest.unstable_mockModule('../../src/agent/utils/citation-telemetry.js', () => ({
  recordMetadataWaitDuration: jest.fn(),
  recordSourceCount: jest.fn(),
  incrementDegradedNoMetadataCount: jest.fn(),
  incrementTotalResponseCount: jest.fn(),
}));

describe('callOpenAICompatible recursion depth', () => {
  let callLLM;
  let MAX_RECURSION_DEPTH;
  let TOOL_CALL_DEPTH_EXCEEDED_CODE;
  let TOOL_CALL_DEPTH_EXCEEDED_MESSAGE;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
    process.env.AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || 'test-key';
    ({ callLLM, MAX_RECURSION_DEPTH, TOOL_CALL_DEPTH_EXCEEDED_CODE, TOOL_CALL_DEPTH_EXCEEDED_MESSAGE } = await import(
      '../../src/agent/llm-caller.js'
    ));
  });

  beforeEach(() => {
    createMock.mockReset();
  });

  it('exports MAX_RECURSION_DEPTH as a positive number no greater than 20', () => {
    expect(typeof MAX_RECURSION_DEPTH).toBe('number');
    expect(MAX_RECURSION_DEPTH).toBeGreaterThan(0);
    expect(MAX_RECURSION_DEPTH).toBeLessThanOrEqual(20);
  });

  it('throws a typed error when tool-call recursion exceeds the maximum depth', async () => {
    createMock.mockImplementation(() =>
      (async function* streamWithToolCall() {
        yield {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            name: 'roll_dice',
            id: 'fc_1',
            call_id: 'call_1',
            arguments: '{"count":1,"sides":6}',
          },
        };
      })(),
    );

    const streamer = {
      append: jest.fn().mockResolvedValue(undefined),
      __citation_metadata: null,
    };
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const prompts = [{ role: 'user', content: 'roll a die forever' }];

    await expect(callLLM(streamer, prompts, logger)).rejects.toMatchObject({
      name: 'ToolCallDepthError',
      code: TOOL_CALL_DEPTH_EXCEEDED_CODE,
      userMessage: TOOL_CALL_DEPTH_EXCEEDED_MESSAGE,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      '[llm] Maximum tool call depth exceeded.',
      expect.objectContaining({
        code: TOOL_CALL_DEPTH_EXCEEDED_CODE,
        maxDepth: MAX_RECURSION_DEPTH,
      }),
    );
  });
});
