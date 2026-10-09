// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/** Keeps ARRAY_CONTAINS parameter lists well under Cosmos DB's query size limits. */
export const ID_CHUNK_SIZE = 500;

/**
 * Runs `buildQuery(chunk)` once per chunk of `ids` and concatenates the
 * results, so lookups keyed on an unbounded list of user IDs never send one
 * oversized query. Chunks run one at a time so a large ID list doesn't
 * burst cross-partition queries into RU throttling (429s).
 */
export async function fetchAllForIds(container, ids, buildQuery, chunkSize = ID_CHUNK_SIZE) {
  const resources = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { resources: page } = await container.items.query(buildQuery(ids.slice(i, i + chunkSize))).fetchAll();
    resources.push(...page);
  }
  return resources;
}
