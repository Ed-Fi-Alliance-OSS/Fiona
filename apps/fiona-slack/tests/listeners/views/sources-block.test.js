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

  it('stays within the block budget when entries cannot be packed, noting what is left out', () => {
    // Each ~1,600-character entry needs its own section, so 60 of them would
    // be 60 blocks without a budget, past Slack's 50-block message limit.
    const sources = Array.from({ length: 60 }, (_, i) => ({
      url: `https://docs.ed-fi.org/${String(i + 1).padStart(1600, 'x')}`,
      title: `Page ${i + 1}`,
    }));
    const citationIndex = Object.fromEntries(sources.map((s, i) => [i + 1, s.url]));

    const blocks = createSourcesBlocks(makeMetadata(sources, citationIndex));

    expect(blocks.length).toBeLessThanOrEqual(SOURCES_BLOCK_BUDGET);
    for (const block of blocks) {
      expect(block.text.text.length).toBeLessThanOrEqual(SLACK_SECTION_TEXT_LIMIT);
    }
    const listed = textOf(blocks).match(/\*\[\d+\]\* /g).length;
    expect(blocks.at(-1).text.text).toBe(`_+${60 - listed} more sources, linked inline in the answer above_`);
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
