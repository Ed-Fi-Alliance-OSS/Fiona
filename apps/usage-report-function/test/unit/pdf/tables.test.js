// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import { drawTable } from '../../../lib/pdf/tables.js';

const makeMockDoc = () => {
  const doc = {};
  const chainable = ['rect', 'fill', 'fillColor', 'strokeColor', 'font', 'fontSize', 'lineWidth', 'stroke'];
  for (const method of chainable) {
    doc[method] = jest.fn().mockReturnValue(doc);
  }
  doc.text = jest.fn().mockReturnValue(doc);
  doc.heightOfString = jest.fn().mockReturnValue(10);
  return doc;
};

describe('drawTable', () => {
  it('returns the total rendered height (header + all rows)', () => {
    const doc = makeMockDoc();

    const height = drawTable(doc, {
      x: 0,
      y: 0,
      width: 200,
      columns: [
        { key: 'a', header: 'A', weight: 1 },
        { key: 'b', header: 'B', weight: 1 },
      ],
      rows: [
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ],
    });

    expect(height).toBeGreaterThan(0);
  });

  it('sizes columns proportional to their weight', () => {
    const doc = makeMockDoc();

    drawTable(doc, {
      x: 0,
      y: 0,
      width: 300,
      columns: [
        { key: 'a', header: 'A', weight: 2 },
        { key: 'b', header: 'B', weight: 1 },
      ],
      rows: [{ a: 'x', b: 'y' }],
    });

    // weight 2:1 over width 300 -> column A starts at x=0, column B starts at x=200
    const textCalls = doc.text.mock.calls;
    const headerA = textCalls.find(([text]) => text === 'A');
    const headerB = textCalls.find(([text]) => text === 'B');
    expect(headerA[1]).toBeCloseTo(0 + 3, 1); // x + CELL_PADDING
    expect(headerB[1]).toBeCloseTo(200 + 3, 1);
  });

  it('applies banded row background colors alternating by row index', () => {
    const doc = makeMockDoc();

    drawTable(doc, {
      x: 0,
      y: 0,
      width: 100,
      columns: [{ key: 'a', header: 'A', weight: 1 }],
      rows: [{ a: '1' }, { a: '2' }, { a: '3' }],
      bandColors: ['#ffffff', '#f5f7fa'],
    });

    const fillCalls = doc.fill.mock.calls.map(([color]) => color);
    expect(fillCalls).toContain('#ffffff');
    expect(fillCalls).toContain('#f5f7fa');
  });

  it('renders "No data available" when rows is empty', () => {
    const doc = makeMockDoc();

    drawTable(doc, {
      x: 0,
      y: 0,
      width: 100,
      columns: [{ key: 'a', header: 'A', weight: 1 }],
      rows: [],
    });

    expect(doc.text).toHaveBeenCalledWith(
      'No data available',
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('hard-caps cell text length as a safety net for the configured limit', () => {
    const doc = makeMockDoc();
    const longText = 'x'.repeat(300);

    drawTable(doc, {
      x: 0,
      y: 0,
      width: 100,
      columns: [{ key: 'a', header: 'A', weight: 1, truncate: 10 }],
      rows: [{ a: longText }],
    });

    const textCalls = doc.text.mock.calls.map(([text]) => text);
    expect(textCalls.some((t) => t === 'x'.repeat(10))).toBe(true);
  });

  it('renders data cells as single-line with pdfkit ellipsis truncation, not manual wrapping', () => {
    const doc = makeMockDoc();

    drawTable(doc, {
      x: 0,
      y: 0,
      width: 100,
      columns: [{ key: 'a', header: 'A', weight: 1 }],
      rows: [{ a: 'some value' }],
    });

    const dataCall = doc.text.mock.calls.find(([text]) => text === 'some value');
    expect(dataCall).toBeDefined();
    const [, , , options] = dataCall;
    expect(options.ellipsis).toBe(true);
    expect(options.height).toBeGreaterThan(0);
  });

  it('caps rendered rows at maxRows', () => {
    const doc = makeMockDoc();

    drawTable(doc, {
      x: 0,
      y: 0,
      width: 100,
      columns: [{ key: 'a', header: 'A', weight: 1 }],
      rows: Array.from({ length: 20 }, (_, i) => ({ a: String(i) })),
      maxRows: 5,
    });

    const textCalls = doc.text.mock.calls.map(([text]) => text);
    // header 'A' + 5 data rows
    expect(textCalls.filter((t) => /^\d+$/.test(t))).toHaveLength(5);
  });
});
