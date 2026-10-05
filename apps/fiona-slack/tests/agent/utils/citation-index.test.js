// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';

const { linkifyCitationMarkers, resolveCitations } = await import('../../../src/agent/utils/citation-index.js');
const { normalizeSources } = await import('../../../src/agent/utils/source-normalizer.js');

/**
 * Resolve and linkify the way callPerplexityChat does: sources and the
 * URL -> id map come from normalizing the raw results.
 */
function resolve(text, rawResults) {
  const { sources, sourceIndexMap } = normalizeSources(rawResults);
  const resolved = resolveCitations(text, sources, sourceIndexMap, rawResults);
  return {
    ...resolved,
    botText: linkifyCitationMarkers(resolved.text, resolved.indexToUrl),
    citationIndex: Object.fromEntries(resolved.indexToUrl),
  };
}

describe('linkifyCitationMarkers', () => {
  it('links markers that have a URL and leaves the rest as text', () => {
    const indexToUrl = new Map([[1, 'https://docs.ed-fi.org/a']]);

    expect(linkifyCitationMarkers('A [1]. B [2].', indexToUrl)).toBe('A [[1]](https://docs.ed-fi.org/a). B [2].');
  });

  it('returns the text unchanged when there is nothing to link', () => {
    expect(linkifyCitationMarkers('A [1].', new Map())).toBe('A [1].');
    expect(linkifyCitationMarkers('', new Map([[1, 'https://docs.ed-fi.org/a']]))).toBe('');
  });
});

