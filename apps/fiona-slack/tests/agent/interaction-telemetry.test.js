// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/agent/interaction-store.js', () => ({
  recordInteraction: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../src/agent/utils/idempotent-finalize.js', () => ({
  rollbackFinalization: jest.fn(),
}));

jest.unstable_mockModule('../../src/agent/llm-caller.js', () => ({
  handleMetadataTimeout: jest.fn(),
  TOOL_CALL_DEPTH_EXCEEDED_CODE: 'MAX_TOOL_CALL_DEPTH_EXCEEDED',
  TOOL_CALL_DEPTH_EXCEEDED_MESSAGE: 'The AI encountered too many tool invocations. Please try a simpler request.',
  MetadataLifecycleState: {
    READY_TO_FINALIZE: 'READY_TO_FINALIZE',
    DEGRADED_NO_METADATA: 'DEGRADED_NO_METADATA',
    FINALIZED: 'FINALIZED',
  },
}));

const { handleInteractionWithTelemetry, sleep, waitForMetadataReady } = await import(
  '../../src/agent/interaction-telemetry.js'
);
const { recordInteraction } = await import('../../src/agent/interaction-store.js');
const { rollbackFinalization } = await import('../../src/agent/utils/idempotent-finalize.js');
const {
  handleMetadataTimeout,
  MetadataLifecycleState,
  TOOL_CALL_DEPTH_EXCEEDED_CODE,
  TOOL_CALL_DEPTH_EXCEEDED_MESSAGE,
} = await import('../../src/agent/llm-caller.js');

describe('handleInteractionWithTelemetry', () => {
  let say;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    say = jest.fn().mockResolvedValue(undefined);
    logger = {
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  describe('success path', () => {
    it('executes handler without error', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          status: 'success',
          errorType: null,
          rateLimited: false,
        }),
      );
      expect(say).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('provides context callbacks to handler', async () => {
      const handler = jest.fn(async (ctx) => {
        ctx.claimResponseId('response-123');
        ctx.markRateLimited();
      });

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      const ctx = handler.mock.calls[0][0];
      expect(typeof ctx.claimResponseId).toBe('function');
      expect(typeof ctx.markRateLimited).toBe('function');
      expect(typeof ctx.markInteractionRecorded).toBe('function');

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          rateLimited: true,
        }),
      );
    });
  });

  describe('error handling', () => {
    it('catches COSMOS_ERROR and classifies as cosmos_error', async () => {
      const error = new Error('Cosmos database error');
      error.code = 'COSMOS_ERROR';
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(logger.error).toHaveBeenCalled();
      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'cosmos_error',
        }),
      );
      expect(say).toHaveBeenCalledWith(':warning: Something went wrong! Please try again later.');
    });

    it('catches TimeoutError and classifies as timeout', async () => {
      const error = new Error('Request timeout');
      error.name = 'TimeoutError';
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'timeout',
        }),
      );
    });

    it('classifies rate limit errors by code', async () => {
      const error = new Error('Rate limit exceeded');
      error.code = '429';
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'llm_rate_limited',
        }),
      );
    });

    it('classifies rate limit errors by message', async () => {
      const error = new Error('You exceeded your rate_limit');
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'llm_rate_limited',
        }),
      );
    });

    it('classifies LLM API errors by code', async () => {
      const error = new Error('OpenAI API error');
      error.code = 'openai_error';
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'llm_error',
        }),
      );
    });

    it('classifies LLM API errors by name', async () => {
      const error = new Error('API request failed');
      error.name = 'APIError';
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'llm_error',
        }),
      );
    });

    it('classifies max tool call depth errors and sends a targeted user message', async () => {
      const error = new Error('Maximum tool call depth exceeded');
      error.code = TOOL_CALL_DEPTH_EXCEEDED_CODE;
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'max_tool_call_depth_exceeded',
        }),
      );
      expect(say).toHaveBeenCalledWith(`:warning: ${TOOL_CALL_DEPTH_EXCEEDED_MESSAGE}`);
    });

    it('classifies unknown errors as unknown', async () => {
      const error = new Error('Something unexpected happened');
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorType: 'unknown',
        }),
      );
    });

    it('rolls back finalization slot on error if claimed', async () => {
      const error = new Error('Handler failed');
      const handler = jest.fn(async (ctx) => {
        ctx.claimResponseId('response-456');
        throw error;
      });

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(rollbackFinalization).toHaveBeenCalledWith('response-456');
    });

    it('does not rollback finalization if slot was not claimed', async () => {
      const error = new Error('Handler failed');
      const handler = jest.fn().mockRejectedValue(error);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(rollbackFinalization).not.toHaveBeenCalled();
    });

    it('handles say() failure gracefully when sending error message', async () => {
      const error = new Error('Handler failed');
      const sayError = new Error('Slack API error');
      const handler = jest.fn().mockRejectedValue(error);
      say.mockRejectedValue(sayError);

      await expect(
        handleInteractionWithTelemetry(
          {
            userId: 'U123',
            teamId: 'T123',
            channelId: 'C123',
            threadTs: '1712345678.001',
            messageTs: '1712345678.123',
            interactionType: 'app_mention',
            logger,
            say,
          },
          handler,
        ),
      ).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith('Failed to send error message to Slack');
      expect(recordInteraction).toHaveBeenCalled();
    });
  });

  describe('interaction recording', () => {
    it('records interaction in finally block', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledTimes(1);
    });

    it('skips recording if already recorded in handler', async () => {
      const handler = jest.fn(async (ctx) => {
        ctx.markInteractionRecorded();
      });

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).not.toHaveBeenCalled();
    });

    it('handles recording failure gracefully', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const recordError = new Error('Cosmos error');
      recordInteraction.mockRejectedValue(recordError);

      await expect(
        handleInteractionWithTelemetry(
          {
            userId: 'U123',
            teamId: 'T123',
            channelId: 'C123',
            threadTs: '1712345678.001',
            messageTs: '1712345678.123',
            interactionType: 'app_mention',
            logger,
            say,
          },
          handler,
        ),
      ).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to record interaction'));
    });

    it('includes rate limit flag in recorded interaction', async () => {
      const handler = jest.fn(async (ctx) => {
        ctx.markRateLimited();
      });

      await handleInteractionWithTelemetry(
        {
          userId: 'U123',
          teamId: 'T123',
          channelId: 'C123',
          threadTs: '1712345678.001',
          messageTs: '1712345678.123',
          interactionType: 'app_mention',
          logger,
          say,
        },
        handler,
      );

      expect(recordInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          rateLimited: true,
        }),
      );
    });
  });
});

