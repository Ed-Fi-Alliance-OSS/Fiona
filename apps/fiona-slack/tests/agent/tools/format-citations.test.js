// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { formatCitations } from '../../../src/agent/tools/format-citations.js';

describe('formatCitations', () => {
  it('returns an empty string for an empty array', () => {
    expect(formatCitations([])).toBe('');
  });

  it('returns an empty string for a non-array value', () => {
    expect(formatCitations(null)).toBe('');
    expect(formatCitations(undefined)).toBe('');
    expect(formatCitations('https://example.com')).toBe('');
    expect(formatCitations(42)).toBe('');
  });

  it('formats a single citation with a leading newline and Sources header', () => {
    const result = formatCitations(['https://docs.ed-fi.org/a']);
    expect(result).toBe('\n\n*Sources:*\n1. <https://docs.ed-fi.org/a>');
  });

  it('formats multiple citations as a numbered list', () => {
    const urls = ['https://docs.ed-fi.org/a', 'https://www.ed-fi.org/b', 'https://api.ed-fi.org/c'];
    const result = formatCitations(urls);
    expect(result).toBe(
      '\n\n*Sources:*\n1. <https://docs.ed-fi.org/a>\n2. <https://www.ed-fi.org/b>\n3. <https://api.ed-fi.org/c>',
    );
  });

  it('uses 1-based numbering', () => {
    const result = formatCitations(['https://example.com/1', 'https://example.com/2']);
    expect(result).toContain('1. <https://example.com/1>');
    expect(result).toContain('2. <https://example.com/2>');
    expect(result).not.toContain('0. ');
  });

  it('wraps each URL in angle brackets for Slack auto-linking', () => {
    const result = formatCitations(['https://example.com']);
    expect(result).toContain('<https://example.com>');
  });

  it('starts the output with a double newline separator', () => {
    const result = formatCitations(['https://example.com']);
    expect(result.startsWith('\n\n')).toBe(true);
  });

  it('includes the *Sources:* header', () => {
    const result = formatCitations(['https://example.com']);
    expect(result).toContain('*Sources:*');
  });
});