describe('resolveCitations', () => {
  describe('when the model writes its own numbered source list', () => {
    // Measured live: when the model appends its own list it numbers its
    // sources 1, 2, 3... itself instead of citing Agent API result ids, so
    // linking [n] to result id n pointed at the wrong page (0 of 4 correct in
    // one run). Its list is then the only record of what each number means.
    const results = [
      { id: 1, url: 'https://docs.ed-fi.org/one/', title: 'One', published_date: '2026-01-01' },
      { id: 2, url: 'https://docs.ed-fi.org/two/', title: 'Two' },
      { id: 3, url: 'https://docs.ed-fi.org/three/', title: 'Three' },
      { id: 4, url: 'https://docs.ed-fi.org/four/', title: 'Four' },
    ];

    const run = (text) => resolve(text, results);

    it("links each marker to the URL the model's list gives it, not to result id n", () => {
      const { botText } = run(
        'Claim [1]. Other [2].\n\nSources\n[1] Four: [docs.ed-fi.org/four](https://docs.ed-fi.org/four/)\n[2] [Two](https://docs.ed-fi.org/two/)',
      );

      expect(botText).toBe('Claim [[1]](https://docs.ed-fi.org/four/). Other [[2]](https://docs.ed-fi.org/two/).');
    });

    it('removes the model list, with or without a heading, so only the Sources block lists sources', () => {
      const withHeading = run('A [1].\n\n**Sources:**\n- [1] [Four](https://docs.ed-fi.org/four/)');
      const bare = run('A [1].\n\n[1] https://docs.ed-fi.org/four/');

      expect(withHeading.botText).toBe('A [[1]](https://docs.ed-fi.org/four/).');
      expect(bare.botText).toBe('A [[1]](https://docs.ed-fi.org/four/).');
    });

    it("numbers the Sources block by the model's numbers, and the uncited results after them", () => {
      const { citationIndex, citedMarkers } = run(
        'A [1]. B [2].\n\n[1] [Four](https://docs.ed-fi.org/four/)\n[2] [Two](https://docs.ed-fi.org/two/)',
      );

      expect(citationIndex).toEqual({
        1: 'https://docs.ed-fi.org/four/',
        2: 'https://docs.ed-fi.org/two/',
        3: 'https://docs.ed-fi.org/one/',
        4: 'https://docs.ed-fi.org/three/',
      });
      expect(citedMarkers).toEqual([1, 2]);
    });

    it('matches list URLs to results ignoring scheme, www and a trailing slash', () => {
      const { botText } = run('A [1].\n\n[1] [Four](http://www.docs.ed-fi.org/four)');

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/four/).');
    });

    it('leaves a marker unlinked when its list URL is not among the search results', () => {
      const { botText, citationIndex, citedMarkers } = run(
        'A [1]. B [2].\n\nSources\n[1] [Four](https://docs.ed-fi.org/four/)\n[2] [Elsewhere](https://example.com/made-up)',
      );

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/four/). B [2].');
      expect(Object.values(citationIndex)).not.toContain('https://example.com/made-up');
      expect(citedMarkers).toEqual([1]);
    });

    it('keeps result-id linking when the answer has no trailing list', () => {
      const { botText } = run('A [4]. B [2].');

      expect(botText).toBe('A [[4]](https://docs.ed-fi.org/four/). B [[2]](https://docs.ed-fi.org/two/).');
    });

    it('keeps a trailing numbered list of steps with links that the answer never cites', () => {
      const text = 'Setup steps:\n[1] Open https://docs.ed-fi.org/one/\n[2] Check https://docs.ed-fi.org/two/';

      const { botText } = run(text);

      expect(botText).toBe(
        'Setup steps:\n[[1]](https://docs.ed-fi.org/one/) Open https://docs.ed-fi.org/one/\n[[2]](https://docs.ed-fi.org/two/) Check https://docs.ed-fi.org/two/',
      );
    });

    it('keeps a trailing list of steps even when the answer cites one of its numbers', () => {
      // Only [1] is cited earlier, so this is not evidence of a bibliography.
      const text =
        'Follow the cited guidance [1] to complete these steps:\n[1] Open https://docs.ed-fi.org/one/\n[2] Check https://docs.ed-fi.org/two/';

      const { botText } = run(text);

      expect(botText).toBe(
        'Follow the cited guidance [[1]](https://docs.ed-fi.org/one/) to complete these steps:\n[[1]](https://docs.ed-fi.org/one/) Open https://docs.ed-fi.org/one/\n[[2]](https://docs.ed-fi.org/two/) Check https://docs.ed-fi.org/two/',
      );
    });

    it('keeps an unheaded trailing list whose links are not search results', () => {
      const { botText } = run('See [1].\n\n[1] Read https://example.com/elsewhere');

      expect(botText).toBe(
        'See [[1]](https://docs.ed-fi.org/one/).\n\n[[1]](https://docs.ed-fi.org/one/) Read https://example.com/elsewhere',
      );
    });

    it('removes a whole headed list when one line names a page without a URL, leaving that marker unlinked', () => {
      const { botText, citationIndex, citedMarkers } = run(
        'A [1]. B [2]. C [3].\n\nSources:\n[1] [Four](https://docs.ed-fi.org/four/)\n[2] Ed-Fi docs home\n[3] [Two](https://docs.ed-fi.org/two/)',
      );

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/four/). B [2]. C [[3]](https://docs.ed-fi.org/two/).');
      expect(citationIndex).toEqual({
        1: 'https://docs.ed-fi.org/four/',
        3: 'https://docs.ed-fi.org/two/',
        4: 'https://docs.ed-fi.org/one/',
        5: 'https://docs.ed-fi.org/three/',
      });
      expect(citedMarkers).toEqual([1, 3]);
    });

    it('keeps an unheaded trailing list intact when one of its lines has no URL', () => {
      const text = 'A [1]. B [2].\n\n[1] [Four](https://docs.ed-fi.org/four/)\n[2] Ed-Fi docs home';

      const { botText } = run(text);

      expect(botText).toBe(
        'A [[1]](https://docs.ed-fi.org/one/). B [[2]](https://docs.ed-fi.org/two/).\n\n[[1]](https://docs.ed-fi.org/one/) [Four](https://docs.ed-fi.org/four/)\n[[2]](https://docs.ed-fi.org/two/) Ed-Fi docs home',
      );
    });

    it('keeps a headed list with no URLs at all, falling back to result-id linking', () => {
      const { botText } = run('A [1]. B [2].\n\nSources:\n[1] Ed-Fi docs home\n[2] Data Standard v5');

      expect(botText).toBe(
        'A [[1]](https://docs.ed-fi.org/one/). B [[2]](https://docs.ed-fi.org/two/).\n\nSources:\n[[1]](https://docs.ed-fi.org/one/) Ed-Fi docs home\n[[2]](https://docs.ed-fi.org/two/) Data Standard v5',
      );
    });

    it('keeps a list of steps under a References heading when none of its lines has a URL', () => {
      const { botText } = run('Do this.\n\nReferences:\n[1] Open the admin app\n[2] Click save');

      expect(botText).toBe(
        'Do this.\n\nReferences:\n[[1]](https://docs.ed-fi.org/one/) Open the admin app\n[[2]](https://docs.ed-fi.org/two/) Click save',
      );
    });

    it('keeps an unheaded trailing list whose URL-less line sits above the linked ones', () => {
      const { botText } = run('A [1]. B [2].\n\n[1] Ed-Fi docs home\n[2] [Four](https://docs.ed-fi.org/four/)');

      expect(botText).toBe(
        'A [[1]](https://docs.ed-fi.org/one/). B [[2]](https://docs.ed-fi.org/two/).\n\n[[1]](https://docs.ed-fi.org/one/) Ed-Fi docs home\n[[2]](https://docs.ed-fi.org/two/) [Four](https://docs.ed-fi.org/four/)',
      );
    });

    it('removes a whole headed list whose entries are separated by blank lines', () => {
      const { botText, citationIndex } = run(
        'A [1]. B [2].\n\nSources:\n\n[1] [Four](https://docs.ed-fi.org/four/)\n\n[2] [Two](https://docs.ed-fi.org/two/)',
      );

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/four/). B [[2]](https://docs.ed-fi.org/two/).');
      expect(citationIndex).toEqual({
        1: 'https://docs.ed-fi.org/four/',
        2: 'https://docs.ed-fi.org/two/',
        3: 'https://docs.ed-fi.org/one/',
        4: 'https://docs.ed-fi.org/three/',
      });
    });

    it('numbers uncited results right after the listed markers, ignoring a stray large bracketed number', () => {
      const { citationIndex } = run(
        'In school year [2026], A [1].\n\nSources\n[1] [Four](https://docs.ed-fi.org/four/)',
      );

      expect(citationIndex).toEqual({
        1: 'https://docs.ed-fi.org/four/',
        2: 'https://docs.ed-fi.org/one/',
        3: 'https://docs.ed-fi.org/two/',
        4: 'https://docs.ed-fi.org/three/',
      });
    });

    it('skips numbers already in the answer when numbering uncited results', () => {
      const { botText, citationIndex } = run('A [1]. Step [3].\n\nSources\n[1] [Four](https://docs.ed-fi.org/four/)');

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/four/). Step [3].');
      expect(citationIndex).toEqual({
        1: 'https://docs.ed-fi.org/four/',
        2: 'https://docs.ed-fi.org/one/',
        4: 'https://docs.ed-fi.org/two/',
        5: 'https://docs.ed-fi.org/three/',
      });
    });

    it('treats a headed list as the model list even when the answer cites none of it', () => {
      const { botText } = run('Some answer.\n\nSources\n[1] [Four](https://docs.ed-fi.org/four/)');

      expect(botText).toBe('Some answer.');
    });

    it('links a listed URL to the result with the same path case, not one differing only in case', () => {
      const { botText } = resolve('A [1].\n\n[1] [Upper](https://docs.ed-fi.org/Case)', [
        { id: 1, url: 'https://docs.ed-fi.org/Case' },
        { id: 2, url: 'https://docs.ed-fi.org/case' },
      ]);

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/Case).');
    });

    it('leaves a marker unlinked when its URL loosely matches more than one result', () => {
      const { botText } = resolve('A [1].\n\nSources\n[1] [X](http://docs.ed-fi.org/x)', [
        { id: 1, url: 'https://docs.ed-fi.org/x/' },
        { id: 2, url: 'https://www.docs.ed-fi.org/x' },
      ]);

      expect(botText).toBe('A [1].');
    });

    it('never emits Slack control syntax from a result URL in the inline link', () => {
      const { botText } = resolve('A [1].', [{ id: 1, url: 'https://docs.ed-fi.org/a><!here>' }]);

      expect(botText).toBe('A [[1]](https://docs.ed-fi.org/a%3E%3C!here%3E).');
      expect(botText).not.toContain('<!here>');
    });

    it('does not treat bracketed lines without URLs as a source list', () => {
      const { botText } = run('Steps:\n[1] Install the tools.\n[2] Run the setup [3].');

      expect(botText).toBe(
        'Steps:\n[[1]](https://docs.ed-fi.org/one/) Install the tools.\n[[2]](https://docs.ed-fi.org/two/) Run the setup [[3]](https://docs.ed-fi.org/three/).',
      );
    });
  });

  describe('result-id linking', () => {
    it('aliases a duplicate result id to the URL it shares', () => {
      const { citationIndex } = resolve('A [1]. Again [2].', [
        { id: 1, url: 'https://docs.ed-fi.org/a' },
        { id: 2, url: 'https://docs.ed-fi.org/a' },
        { id: 3, url: 'https://docs.ed-fi.org/c' },
      ]);

      expect(citationIndex).toEqual({
        1: 'https://docs.ed-fi.org/a',
        2: 'https://docs.ed-fi.org/a',
        3: 'https://docs.ed-fi.org/c',
      });
    });

    it('omits ambiguous ids, matching what the inline markers link', () => {
      const { botText, citationIndex } = resolve('A [1]. B [2].', [
        { id: 1, url: 'https://docs.ed-fi.org/a' },
        { id: 1, url: 'https://docs.ed-fi.org/b' },
        { id: 2, url: 'https://docs.ed-fi.org/c' },
      ]);

      expect(citationIndex).toEqual({ 2: 'https://docs.ed-fi.org/c' });
      expect(botText).toBe('A [1]. B [[2]](https://docs.ed-fi.org/c).');
    });
  });
});
