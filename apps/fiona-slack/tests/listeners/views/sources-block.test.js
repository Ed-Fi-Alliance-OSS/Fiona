// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { MetadataLifecycleState } from '../../../src/agent/llm-caller.js';
import {
  createSourcesBlocks,
  SLACK_SECTION_TEXT_LIMIT,
  SOURCES_BLOCK_BUDGET,
} from '../../../src/listeners/views/sources_block.js';

function makeMetadata(sources, citationIndex, finalizeState = MetadataLifecycleState.READY_TO_FINALIZE) {
  return { finalize_state: finalizeState, sources, citation_index: citationIndex };
}

function pages(count) {
  const sources = Array.from({ length: count }, (_, i) => ({
    url: `https://docs.ed-fi.org/page-${i + 1}`,
    id: i + 1,
    title: `Page ${i + 1}`,
  }));
  const citationIndex = Object.fromEntries(sources.map((s) => [s.id, s.url]));
  return { sources, citationIndex };
}

const textOf = (blocks) => blocks.map((block) => block.text.text).join('\n');

function expectWithinSectionLimit(blocks) {
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(block.text.text.length).toBeLessThanOrEqual(SLACK_SECTION_TEXT_LIMIT);
  }
}

describe('createSourcesBlocks', () => {
  it('renders a numbered Sources list with clickable titled links', () => {
    const { sources, citationIndex } = pages(2);

    const blocks = createSourcesBlocks(makeMetadata(sources, citationIndex));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
    expect(blocks[0].text.type).toBe('mrkdwn');
    expect(blocks[0].text.text).toBe(
      '*Sources*\n*[1]* <https://docs.ed-fi.org/page-1|Page 1>\n*[2]* <https://docs.ed-fi.org/page-2|Page 2>',
    );
  });

  it('shows the publication date when the source has one', () => {
    const blocks = createSourcesBlocks(
      makeMetadata([{ url: 'https://docs.ed-fi.org/a', title: 'A', date: '2025-04-01' }], {
        1: 'https://docs.ed-fi.org/a',
      }),
    );

    expect(textOf(blocks)).toContain('*[1]* <https://docs.ed-fi.org/a|A> · 2025-04-01');
  });

  it('renders all 15 sources of a typical Agent API answer, untruncated', () => {
    const { sources, citationIndex } = pages(15);

    const text = textOf(createSourcesBlocks(makeMetadata(sources, citationIndex)));

    for (let n = 1; n <= 15; n++) {
      expect(text).toContain(`*[${n}]* <https://docs.ed-fi.org/page-${n}|Page ${n}>`);
    }
    expect(text).not.toContain('more');
  });

  it('numbers entries by marker id, not array position', () => {
    const blocks = createSourcesBlocks(
      makeMetadata([{ url: 'https://docs.ed-fi.org/c', title: 'C' }], { 3: 'https://docs.ed-fi.org/c' }),
    );

    expect(textOf(blocks)).toBe('*Sources*\n*[3]* <https://docs.ed-fi.org/c|C>');
  });

  it('lists a duplicate-URL source once, under every marker number that cites it', () => {
    const blocks = createSourcesBlocks(
      makeMetadata(
        [
          { url: 'https://docs.ed-fi.org/a', title: 'A' },
          { url: 'https://docs.ed-fi.org/c', title: 'C' },
        ],
        { 1: 'https://docs.ed-fi.org/a', 2: 'https://docs.ed-fi.org/a', 3: 'https://docs.ed-fi.org/c' },
      ),
    );

    expect(textOf(blocks)).toBe('*Sources*\n*[1, 2]* <https://docs.ed-fi.org/a|A>\n*[3]* <https://docs.ed-fi.org/c|C>');
  });

  it('omits sources no marker number resolves to', () => {
    const blocks = createSourcesBlocks(
      makeMetadata(
        [
          { url: 'https://docs.ed-fi.org/a', title: 'A' },
          { url: 'https://docs.ed-fi.org/b', title: 'B' },
        ],
        { 2: 'https://docs.ed-fi.org/b' },
      ),
    );

    expect(textOf(blocks)).toBe('*Sources*\n*[2]* <https://docs.ed-fi.org/b|B>');
  });

  it('escapes Slack control characters in titles so links cannot break', () => {
    const blocks = createSourcesBlocks(
      makeMetadata([{ url: 'https://docs.ed-fi.org/a', title: 'Q&A <draft> | notes' }], {
        1: 'https://docs.ed-fi.org/a',
      }),
    );

    expect(textOf(blocks)).toContain('<https://docs.ed-fi.org/a|Q&amp;A &lt;draft&gt; | notes>');
  });

  it('splits long lists across section blocks within the Slack text limit', () => {
    const sources = Array.from({ length: 15 }, (_, i) => ({
      url: `https://docs.ed-fi.org/${'segment/'.repeat(20)}page-${i + 1}`,
      title: `${'Very long documentation title '.repeat(5)}${i + 1}`,
    }));
    const citationIndex = Object.fromEntries(sources.map((s, i) => [i + 1, s.url]));

    const blocks = createSourcesBlocks(makeMetadata(sources, citationIndex));

    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.text.text.length).toBeLessThanOrEqual(SLACK_SECTION_TEXT_LIMIT);
    }
    const text = textOf(blocks);
    for (let n = 1; n <= 15; n++) {
      expect(text).toContain(`*[${n}]* `);
    }
    expect(text.match(/\*Sources\*/g)).toHaveLength(1);
  });

  it('keeps a source whose linked entry alone exceeds the section limit, unlinked', () => {
    const url = `https://docs.ed-fi.org/${'a'.repeat(3100)}`;

    const blocks = createSourcesBlocks(makeMetadata([{ url, title: 'Huge', date: '2025-04-01' }], { 1: url }));

    for (const block of blocks) {
      expect(block.text.text.length).toBeLessThanOrEqual(SLACK_SECTION_TEXT_LIMIT);
    }
    expect(textOf(blocks)).toContain('*[1]* Huge (docs.ed-fi.org) · 2025-04-01');
  });

  it('keeps an entry within the section limit when its date is oversized', () => {
    const blocks = createSourcesBlocks(
      makeMetadata([{ url: 'https://docs.ed-fi.org/a', title: 'A', date: 'x'.repeat(3100) }], {
        1: 'https://docs.ed-fi.org/a',
      }),
    );

    expectWithinSectionLimit(blocks);
    // Capping the date lets the entry keep its link.
    expect(textOf(blocks)).toContain(`*[1]* <https://docs.ed-fi.org/a|A> · ${'x'.repeat(39)}…`);
  });

  it('collapses runs of three or more marker numbers into a range', () => {
    const url = 'https://docs.ed-fi.org/a';
    const citationIndex = Object.fromEntries([1, 2, 3, 5, 7, 8].map((n) => [n, url]));

    const blocks = createSourcesBlocks(makeMetadata([{ url, title: 'A' }], citationIndex));

    expect(textOf(blocks)).toContain('*[1–3, 5, 7, 8]* <https://docs.ed-fi.org/a|A>');
  });

  it('lists every marker of a URL with 1,000 aliases, within the section limit', () => {
    const url = 'https://docs.ed-fi.org/a';
    const citationIndex = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [i + 1, url]));

    const blocks = createSourcesBlocks(makeMetadata([{ url, title: 'A' }], citationIndex));

    expectWithinSectionLimit(blocks);
    expect(textOf(blocks)).toContain('*[1–1000]* <https://docs.ed-fi.org/a|A>');
  });

  describe('when the list overflows the block budget', () => {
    // Each ~1,600-character linked entry needs its own section, so 60 of them
    // would be 60 blocks without a budget, past Slack's 50-block message limit.
    function unpackable(count) {
      const sources = Array.from({ length: count }, (_, i) => ({
        url: `https://docs.ed-fi.org/${String(i + 1).padStart(1600, 'x')}`,
        title: `Page ${i + 1}`,
      }));
      const citationIndex = Object.fromEntries(sources.map((s, i) => [i + 1, s.url]));
      return { sources, citationIndex };
    }

    it('keeps every cited source and drops only uncited ones, saying so', () => {
      const { sources, citationIndex } = unpackable(60);

      const blocks = createSourcesBlocks({ ...makeMetadata(sources, citationIndex), cited_markers: [1, 60] });

      expect(blocks.length).toBeLessThanOrEqual(SOURCES_BLOCK_BUDGET);
      expectWithinSectionLimit(blocks);
      const text = textOf(blocks);
      expect(text).toContain('*[1]* ');
      expect(text).toContain('*[60]* ');
      expect(text.match(/\*\[\d+\]\* /g)).toHaveLength(2);
      expect(text.startsWith('*Cited in this answer*\n')).toBe(true);
      expect(text).not.toContain('Also retrieved');
      expect(blocks.at(-1).text.text).toBe('_+58 more sources not cited in this answer_');
    });

    it('lists every cited source, unlinked if need be, when the cited ones alone overflow', () => {
      const { sources, citationIndex } = unpackable(60);
      const citedMarkers = Array.from({ length: 60 }, (_, i) => i + 1);

      const blocks = createSourcesBlocks({ ...makeMetadata(sources, citationIndex), cited_markers: citedMarkers });

      expect(blocks.length).toBeLessThanOrEqual(SOURCES_BLOCK_BUDGET);
      expectWithinSectionLimit(blocks);
      const text = textOf(blocks);
      for (let n = 1; n <= 60; n++) {
        expect(text).toContain(`*[${n}]* Page ${n} (docs.ed-fi.org)`);
      }
      expect(text).not.toContain('more sources');
    });

    it('counts exactly the cited sources it cannot list, past the ceiling', () => {
      // Far beyond any real answer (measured: 15 results). The block cannot
      // hold 1,200 entries, so the note must account for every one left out.
      const { sources, citationIndex } = unpackable(1200);
      const citedMarkers = Array.from({ length: 1200 }, (_, i) => i + 1);

      const blocks = createSourcesBlocks({ ...makeMetadata(sources, citationIndex), cited_markers: citedMarkers });

      expect(blocks.length).toBeLessThanOrEqual(SOURCES_BLOCK_BUDGET);
      expectWithinSectionLimit(blocks);
      const listed = textOf(blocks).match(/\*\[\d+\]\* /g).length;
      expect(textOf(blocks)).toContain('*[1]* ');
      expect(blocks.at(-1).text.text).toBe(`_+${1200 - listed} more cited sources not shown_`);
    });

    it('counts cited and uncited omissions separately past the ceiling', () => {
      const { sources, citationIndex } = unpackable(1300);
      const citedMarkers = Array.from({ length: 1200 }, (_, i) => i + 1);

      const blocks = createSourcesBlocks({ ...makeMetadata(sources, citationIndex), cited_markers: citedMarkers });

      expect(blocks.length).toBeLessThanOrEqual(SOURCES_BLOCK_BUDGET);
      const listed = textOf(blocks).match(/\*\[\d+\]\* /g).length;
      expect(blocks.at(-1).text.text).toBe(
        `_+${1200 - listed} more cited sources not shown, plus 100 not cited in this answer_`,
      );
    });

    it('treats every source as cited when the answer cites none of them', () => {
      const { sources, citationIndex } = unpackable(60);

      const blocks = createSourcesBlocks({ ...makeMetadata(sources, citationIndex), cited_markers: [] });

      expect(blocks.length).toBeLessThanOrEqual(SOURCES_BLOCK_BUDGET);
      expect(textOf(blocks).match(/\*\[\d+\]\* /g)).toHaveLength(60);
      expect(textOf(blocks).startsWith('*Sources*')).toBe(true);
    });

    it('treats every source as cited when the cited markers are unknown', () => {
      const { sources, citationIndex } = unpackable(60);

      const blocks = createSourcesBlocks(makeMetadata(sources, citationIndex));

      expect(blocks.length).toBeLessThanOrEqual(SOURCES_BLOCK_BUDGET);
      expect(textOf(blocks).match(/\*\[\d+\]\* /g)).toHaveLength(60);
    });
  });

  describe('cited vs retrieved split', () => {
    const withCited = (metadata, citedMarkers) => ({ ...metadata, cited_markers: citedMarkers });

    it('lists cited sources first, then the other retrieved sources, under their own headings', () => {
      const { sources, citationIndex } = pages(4);

      const blocks = createSourcesBlocks(withCited(makeMetadata(sources, citationIndex), [2, 3]));

      expect(textOf(blocks)).toBe(
        [
          '*Cited in this answer*',
          '*[2]* <https://docs.ed-fi.org/page-2|Page 2>',
          '*[3]* <https://docs.ed-fi.org/page-3|Page 3>',
          '*Also retrieved*',
          '*[1]* <https://docs.ed-fi.org/page-1|Page 1>',
          '*[4]* <https://docs.ed-fi.org/page-4|Page 4>',
        ].join('\n'),
      );
    });

    it('omits the retrieved heading when every source is cited', () => {
      const { sources, citationIndex } = pages(2);

      const text = textOf(createSourcesBlocks(withCited(makeMetadata(sources, citationIndex), [1, 2])));

      expect(text.startsWith('*Cited in this answer*\n')).toBe(true);
      expect(text).not.toContain('Also retrieved');
    });

    it('falls back to a single Sources list when the answer cites nothing', () => {
      const { sources, citationIndex } = pages(2);

      const text = textOf(createSourcesBlocks(withCited(makeMetadata(sources, citationIndex), [])));

      expect(text).toBe(
        '*Sources*\n*[1]* <https://docs.ed-fi.org/page-1|Page 1>\n*[2]* <https://docs.ed-fi.org/page-2|Page 2>',
      );
    });

    it('lists a duplicate-URL source as cited when any of its numbers is cited', () => {
      const metadata = makeMetadata(
        [
          { url: 'https://docs.ed-fi.org/a', title: 'A' },
          { url: 'https://docs.ed-fi.org/c', title: 'C' },
        ],
        { 1: 'https://docs.ed-fi.org/a', 2: 'https://docs.ed-fi.org/a', 3: 'https://docs.ed-fi.org/c' },
      );

      const text = textOf(createSourcesBlocks(withCited(metadata, [2])));

      expect(text).toBe(
        '*Cited in this answer*\n*[1, 2]* <https://docs.ed-fi.org/a|A>\n*Also retrieved*\n*[3]* <https://docs.ed-fi.org/c|C>',
      );
    });

    it('keeps each heading once and every section within the limit when the split spans sections', () => {
      const sources = Array.from({ length: 15 }, (_, i) => ({
        url: `https://docs.ed-fi.org/${'segment/'.repeat(20)}page-${i + 1}`,
        title: `${'Very long documentation title '.repeat(5)}${i + 1}`,
      }));
      const citationIndex = Object.fromEntries(sources.map((s, i) => [i + 1, s.url]));

      const blocks = createSourcesBlocks(withCited(makeMetadata(sources, citationIndex), [1, 2, 3, 4, 5, 6, 7, 8]));

      expect(blocks.length).toBeGreaterThan(1);
      expectWithinSectionLimit(blocks);
      const text = textOf(blocks);
      expect(text.match(/\*Cited in this answer\*/g)).toHaveLength(1);
      expect(text.match(/\*Also retrieved\*/g)).toHaveLength(1);
      expect(text.indexOf('*[8]* ')).toBeLessThan(text.indexOf('*Also retrieved*'));
      expect(text.indexOf('*Also retrieved*')).toBeLessThan(text.indexOf('*[9]* '));
    });
  });

  it('adds no overflow note when every source fits the budget', () => {
    const { sources, citationIndex } = pages(15);

    expect(textOf(createSourcesBlocks(makeMetadata(sources, citationIndex)))).not.toContain('more sources');
  });

  it('renders nothing when there are no resolvable sources', () => {
    expect(createSourcesBlocks(makeMetadata([], {}))).toEqual([]);
  });

  it('renders nothing when metadata is missing', () => {
    expect(createSourcesBlocks(null)).toEqual([]);
    expect(createSourcesBlocks(undefined)).toEqual([]);
  });

  it('renders nothing when metadata degraded instead of becoming ready', () => {
    const { sources, citationIndex } = pages(3);

    const blocks = createSourcesBlocks(
      makeMetadata(sources, citationIndex, MetadataLifecycleState.DEGRADED_NO_METADATA),
    );

    expect(blocks).toEqual([]);
  });

  it('renders nothing while metadata is still being collected', () => {
    const { sources, citationIndex } = pages(3);

    const blocks = createSourcesBlocks(
      makeMetadata(sources, citationIndex, MetadataLifecycleState.COLLECTING_METADATA),
    );

    expect(blocks).toEqual([]);
  });
});
