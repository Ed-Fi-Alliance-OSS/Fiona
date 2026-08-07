// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from '@jest/globals';

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

function jsFilesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return jsFilesUnder(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

/** Relative import specifiers only — package imports cannot close a local cycle. */
function localImportsOf(file) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/^\s*(?:import|export)[^;]*?from\s+'([^']+)'/gm)]
    .map((m) => m[1])
    .filter((spec) => spec.startsWith('.'))
    .map((spec) => resolve(dirname(file), spec))
    .filter((target) => existsSync(target));
}

function buildGraph() {
  const graph = new Map();
  for (const file of jsFilesUnder(SRC_DIR)) graph.set(file, localImportsOf(file));
  return graph;
}

/** Depth-first search returning the first cycle found, as a list of files. */
function findCycle(graph) {
  const state = new Map();
  const stack = [];

  function visit(node) {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'open') return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, 'open');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * ticket-service.js imported two Slack action_ids from
 * listeners/actions/ticket_approval.js, which imports createTicketNow straight
 * back — a genuine import cycle, flagged by Copilot on PR #78.
 *
 * This asserts the absence of cycles rather than a blanket layering rule.
 * escalation.js imports shared user-facing copy from command-handler.js, which
 * has no imports of its own; that is an upward reference but not a cycle, and
 * failing it here would force an unrelated change.
 */
describe('module graph', () => {
  const graph = buildGraph();

  it('finds the modules and their edges', () => {
    // A cycle check over an empty or edgeless graph passes vacuously.
    expect(graph.size).toBeGreaterThan(20);
    expect([...graph.values()].reduce((n, edges) => n + edges.length, 0)).toBeGreaterThan(20);
  });

  it('has no import cycles', () => {
    const cycle = findCycle(graph);
    const readable = cycle?.map((f) => relative(SRC_DIR, f).replace(/\\/g, '/')).join(' -> ') ?? null;
    expect(readable).toBeNull();
  });
});
