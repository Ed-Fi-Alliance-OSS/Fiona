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
async function assertWithEnv(overrides) {
  jest.resetModules();
  const previous = {};

  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    const { assertLLMConfigured } = await import('../../src/agent/llm-caller.js');
    return assertLLMConfigured;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const assertWithModel = (model) => assertWithEnv({ PERPLEXITY_API_MODEL: model });
const assertWithDomains = (domains) =>
  assertWithEnv({ PERPLEXITY_API_MODEL: 'perplexity/sonar', PERPLEXITY_DOMAIN_FILTER: domains });

afterEach(() => jest.resetModules());

describe('assertLLMConfigured – model validation at boot', () => {
  it('accepts the default when PERPLEXITY_API_MODEL is unset', async () => {
    const assertLLMConfigured = await assertWithModel(undefined);
    expect(() => assertLLMConfigured()).not.toThrow();
  });

  it('accepts any provider-prefixed slug, so a drifting catalog is not rejected', async () => {
    // anthropic/* is deliberately excluded here - it has its own rejection case below.
    for (const model of ['perplexity/sonar', 'openai/gpt-5.1', 'google/gemini-3-flash-preview']) {
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

  it('rejects anthropic models, which require a max_output_tokens this app never sends', async () => {
    const assertLLMConfigured = await assertWithModel('anthropic/claude-sonnet-4-5');
    expect(() => assertLLMConfigured()).toThrow(/requires max_output_tokens/);
  });
});

describe('assertLLMConfigured – domain filter validation at boot', () => {
  it('accepts the default Ed-Fi domains', async () => {
    const assertLLMConfigured = await assertWithDomains(undefined);
    expect(() => assertLLMConfigured()).not.toThrow();
  });

  it('accepts scheme-less hostnames with surrounding whitespace, which is trimmed', async () => {
    const assertLLMConfigured = await assertWithDomains(' docs.ed-fi.org , www.ed-fi.org ');
    expect(() => assertLLMConfigured()).not.toThrow();
  });

  it('rejects a scheme-prefixed entry and says to pass the hostname only', async () => {
    const assertLLMConfigured = await assertWithDomains('https://docs.ed-fi.org');
    expect(() => assertLLMConfigured()).toThrow(/includes a URL scheme/);
    expect(() => assertLLMConfigured()).toThrow(/hostname only/);
  });

  it('rejects more than 20 entries', async () => {
    const domains = Array.from({ length: 21 }, (_, i) => `d${i}.example.com`).join(',');
    const assertLLMConfigured = await assertWithDomains(domains);
    expect(() => assertLLMConfigured()).toThrow(/21 entries, but at most 20/);
  });

  it('rejects an entry over the 253 character limit', async () => {
    const assertLLMConfigured = await assertWithDomains(`${'a'.repeat(254)}.com`);
    expect(() => assertLLMConfigured()).toThrow(/253 character limit/);
  });

  it('rejects a stray comma that yields an empty entry', async () => {
    const assertLLMConfigured = await assertWithDomains('docs.ed-fi.org,,www.ed-fi.org');
    expect(() => assertLLMConfigured()).toThrow(/empty entry/);
  });
});
