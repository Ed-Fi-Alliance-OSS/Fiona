// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockGetGlobalFlags = jest.fn();
const mockGetUserFlags = jest.fn();

jest.unstable_mockModule('../../src/agent/feature-flags-store.js', () => ({
  getGlobalFlags: mockGetGlobalFlags,
  getUserFlags: mockGetUserFlags,
}));

let isFeatureEnabled, __clearFeatureFlagCache;

beforeEach(async () => {
  jest.resetModules();
  mockGetGlobalFlags.mockReset().mockResolvedValue(null);
  mockGetUserFlags.mockReset().mockResolvedValue(null);
  delete process.env.FEATURE_FLAGS_CACHE_TTL_MS;
  ({ isFeatureEnabled, __clearFeatureFlagCache } = await import('../../src/agent/feature-flags.js'));
  __clearFeatureFlagCache();
});

describe('resolution precedence', () => {
  it('unknown flag returns false, warns, and does not query Cosmos', async () => {
    const logger = { warn: jest.fn() };
    expect(await isFeatureEnabled('nope', { userId: 'U1' }, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
    expect(mockGetGlobalFlags).not.toHaveBeenCalled();
    expect(mockGetUserFlags).not.toHaveBeenCalled();
  });

  it('falls back to the registry default when no documents exist', async () => {
    // escalate default is true; conversationCapture default is false
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(true);
    expect(await isFeatureEnabled('conversationCapture')).toBe(false);
  });

  it('global value overrides the registry default', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(false);
  });

  it('per-user value overrides the global value', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    mockGetUserFlags.mockResolvedValue({ escalate: true });
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(true);
  });

  it('ignores the per-user layer when no userId is supplied', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    expect(await isFeatureEnabled('escalate')).toBe(false);
    expect(mockGetUserFlags).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('serves a second call within the TTL from cache (one store read)', async () => {
    mockGetGlobalFlags.mockResolvedValue({ escalate: false });
    await isFeatureEnabled('escalate');
    await isFeatureEnabled('escalate');
    expect(mockGetGlobalFlags).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the TTL expires', async () => {
    jest.useFakeTimers();
    try {
      process.env.FEATURE_FLAGS_CACHE_TTL_MS = '30000';
      mockGetGlobalFlags.mockResolvedValue({ escalate: false });
      await isFeatureEnabled('escalate');
      jest.advanceTimersByTime(30_001);
      await isFeatureEnabled('escalate');
      expect(mockGetGlobalFlags).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('degradation', () => {
  it('returns the registry default when the store returns null', async () => {
    mockGetGlobalFlags.mockResolvedValue(null);
    mockGetUserFlags.mockResolvedValue(null);
    expect(await isFeatureEnabled('escalate', { userId: 'U1' })).toBe(true);
  });
});

describe('transitional conversationCapture default from CAPTURE_ALL_CONVERSATIONS', () => {
  afterEach(() => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
  });

  it('defaults conversationCapture to true when CAPTURE_ALL_CONVERSATIONS=true and no documents exist', async () => {
    process.env.CAPTURE_ALL_CONVERSATIONS = 'true';
    jest.resetModules();
    mockGetGlobalFlags.mockReset().mockResolvedValue(null);
    mockGetUserFlags.mockReset().mockResolvedValue(null);
    const mod = await import('../../src/agent/feature-flags.js');
    mod.__clearFeatureFlagCache();
    expect(await mod.isFeatureEnabled('conversationCapture')).toBe(true);
  });

  it('defaults conversationCapture to false when CAPTURE_ALL_CONVERSATIONS is unset', async () => {
    delete process.env.CAPTURE_ALL_CONVERSATIONS;
    jest.resetModules();
    mockGetGlobalFlags.mockReset().mockResolvedValue(null);
    mockGetUserFlags.mockReset().mockResolvedValue(null);
    const mod = await import('../../src/agent/feature-flags.js');
    mod.__clearFeatureFlagCache();
    expect(await mod.isFeatureEnabled('conversationCapture')).toBe(false);
  });
});
