// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { assistantThreadContextChanged } from '../../../src/listeners/assistant/assistant_thread_context_changed.js';

describe('assistantThreadContextChanged', () => {
  let mockLogger;
  let mockSaveThreadContext;

  beforeEach(() => {
    mockLogger = { error: jest.fn() };
    mockSaveThreadContext = jest.fn().mockResolvedValue(undefined);
  });

  it('calls saveThreadContext', async () => {
    await assistantThreadContextChanged({ logger: mockLogger, saveThreadContext: mockSaveThreadContext });
    expect(mockSaveThreadContext).toHaveBeenCalledTimes(1);
  });

  it('resolves without error on success', async () => {
    await expect(
      assistantThreadContextChanged({ logger: mockLogger, saveThreadContext: mockSaveThreadContext }),
    ).resolves.toBeUndefined();
  });

  it('logs error and does not throw when saveThreadContext rejects', async () => {
    const error = new Error('context save failed');
    mockSaveThreadContext.mockRejectedValueOnce(error);

    await expect(
      assistantThreadContextChanged({ logger: mockLogger, saveThreadContext: mockSaveThreadContext }),
    ).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledWith(error);
  });
});
