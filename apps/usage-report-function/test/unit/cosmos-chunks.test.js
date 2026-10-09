// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import { fetchAllForIds, ID_CHUNK_SIZE } from '../../lib/cosmos-chunks.js';

// Echoes back each ID it was asked about, so results prove which chunk produced them.
function echoContainer() {
  const query = jest.fn((spec) => ({
    fetchAll: async () => ({ resources: spec.parameters[0].value.map((id) => `r-${id}`) }),
  }));
  return { items: { query } };
}

const buildQuery = (chunk) => ({ query: 'SELECT ...', parameters: [{ name: '@ids', value: chunk }] });

describe('fetchAllForIds', () => {
  it('issues no query for an empty ID list', async () => {
    const container = echoContainer();
    await expect(fetchAllForIds(container, [], buildQuery)).resolves.toEqual([]);
    expect(container.items.query).not.toHaveBeenCalled();
  });

  it('sends one query when the IDs fit in a single chunk', async () => {
    const container = echoContainer();
    await expect(fetchAllForIds(container, ['a', 'b'], buildQuery)).resolves.toEqual(['r-a', 'r-b']);
    expect(container.items.query).toHaveBeenCalledTimes(1);
  });

  it('splits IDs into chunks of at most chunkSize and concatenates results in order', async () => {
    const container = echoContainer();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    await expect(fetchAllForIds(container, ids, buildQuery, 2)).resolves.toEqual(ids.map((id) => `r-${id}`));
    expect(container.items.query.mock.calls.map(([spec]) => spec.parameters[0].value)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('defaults to 500 IDs per query', async () => {
    const container = echoContainer();
    const ids = Array.from({ length: 1001 }, (_, i) => `u${i}`);
    const results = await fetchAllForIds(container, ids, buildQuery);
    expect(ID_CHUNK_SIZE).toBe(500);
    expect(results).toHaveLength(1001);
    expect(container.items.query.mock.calls.map(([spec]) => spec.parameters[0].value.length)).toEqual([500, 500, 1]);
  });
});
