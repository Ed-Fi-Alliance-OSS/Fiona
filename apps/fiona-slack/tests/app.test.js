// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, test, expect, jest } from '@jest/globals';

// ── Module mocks must be declared before any imports that trigger side-effects ──

jest.unstable_mockModule('dotenv/config', () => ({}));

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockLogger = { info: jest.fn(), error: jest.fn() };
const mockApp = { start: mockStart, logger: mockLogger };
const MockApp = jest.fn().mockReturnValue(mockApp);

jest.unstable_mockModule('@slack/bolt', () => ({
  App: MockApp,
  LogLevel: { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' },
}));

jest.unstable_mockModule('../src/listeners/index.js', () => ({
  registerListeners: jest.fn(),
}));

// Mock agent modules so module-level client instantiation is skipped.
jest.unstable_mockModule('../src/agent/llm-caller.js', () => ({
  callLLM: jest.fn(),
}));

const { registerListeners } = await import('../src/listeners/index.js');

// Import app.js once — the module executes its top-level side-effects on first load.
await import('../src/app.js');

// Allow the async start IIFE to settle.
await new Promise((resolve) => setTimeout(resolve, 0));

describe('app.js', () => {
  test('creates a Bolt App in socket mode', () => {
    expect(MockApp).toHaveBeenCalledTimes(1);
    const [config] = MockApp.mock.calls[0];
    expect(config.socketMode).toBe(true);
  });

  test('registers event listeners', () => {
    expect(registerListeners).toHaveBeenCalledWith(mockApp);
  });

  test('starts the app', () => {
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

