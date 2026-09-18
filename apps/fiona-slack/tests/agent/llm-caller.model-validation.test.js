// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, afterEach } from '@jest/globals';

jest.unstable_mockModule('@perplexity-ai/perplexity_ai', () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: { create: jest.fn() },
    search: { create: jest.fn() },
  })),
}));

process.env.PERPLEXITY_API_KEY = 'test-key';

/**
 * PERPLEXITY_API_MODEL is read at module load, so each case needs a fresh
 * module instance to exercise a different configured value.
 */
async function assertWithModel(model) {
  jest.resetModules();
  const previous = process.env.PERPLEXITY_API_MODEL;

  if (model === undefined) {
    delete process.env.PERPLEXITY_API_MODEL;
  } else {
    process.env.PERPLEXITY_API_MODEL = model;
  }

  try {
    const { assertLLMConfigured } = await import('../../src/agent/llm-caller.js');
    return assertLLMConfigured;
  } finally {
    if (previous === undefined) {
      delete process.env.PERPLEXITY_API_MODEL;
    } else {
      process.env.PERPLEXITY_API_MODEL = previous;
    }
  }
}

afterEach(() => jest.resetModules());

describe('assertLLMConfigured – model validation at boot', () => {
  it('accepts the default when PERPLEXITY_API_MODEL is unset', async () => {
    const assertLLMConfigured = await assertWithModel(undefined);
    expect(() => assertLLMConfigured()).not.toThrow();
  });

  it('accepts any provider-prefixed slug, so a drifting catalog is not rejected', async () => {
    for (const model of ['perplexity/sonar', 'openai/gpt-5.1', 'anthropic/claude-sonnet-4-5']) {
      const assertLLMConfigured = await assertWithModel(model);
      expect(() => assertLLMConfigured()).not.toThrow();
    }
  });

  it('rejects a retired Sonar chat-completions model and names the replacement', async () => {
    const assertLLMConfigured = await assertWithModel('sonar');
    expect(() => assertLLMConfigured()).toThrow(/Sonar chat-completions model/);
    expect(() => assertLLMConfigured()).toThrow(/perplexity\/sonar/);
  });

  it.each(['sonar-pro', 'sonar-reasoning', 'sonar-deep-research'])(
    'rejects retired Sonar model %s',
    async (model) => {
      const assertLLMConfigured = await assertWithModel(model);
      expect(() => assertLLMConfigured()).toThrow(/PERPLEXITY_API_MODEL is invalid/);
    },
  );

  it('rejects an Agent API preset name and explains presets are a separate field', async () => {
    const assertLLMConfigured = await assertWithModel('fast');
    expect(() => assertLLMConfigured()).toThrow(/preset name, not a model/);
    expect(() => assertLLMConfigured()).toThrow(/"preset" request field/);
  });

  it('rejects an unprefixed slug', async () => {
    const assertLLMConfigured = await assertWithModel('some-model');
    expect(() => assertLLMConfigured()).toThrow(/provider\/model format/);
  });

  it('rejects an empty configured value', async () => {
    const assertLLMConfigured = await assertWithModel('   ');
    expect(() => assertLLMConfigured()).toThrow(/is empty/);
  });
});
