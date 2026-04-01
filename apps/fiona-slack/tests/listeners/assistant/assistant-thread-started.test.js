// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { assistantThreadStarted } from '../../../src/listeners/assistant/assistant_thread_started.js';

describe('assistantThreadStarted', () => {
  let mockLogger;
  let mockSay;
  let mockSaveThreadContext;
  let mockSetSuggestedPrompts;

  beforeEach(() => {
    mockLogger = { error: jest.fn() };
    mockSay = jest.fn().mockResolvedValue(undefined);
    mockSaveThreadContext = jest.fn().mockResolvedValue(undefined);
    mockSetSuggestedPrompts = jest.fn().mockResolvedValue(undefined);
  });

  it('calls say with a greeting message', async () => {
    const event = { assistant_thread: { context: { channel_id: 'C123' } } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSay).toHaveBeenCalledTimes(1);
    const [greeting] = mockSay.mock.calls[0];
    expect(typeof greeting).toBe('string');
    expect(greeting.length).toBeGreaterThan(0);
  });

  it('calls saveThreadContext', async () => {
    const event = { assistant_thread: { context: { channel_id: 'C123' } } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSaveThreadContext).toHaveBeenCalledTimes(1);
  });

  it('sets suggested prompts when there is no channel_id in context', async () => {
    const event = { assistant_thread: { context: {} } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSetSuggestedPrompts).toHaveBeenCalledTimes(1);
    const [{ prompts }] = mockSetSuggestedPrompts.mock.calls[0];
    expect(Array.isArray(prompts)).toBe(true);
    expect(prompts.length).toBeGreaterThan(0);
  });

  it('does not set suggested prompts when channel_id is present in context', async () => {
    const event = { assistant_thread: { context: { channel_id: 'C999' } } };

    await assistantThreadStarted({
      event,
      logger: mockLogger,
      say: mockSay,
      setSuggestedPrompts: mockSetSuggestedPrompts,
      saveThreadContext: mockSaveThreadContext,
    });

    expect(mockSetSuggestedPrompts).not.toHaveBeenCalled();
  });

  it('logs error and does not throw when say rejects', async () => {
    const error = new Error('say failed');
    mockSay.mockRejectedValueOnce(error);
    const event = { assistant_thread: { context: {} } };

    await expect(
      assistantThreadStarted({
        event,
        logger: mockLogger,
        say: mockSay,
        setSuggestedPrompts: mockSetSuggestedPrompts,
        saveThreadContext: mockSaveThreadContext,
      }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledWith(error);
  });
});
