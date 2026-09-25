// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';

const { filterSources, isDenylisted, parseDenylist, urlKey } = await import(
  '../../../src/agent/utils/source-filter.js'
);

describe('urlKey', () => {
  it('ignores scheme, host case, www. and trailing slashes, but keeps path case', () => {
    expect(urlKey('https://WWW.Ed-Fi.org/Getting-Started/')).toBe('ed-fi.org/Getting-Started');
    expect(urlKey('http://ed-fi.org/Getting-Started')).toBe('ed-fi.org/Getting-Started');
  });
});

describe('parseDenylist / isDenylisted', () => {
  const denylist = parseDenylist('www.ed-fi.org/what-is-ed-fi-old/, https://docs.ed-fi.org/retired , ,');

  it('parses comma-separated prefixes, with or without a scheme, and skips blanks', () => {
    expect(denylist).toEqual(['ed-fi.org/what-is-ed-fi-old', 'docs.ed-fi.org/retired']);
  });

  it('matches the prefix itself and paths below it', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-old/', denylist)).toBe(true);
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-old/mission/', denylist)).toBe(true);
    expect(isDenylisted('https://ed-fi.org/what-is-ed-fi-old/mission', denylist)).toBe(true);
  });

  // Review Focus 1: a prefix must end at a path boundary.
  it('does not match a sibling path that merely starts with the same characters', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-older/page/', denylist)).toBe(false);
  });

  it('keeps path case significant', () => {
    expect(isDenylisted('https://www.ed-fi.org/What-Is-Ed-Fi-Old/mission/', denylist)).toBe(false);
  });

  it('matches nothing when the denylist is empty', () => {
    expect(isDenylisted('https://www.ed-fi.org/anything/', parseDenylist(''))).toBe(false);
  });

  it('matches the prefix with query string', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-old/?utm=1', denylist)).toBe(true);
  });

  it('matches the prefix with fragment', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-old#top', denylist)).toBe(true);
  });

  it('matches paths below the prefix with query string', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-old/mission/?utm=1', denylist)).toBe(true);
  });

  it('does not match sibling path with query string', () => {
    expect(isDenylisted('https://www.ed-fi.org/what-is-ed-fi-older?x=1', denylist)).toBe(false);
  });
});

describe('filterSources', () => {
  const sources = [
    { id: 1, url: 'https://docs.ed-fi.org/live/' },
    { id: 2, url: 'https://www.ed-fi.org/gone/' },
    { id: 4, url: 'https://www.ed-fi.org/what-is-ed-fi-old/mission/' },
    { id: 5, url: 'https://docs.ed-fi.org/slow/' },
  ];
  const verdicts = new Map([
    ['https://docs.ed-fi.org/live/', 'live'],
    ['https://www.ed-fi.org/gone/', 'dead'],
    ['https://docs.ed-fi.org/slow/', 'unknown'],
  ]);

  it('keeps live and unknown sources in order, with their original ids', () => {
    const { kept } = filterSources(sources, verdicts, parseDenylist('www.ed-fi.org/what-is-ed-fi-old/'));
    expect(kept).toEqual([sources[0], sources[3]]);
  });

  it('records each removed source with its reason', () => {
    const { removed } = filterSources(sources, verdicts, parseDenylist('www.ed-fi.org/what-is-ed-fi-old/'));
    expect(removed).toEqual([
      { url: 'https://www.ed-fi.org/gone/', id: 2, reason: 'dead' },
      { url: 'https://www.ed-fi.org/what-is-ed-fi-old/mission/', id: 4, reason: 'denylisted' },
    ]);
  });

  it('reports denylisted, not dead, when a URL is both', () => {
    const both = new Map([['https://www.ed-fi.org/what-is-ed-fi-old/mission/', 'dead']]);
    const { removed } = filterSources([sources[2]], both, parseDenylist('www.ed-fi.org/what-is-ed-fi-old/'));
    expect(removed[0].reason).toBe('denylisted');
  });

  it('keeps a source that has no verdict', () => {
    const { kept } = filterSources([sources[0]], new Map(), []);
    expect(kept).toEqual([sources[0]]);
  });
});
