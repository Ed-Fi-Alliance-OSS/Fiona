// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import {
  computeLabelStep,
  computePieSlices,
  drawBarChart,
  drawPieChart,
  drawStackedBarChart,
} from '../../../lib/pdf/charts.js';

const makeMockDoc = () => {
  const doc = {};
  const chainable = ['rect', 'fill', 'fillColor', 'strokeColor', 'font', 'fontSize', 'path', 'lineWidth'];
  for (const method of chainable) {
    doc[method] = jest.fn().mockReturnValue(doc);
  }
  doc.text = jest.fn().mockReturnValue(doc);
  return doc;
};

describe('drawBarChart', () => {
  it('scales bar heights proportionally to the max value in the dataset', () => {
    const doc = makeMockDoc();

    drawBarChart(doc, { x: 0, y: 0, width: 100, height: 50, data: [10, 20, 5], labels: ['a', 'b', 'c'] });

    const rectCalls = doc.rect.mock.calls;
    expect(rectCalls).toHaveLength(3);

    const heights = rectCalls.map(([, , , h]) => h);
    // tallest bar (20) should be exactly double the height of the 10-value bar
    expect(heights[1]).toBeCloseTo(heights[0] * 2, 5);
    // 5-value bar should be half the height of the 10-value bar
    expect(heights[2]).toBeCloseTo(heights[0] * 0.5, 5);
  });

  it('draws no bars and does not throw when data is empty', () => {
    const doc = makeMockDoc();

    expect(() => drawBarChart(doc, { x: 0, y: 0, width: 100, height: 50, data: [] })).not.toThrow();
    expect(doc.rect).not.toHaveBeenCalled();
  });

  it('draws zero-height bars (not NaN) when all values are zero', () => {
    const doc = makeMockDoc();

    drawBarChart(doc, { x: 0, y: 0, width: 100, height: 50, data: [0, 0] });

    for (const [, , , h] of doc.rect.mock.calls) {
      expect(h).toBe(0);
    }
  });

  it('renders a title and per-bar labels when provided', () => {
    const doc = makeMockDoc();

    drawBarChart(doc, { x: 0, y: 0, width: 100, height: 50, data: [1, 2], labels: ['Mon', 'Tue'], title: 'My Chart' });

    expect(doc.text).toHaveBeenCalledWith('My Chart', expect.any(Number), expect.any(Number), expect.any(Object));
    expect(doc.text).toHaveBeenCalledWith('Mon', expect.any(Number), expect.any(Number), expect.any(Object));
    expect(doc.text).toHaveBeenCalledWith('Tue', expect.any(Number), expect.any(Number), expect.any(Object));
  });

  it('thins labels to stay legible when there are far more bars than fit', () => {
    const doc = makeMockDoc();
    const count = 60;
    const data = Array.from({ length: count }, (_, i) => i + 1);
    const labels = Array.from({ length: count }, (_, i) => `d${i}`);

    drawBarChart(doc, { x: 0, y: 0, width: 300, height: 50, data, labels });

    expect(doc.rect).toHaveBeenCalledTimes(count); // every bar still drawn
    const labelCalls = doc.text.mock.calls.filter(([text]) => /^d\d+$/.test(text));
    expect(labelCalls.length).toBeLessThanOrEqual(15);
    expect(labelCalls.length).toBeGreaterThan(0);
    // rendered labels always include the first bar's label
    expect(labelCalls.some(([text]) => text === 'd0')).toBe(true);
  });
});

describe('computeLabelStep', () => {
  it('returns 1 (render every label) when count is within the legible max', () => {
    expect(computeLabelStep(9)).toBe(1);
    expect(computeLabelStep(15)).toBe(1);
  });

  it('returns a step that thins count down to roughly maxLabels', () => {
    expect(computeLabelStep(60)).toBe(4); // ceil(60/15)
    expect(computeLabelStep(30, 10)).toBe(3);
  });
});

describe('drawStackedBarChart', () => {
  it('stacks each series segment on top of the prior one, scaled by the combined max total', () => {
    const doc = makeMockDoc();

    drawStackedBarChart(doc, {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      series: [
        { label: 'Good', data: [8, 2], color: '#2e8b57' },
        { label: 'Bad', data: [2, 0], color: '#ff6347' },
      ],
    });

    // 2 categories x 2 series = 4 bar-segment rects, plus 2 legend swatch rects
    expect(doc.rect).toHaveBeenCalledTimes(6);

    const rectCalls = doc.rect.mock.calls;
    // call order per category: series[0] (Good) then series[1] (Bad) -> category 0 is calls 0 and 1
    const goodBar0 = rectCalls[0];
    const badBar0 = rectCalls[1];
    const [, goodY] = goodBar0;
    const [, badY, , badH] = badBar0;
    expect(badY + badH).toBeCloseTo(goodY, 5); // bad segment sits directly on top of good segment
  });

  it('draws a legend entry per series', () => {
    const doc = makeMockDoc();

    drawStackedBarChart(doc, {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      series: [
        { label: 'Good', data: [1], color: '#2e8b57' },
        { label: 'Bad', data: [1], color: '#ff6347' },
      ],
    });

    expect(doc.text).toHaveBeenCalledWith(expect.stringContaining('Good'), expect.any(Number), expect.any(Number));
    expect(doc.text).toHaveBeenCalledWith(expect.stringContaining('Bad'), expect.any(Number), expect.any(Number));
  });
});

describe('computePieSlices', () => {
  it('computes cumulative start/end angles and percentages proportional to value', () => {
    const result = computePieSlices([
      { label: 'Good', value: 75, color: '#2e8b57' },
      { label: 'Bad', value: 25, color: '#ff6347' },
    ]);

    expect(result[0]).toMatchObject({ pct: 75, startAngle: 0, endAngle: 270 });
    expect(result[1]).toMatchObject({ pct: 25, startAngle: 270, endAngle: 360 });
  });

  it('returns 0% slices without dividing by zero when total value is 0', () => {
    const result = computePieSlices([
      { label: 'Good', value: 0, color: '#2e8b57' },
      { label: 'Bad', value: 0, color: '#ff6347' },
    ]);

    expect(result[0].pct).toBe(0);
    expect(result[1].pct).toBe(0);
  });
});

describe('drawPieChart', () => {
  it('draws one path per non-zero slice and a legend entry per slice', () => {
    const doc = makeMockDoc();

    drawPieChart(doc, {
      x: 0,
      y: 0,
      radius: 20,
      slices: [
        { label: 'Good', value: 75, color: '#2e8b57' },
        { label: 'Bad', value: 25, color: '#ff6347' },
      ],
      title: 'Feedback Distribution',
    });

    expect(doc.path).toHaveBeenCalledTimes(2);
    expect(doc.text).toHaveBeenCalledWith(expect.stringContaining('Good'), expect.any(Number), expect.any(Number));
    expect(doc.text).toHaveBeenCalledWith(expect.stringContaining('Bad'), expect.any(Number), expect.any(Number));
    expect(doc.text).toHaveBeenCalledWith(
      'Feedback Distribution',
      expect.any(Number),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it('skips drawing a path for zero-value slices', () => {
    const doc = makeMockDoc();

    drawPieChart(doc, {
      x: 0,
      y: 0,
      radius: 20,
      slices: [
        { label: 'Good', value: 0, color: '#2e8b57' },
        { label: 'Bad', value: 0, color: '#ff6347' },
      ],
    });

    expect(doc.path).not.toHaveBeenCalled();
  });
});
