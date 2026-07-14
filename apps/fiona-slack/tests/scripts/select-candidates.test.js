// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('node:child_process', () => ({
  spawnSync: jest.fn(),
}));

let spawnSync, buildClassificationPrompt, classifyViaCli, selectCandidates;

beforeEach(async () => {
  jest.resetModules();
  ({ spawnSync } = await import('node:child_process'));
  ({ buildClassificationPrompt, classifyViaCli, selectCandidates } = await import(
    '../../scripts/select-candidates.js'
  ));
});

describe('buildClassificationPrompt', () => {
  it('includes all candidate IDs and userMessages', () => {
    const candidates = [
      { id: 'id1', userMessage: 'How do descriptors work?' },
      { id: 'id2', userMessage: 'What is OAuth?' },
    ];
    const prompt = buildClassificationPrompt(candidates);
    expect(prompt).toContain('id1');
    expect(prompt).toContain('How do descriptors work?');
    expect(prompt).toContain('id2');
    expect(prompt).toContain('What is OAuth?');
  });
});

describe('classifyViaCli', () => {
  it('returns structured_output from claude CLI JSON envelope', () => {
    const mockOutput = [{ id: 'id1', topic: 'Descriptors', clarity: 5, isStandalone: true }];
    spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ structured_output: mockOutput }),
      stderr: '',
      error: null,
    });

    const result = classifyViaCli('some prompt');
    expect(result).toEqual(mockOutput);
  });

  it('throws when claude CLI exits with non-zero status', () => {
    spawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'error: not authenticated',
      error: null,
    });

    expect(() => classifyViaCli('prompt')).toThrow('claude CLI failed');
  });

  it('throws when spawnSync returns an error (CLI not found)', () => {
    spawnSync.mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn claude ENOENT'),
    });

    expect(() => classifyViaCli('prompt')).toThrow();
  });

  it('passes --model flag to the claude CLI', () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ structured_output: [] }),
      stderr: '',
      error: null,
    });

    classifyViaCli('prompt', { model: 'sonnet' });
    const args = spawnSync.mock.calls[0][1];
    expect(args).toContain('sonnet');
  });
});

describe('selectCandidates', () => {
  const makeRaw = (id, overrides = {}) => ({
    id,
    hasBadFeedback: false,
    timestamp: '2026-07-01T00:00:00Z',
    ...overrides,
  });

  const makeClassified = (id, overrides = {}) => ({
    id,
    topic: 'Descriptors',
    clarity: 4,
    isStandalone: true,
    ...overrides,
  });

  it('fills up to floor(count * 0.3) slots from bad-feedback pool', () => {
    const ids = ['bf1', 'bf2', 'bf3', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
    const rawMap = new Map(
      ids.map((id, i) => [id, makeRaw(id, { hasBadFeedback: i < 3, timestamp: `2026-07-0${i + 1}T00:00:00Z` })]),
    );
    const classified = ids.map((id, i) =>
      makeClassified(id, { topic: `Topic${i}`, ...(i < 3 ? {} : {}) }),
    );

    const selected = selectCandidates(classified, rawMap, 10);
    const badSelected = selected.filter((c) => rawMap.get(c.id)?.hasBadFeedback);
    expect(badSelected.length).toBe(Math.floor(10 * 0.3));
    expect(selected.length).toBe(10);
  });

  it('excludes bad-feedback candidates with clarity < 3 from Pool A', () => {
    const rawMap = new Map([
      ['bf_low', makeRaw('bf_low', { hasBadFeedback: true })],
      ...['r1', 'r2', 'r3', 'r4'].map((id) => [id, makeRaw(id)]),
    ]);
    const classified = [
      makeClassified('bf_low', { clarity: 2 }),
      ...['r1', 'r2', 'r3', 'r4'].map((id, i) => makeClassified(id, { topic: `T${i}` })),
    ];

    const selected = selectCandidates(classified, rawMap, 4);
    expect(selected.every((c) => c.id !== 'bf_low')).toBe(true);
  });

  it('distributes Pool B across different topics', () => {
    const rawMap = new Map(
      ['a1', 'b1', 'c1'].map((id) => [id, makeRaw(id)]),
    );
    const classified = [
      makeClassified('a1', { topic: 'Authorization Strategies' }),
      makeClassified('b1', { topic: 'Descriptors' }),
      makeClassified('c1', { topic: 'ODS/API Setup' }),
    ];

    const selected = selectCandidates(classified, rawMap, 3);
    const topics = new Set(selected.map((c) => c.topic));
    expect(topics.size).toBe(3);
  });

  it('prefers isStandalone:true over isStandalone:false at equal clarity', () => {
    const rawMap = new Map([
      ['ctx', makeRaw('ctx')],
      ['standalone', makeRaw('standalone')],
    ]);
    const classified = [
      makeClassified('ctx', { topic: 'Descriptors', clarity: 5, isStandalone: false }),
      makeClassified('standalone', { topic: 'Descriptors', clarity: 5, isStandalone: true }),
    ];

    const selected = selectCandidates(classified, rawMap, 1);
    expect(selected[0].id).toBe('standalone');
  });

  it('breaks ties by recency (more recent wins)', () => {
    const rawMap = new Map([
      ['old', makeRaw('old', { timestamp: '2026-06-01T00:00:00Z' })],
      ['new', makeRaw('new', { timestamp: '2026-07-01T00:00:00Z' })],
    ]);
    const classified = [
      makeClassified('old', { topic: 'Descriptors', clarity: 4 }),
      makeClassified('new', { topic: 'Descriptors', clarity: 4 }),
    ];

    const selected = selectCandidates(classified, rawMap, 1);
    expect(selected[0].id).toBe('new');
  });

  it('returns fewer than count when not enough candidates exist', () => {
    const rawMap = new Map([['only', makeRaw('only')]]);
    const classified = [makeClassified('only')];

    const selected = selectCandidates(classified, rawMap, 10);
    expect(selected.length).toBe(1);
  });
});