describe('waitForMetadataReady', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns immediately if metadata is null', async () => {
    await expect(waitForMetadataReady(null, 5000)).resolves.toBeUndefined();
  });

  it('returns immediately if metadata is in READY_TO_FINALIZE state', async () => {
    const metadata = { finalize_state: MetadataLifecycleState.READY_TO_FINALIZE };
    await expect(waitForMetadataReady(metadata, 5000)).resolves.toBeUndefined();
  });

  it('returns immediately if metadata is in DEGRADED_NO_METADATA state', async () => {
    const metadata = { finalize_state: MetadataLifecycleState.DEGRADED_NO_METADATA };
    await expect(waitForMetadataReady(metadata, 5000)).resolves.toBeUndefined();
  });

  it('returns immediately if metadata is in FINALIZED state', async () => {
    const metadata = { finalize_state: MetadataLifecycleState.FINALIZED };
    await expect(waitForMetadataReady(metadata, 5000)).resolves.toBeUndefined();
  });

  it('waits and retries if metadata is not in ready state', async () => {
    const metadata = { finalize_state: 'PENDING' };
    const timeout = 150;

    const promise = waitForMetadataReady(metadata, timeout);

    setTimeout(() => {
      metadata.finalize_state = MetadataLifecycleState.READY_TO_FINALIZE;
    }, 75);

    await expect(promise).resolves.toBeUndefined();
  });

  it('handles timeout by calling handleMetadataTimeout', async () => {
    const metadata = { finalize_state: 'PENDING' };
    const timeout = 100;

    await waitForMetadataReady(metadata, timeout);

    expect(handleMetadataTimeout).toHaveBeenCalledWith(metadata);
  });

  it('respects custom timeout duration', async () => {
    const metadata = { finalize_state: 'PENDING' };
    const timeout = 50;
    const startTime = Date.now();

    await waitForMetadataReady(metadata, timeout);

    const elapsedTime = Date.now() - startTime;
    expect(elapsedTime).toBeLessThan(timeout + 100); // Allow 100ms buffer for test execution
  });
});

describe('sleep', () => {
  it('resolves after specified milliseconds', async () => {
    const startTime = Date.now();
    await sleep(50);
    const elapsedTime = Date.now() - startTime;

    expect(elapsedTime).toBeGreaterThanOrEqual(50);
    expect(elapsedTime).toBeLessThan(150); // Allow some variance
  });

  it('resolves immediately for zero milliseconds', async () => {
    const startTime = Date.now();
    await sleep(0);
    const elapsedTime = Date.now() - startTime;

    expect(elapsedTime).toBeLessThan(50);
  });
});
