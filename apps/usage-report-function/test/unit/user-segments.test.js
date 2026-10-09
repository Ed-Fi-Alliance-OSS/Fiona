// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import {
  getUserDirectory,
  hasSegmentActivity,
  segmentColumns,
  segmentForEmail,
  segmentLabel,
  segmentOf,
  tryGetUserDirectory,
} from '../../lib/user-segments.js';

function container(resources) {
  return { items: { query: jest.fn(() => ({ fetchAll: async () => ({ resources }) })) } };
}

const kpi = (overrides = {}) => ({
  uniqueUsers: 0,
  totalInteractions: 0,
  goodFeedback: 0,
  badFeedback: 0,
  ...overrides,
});

describe('segmentForEmail', () => {
  it('classifies by exact, case-insensitive domain and treats unusable emails as unknown', () => {
    expect(segmentForEmail('  Person@ED-FI.ORG  ')).toBe('internal');
    expect(segmentForEmail('member@sub.ed-fi.org')).toBe('external');
    expect(segmentForEmail('person@outside.org')).toBe('external');
    expect(segmentForEmail('not-an-email')).toBe('unknown');
    expect(segmentForEmail('')).toBe('unknown');
    expect(segmentForEmail(null)).toBe('unknown');
  });
});

describe('getUserDirectory', () => {
  it('maps user IDs to segments only, never emails', async () => {
    const users = container([
      { id: 'a', email: '  Person@ED-FI.ORG  ' },
      { id: 'b', email: 'member@sub.ed-fi.org' },
      { id: 'c', email: '' },
    ]);
    const directory = await getUserDirectory(users, ['a', 'b', 'c', 'missing', 'a', null]);
    expect([...directory.entries()]).toEqual([
      ['a', 'internal'],
      ['b', 'external'],
      ['c', 'unknown'],
    ]);
    expect(users.items.query.mock.calls[0][0].parameters[0].value).toEqual(['a', 'b', 'c', 'missing']);
  });

  it('skips the query when there are no user IDs', async () => {
    const users = container([]);
    expect((await getUserDirectory(users, [])).size).toBe(0);
    expect(users.items.query).not.toHaveBeenCalled();
  });
});

describe('segmentOf', () => {
  it('falls back to unknown for users missing from the directory or a null directory', () => {
    const directory = new Map([['a', 'internal']]);
    expect(segmentOf(directory, 'a')).toBe('internal');
    expect(segmentOf(directory, 'missing')).toBe('unknown');
    expect(segmentOf(null, 'a')).toBe('unknown');
  });
});

describe('tryGetUserDirectory', () => {
  it('returns null without querying when no users container is configured', async () => {
    const warn = jest.fn();
    expect(await tryGetUserDirectory(undefined, ['a'], warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns null and warns when the directory query fails', async () => {
    const warn = jest.fn();
    const users = { items: { query: jest.fn(() => ({ fetchAll: jest.fn().mockRejectedValue(new Error('403')) })) } };
    expect(await tryGetUserDirectory(users, ['a'], warn)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it('returns the directory when the query succeeds', async () => {
    const directory = await tryGetUserDirectory(container([{ id: 'a', email: 'x@ed-fi.org' }]), ['a']);
    expect(directory.get('a')).toBe('internal');
  });
});

describe('segmentLabel', () => {
  it('labels known segments and defaults anything else to Unknown', () => {
    expect(segmentLabel('internal')).toBe('Internal');
    expect(segmentLabel('external')).toBe('External');
    expect(segmentLabel('unknown')).toBe('Unknown');
    expect(segmentLabel(undefined)).toBe('Unknown');
  });
});

describe('hasSegmentActivity', () => {
  it('is true when a segment has users, interactions or ratings', () => {
    expect(hasSegmentActivity(kpi())).toBe(false);
    expect(hasSegmentActivity(kpi({ uniqueUsers: 1 }))).toBe(true);
    expect(hasSegmentActivity(kpi({ totalInteractions: 1 }))).toBe(true);
    expect(hasSegmentActivity(kpi({ badFeedback: 1 }))).toBe(true);
  });
});

describe('segmentColumns', () => {
  const total = kpi({ uniqueUsers: 3 });

  it('omits the Unknown column when Unknown has no activity', () => {
    const segments = { internal: kpi({ uniqueUsers: 1 }), external: kpi({ uniqueUsers: 2 }), unknown: kpi() };
    expect(segmentColumns(segments, total)).toEqual([
      ['Internal', segments.internal],
      ['External', segments.external],
      ['Total', total],
    ]);
  });

  it('includes the Unknown column when Unknown has activity', () => {
    const segments = { internal: kpi(), external: kpi(), unknown: kpi({ goodFeedback: 1 }) };
    expect(segmentColumns(segments, total).map(([label]) => label)).toEqual([
      'Internal',
      'External',
      'Unknown',
      'Total',
    ]);
  });
});
