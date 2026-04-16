// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('provider routing and dice removal', () => {
  const src = readFileSync(resolve('src/agent/llm-caller.js'), 'utf8');

  it('does not contain sonar: user-controlled routing', () => {
    expect(src).not.toContain("startsWith('sonar:')");
  });

  it('does not contain search keyword routing', () => {
    expect(src).not.toContain("includes('search')");
  });

  it('does not import dice', () => {
    expect(src).not.toContain('dice');
  });
});
