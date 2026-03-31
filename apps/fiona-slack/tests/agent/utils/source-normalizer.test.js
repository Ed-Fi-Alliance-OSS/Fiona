/*
 * SPDX-License-Identifier: Apache-2.0
 * Licensed to the Ed-Fi Alliance under one or more agreements.
 * The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
 * See the LICENSE and NOTICES files in the project root for more information.
 */

import { describe, it, expect } from '@jest/globals';
import {
  normalizeSource,
  deduplicateSources,
  capSources,
  buildSourceIndexMap,
  normalizeSources,
  remapCitationMarkers,
} from '../../../src/agent/utils/source-normalizer.js';

describe('normalizeSource', () => {
  it('normalizes a source with url and title', () => {
    const result = normalizeSource({ url: 'https://docs.ed-fi.org/page', title: 'Ed-Fi Docs' });
    expect(result.url).toBe('https://docs.ed-fi.org/page');
    expect(result.title).toBe('Ed-Fi Docs');
    expect(result.hostname).toBe('docs.ed-fi.org');
  });

  it('falls back to path-derived title when title is absent', () => {
    const result = normalizeSource({ url: 'https://example.com/reference/ods-api/platform-dev-guide/' });
    expect(result.title).toBe('ODS/API Platform Dev Guide');
  });

  it('falls back to domain when path is not informative', () => {
    const result = normalizeSource({ url: 'https://example.com/' });
    expect(result.title).toBe('example.com');
  });

  it('returns null for null input', () => {
    expect(normalizeSource(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(normalizeSource('https://example.com')).toBeNull();
  });

  it('returns null when url is missing', () => {
    expect(normalizeSource({ title: 'No URL' })).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(normalizeSource({ url: 'not-a-valid-url' })).toBeNull();
  });

  it('returns null for empty url string', () => {
    expect(normalizeSource({ url: '' })).toBeNull();
  });

  it('preserves optional date and snippet fields', () => {
    const result = normalizeSource({
      url: 'https://example.com',
      published_date: '2024-01-01',
      snippet: 'Example text.',
    });
    expect(result.date).toBe('2024-01-01');
    expect(result.snippet).toBe('Example text.');
  });

  it('trims whitespace from url', () => {
    const result = normalizeSource({ url: '  https://example.com  ' });
    expect(result.url).toBe('https://example.com');
  });
});

describe('deduplicateSources', () => {
  it('removes duplicate URLs, keeping first occurrence', () => {
    const sources = [
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
      { url: 'https://a.com', title: 'A duplicate' },
    ];
    const result = deduplicateSources(sources);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('A');
  });

  it('preserves original order (first-seen)', () => {
    const sources = [
      { url: 'https://b.com', title: 'B' },
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B dup' },
    ];
    const result = deduplicateSources(sources);
    expect(result[0].url).toBe('https://b.com');
    expect(result[1].url).toBe('https://a.com');
  });

  it('handles empty array', () => {
    expect(deduplicateSources([])).toEqual([]);
  });
});

describe('capSources', () => {
  const manySources = Array.from({ length: 12 }, (_, i) => ({
    url: `https://example${i}.com`,
    title: `Source ${i}`,
  }));

  it('truncates to maxSources', () => {
    expect(capSources(manySources, 5)).toHaveLength(5);
  });

  it('defaults to 10', () => {
    expect(capSources(manySources)).toHaveLength(10);
  });

  it('returns original list when shorter than cap', () => {
    const sources = [{ url: 'https://a.com', title: 'A' }];
    expect(capSources(sources, 10)).toHaveLength(1);
  });

  it('enforces minimum cap of 1', () => {
    expect(capSources(manySources, 0)).toHaveLength(1);
  });
});

describe('buildSourceIndexMap', () => {
  it('builds a 1-indexed URL map', () => {
    const sources = [
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
    ];
    const map = buildSourceIndexMap(sources);
    expect(map['https://a.com']).toBe(1);
    expect(map['https://b.com']).toBe(2);
  });

  it('returns an empty object for empty list', () => {
    expect(buildSourceIndexMap([])).toEqual({});
  });
});

describe('normalizeSources', () => {
  it('returns empty result for non-array input', () => {
    const result = normalizeSources(null);
    expect(result.sources).toEqual([]);
    expect(result.sourceIndexMap).toEqual({});
  });

  it('normalizes, deduplicates, and caps sources', () => {
    const raw = [
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
      { url: 'https://a.com', title: 'A dup' },
    ];
    const { sources, sourceIndexMap } = normalizeSources(raw);
    expect(sources).toHaveLength(2);
    expect(sourceIndexMap['https://a.com']).toBe(1);
    expect(sourceIndexMap['https://b.com']).toBe(2);
  });

  it('excludes malformed URLs', () => {
    const raw = [{ url: 'bad-url' }, { url: 'https://good.com' }];
    const { sources } = normalizeSources(raw);
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('https://good.com');
  });

  it('respects custom maxSources option', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ url: `https://example${i}.com` }));
    const { sources } = normalizeSources(raw, { maxSources: 5 });
    expect(sources).toHaveLength(5);
  });

  it('stable numbering matches deduplicated first-seen order', () => {
    const raw = [{ url: 'https://c.com' }, { url: 'https://a.com' }, { url: 'https://b.com' }];
    const { sourceIndexMap } = normalizeSources(raw);
    expect(sourceIndexMap['https://c.com']).toBe(1);
    expect(sourceIndexMap['https://a.com']).toBe(2);
    expect(sourceIndexMap['https://b.com']).toBe(3);
  });
});

describe('remapCitationMarkers', () => {
  it('remaps [n] markers according to indexMap', () => {
    const indexMap = { 1: 3, 2: 1 };
    expect(remapCitationMarkers('See [1] and [2].', indexMap)).toBe('See [3] and [1].');
  });

  it('leaves markers unchanged when not in indexMap', () => {
    expect(remapCitationMarkers('See [5].', { 1: 2 })).toBe('See [5].');
  });

  it('returns text unchanged when indexMap is empty', () => {
    expect(remapCitationMarkers('No citations here.', {})).toBe('No citations here.');
  });

  it('returns null unchanged when text is null', () => {
    expect(remapCitationMarkers(null, { 1: 2 })).toBeNull();
  });

  it('handles text with no citation markers', () => {
    expect(remapCitationMarkers('No markers.', { 1: 2 })).toBe('No markers.');
  });

  it('handles multiple occurrences of the same marker', () => {
    const indexMap = { 1: 2 };
    expect(remapCitationMarkers('[1] and [1] again.', indexMap)).toBe('[2] and [2] again.');
  });
});
