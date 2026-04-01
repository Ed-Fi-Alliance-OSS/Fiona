// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { perplexitySearchDefinition } from '../../../src/agent/tools/perplexity-search.js';

describe('perplexitySearchDefinition', () => {
  it('has type "function"', () => {
    expect(perplexitySearchDefinition.type).toBe('function');
  });

  it('has name "perplexity_search"', () => {
    expect(perplexitySearchDefinition.name).toBe('perplexity_search');
  });

  it('has a non-empty description', () => {
    expect(typeof perplexitySearchDefinition.description).toBe('string');
    expect(perplexitySearchDefinition.description.length).toBeGreaterThan(0);
  });

  it('has parameters schema with object type', () => {
    expect(perplexitySearchDefinition.parameters.type).toBe('object');
  });

  it('has a query property in parameters', () => {
    const { query } = perplexitySearchDefinition.parameters.properties;
    expect(query).toBeDefined();
    expect(query.type).toBe('string');
  });

  it('requires the query parameter', () => {
    expect(perplexitySearchDefinition.parameters.required).toContain('query');
  });

  it('has strict set to false', () => {
    expect(perplexitySearchDefinition.strict).toBe(false);
  });
});
