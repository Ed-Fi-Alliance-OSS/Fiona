// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { createKpiBucket, summarizeKpiBucket } from '../../lib/kpi-core.js';
import {
  ADOPTION_METRICS,
  formatDecimal,
  formatPercent,
  hasSegmentActivity,
  METRIC_DEFINITIONS,
  NO_DATA,
  RELIABILITY_METRICS,
  SEGMENTS_UNAVAILABLE_NOTE,
  segmentColumns,
  segmentFootnote,
  segmentLabel,
} from '../../lib/report-presentation.js';

const kpi = (overrides = {}) => ({ uniqueUsers: 0, totalInteractions: 0, feedbackTotal: 0, ...overrides });

describe('segmentLabel', () => {
  it('labels each segment and falls back to Unknown', () => {
    expect(segmentLabel('internal')).toBe('Internal');
    expect(segmentLabel('external')).toBe('External');
    expect(segmentLabel('unknown')).toBe('Unknown');
    expect(segmentLabel(undefined)).toBe('Unknown');
    expect(segmentLabel('other')).toBe('Unknown');
  });
});

describe('segmentFootnote', () => {
  it('explains Internal, and Unknown only when asked to', () => {
    expect(segmentFootnote(false)).toBe('Internal: @ed-fi.org email.');
    expect(segmentFootnote(true)).toBe(
      'Internal: @ed-fi.org email. Unknown: no usable email in the Slack user directory.',
    );
  });
});

describe('SEGMENTS_UNAVAILABLE_NOTE', () => {
  it('tells readers segments are missing and totals are shown', () => {
    expect(SEGMENTS_UNAVAILABLE_NOTE).toMatch(/unavailable/);
    expect(SEGMENTS_UNAVAILABLE_NOTE).toMatch(/totals only/);
  });
});

describe('formatPercent / formatDecimal', () => {
  it.each([null, undefined])('renders %p as the no-data dash', (value) => {
    expect(formatPercent(value)).toBe(NO_DATA);
    expect(formatDecimal(value)).toBe(NO_DATA);
    expect(NO_DATA).toBe('—');
  });

  it('formats numbers to one decimal place, including a real 0', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(66.666)).toBe('66.7%');
    expect(formatDecimal(0)).toBe('0.0');
    expect(formatDecimal(2.25)).toBe('2.3');
  });
});

describe('hasSegmentActivity', () => {
  it('is false for a missing or empty segment', () => {
    expect(hasSegmentActivity(undefined)).toBe(false);
    expect(hasSegmentActivity(null)).toBe(false);
    expect(hasSegmentActivity(kpi())).toBe(false);
  });

  it.each([
    { uniqueUsers: 1 },
    { totalInteractions: 1 },
    { feedbackTotal: 1 },
  ])('is true when %p is non-zero', (overrides) => {
    expect(hasSegmentActivity(kpi(overrides))).toBe(true);
  });
});

describe('segmentColumns', () => {
  const total = kpi({ uniqueUsers: 3 });
  const internal = kpi({ uniqueUsers: 2 });
  const external = kpi({ uniqueUsers: 1 });

  it('puts Total first and omits an inactive Unknown segment', () => {
    const columns = segmentColumns({ internal, external, unknown: kpi() }, total);
    expect(columns).toEqual([
      ['Total', total],
      ['Internal', internal],
      ['External', external],
    ]);
  });

  it('includes Unknown when it has activity', () => {
    const unknown = kpi({ totalInteractions: 4 });
    const columns = segmentColumns({ internal, external, unknown }, total);
    expect(columns.map(([label]) => label)).toEqual(['Total', 'Internal', 'External', 'Unknown']);
    expect(columns[3][1]).toBe(unknown);
  });
});

describe('metric rows', () => {
  const rows = (summary) =>
    [...ADOPTION_METRICS, ...RELIABILITY_METRICS].map(([label, value]) => [label, value(summary)]);

  it('render the no-data dash for null rates and 0 for counts', () => {
    const rendered = rows(summarizeKpiBucket(createKpiBucket(), () => true));
    expect(rendered).toContainEqual(['Unique users', 0]);
    expect(rendered).toContainEqual(['Errors', 0]);
    for (const label of [
      'New user %',
      'Repeat rate',
      'Avg per user',
      'Error rate',
      'Positive feedback',
      'Feedback response',
    ]) {
      expect(rendered).toContainEqual([label, NO_DATA]);
    }
  });

  it('format present rates and averages', () => {
    const rendered = rows({
      ...summarizeKpiBucket(createKpiBucket(), () => true),
      repeatRate: 50,
      avgInteractionsPerUser: 2,
      errorRate: 0,
    });
    expect(rendered).toContainEqual(['Repeat rate', '50.0%']);
    expect(rendered).toContainEqual(['Avg per user', '2.0']);
    expect(rendered).toContainEqual(['Error rate', '0.0%']);
  });

  it('have unique labels short enough for the Slack matrix', () => {
    const labels = [...ADOPTION_METRICS, ...RELIABILITY_METRICS].map(([label]) => label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.length).toBeLessThan(18);
  });
});

describe('METRIC_DEFINITIONS', () => {
  it('is a list of [term, definition] string pairs including the no-data dash', () => {
    for (const entry of METRIC_DEFINITIONS) {
      expect(entry).toHaveLength(2);
      expect(typeof entry[0]).toBe('string');
      expect(entry[1].length).toBeGreaterThan(0);
    }
    expect(METRIC_DEFINITIONS.map(([term]) => term)).toEqual(
      expect.arrayContaining(['Sessions', 'Feedback response', NO_DATA]),
    );
  });
});
