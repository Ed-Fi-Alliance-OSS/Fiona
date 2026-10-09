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

/** Every module reachable from `start`, never passing through `blocked`. */
function reachableFrom(graph, start, blocked) {
  const seen = new Set();
  const pending = [start];
  while (pending.length > 0) {
    const node = pending.pop();
    for (const next of graph.get(node) ?? []) {
      if (next === blocked || seen.has(next)) continue;
      seen.add(next);
      pending.push(next);
    }
  }
  return seen;
}

/** The names `file` imports from `target`; a namespace or default import is `*`. */
function namesImportedFrom(file, target) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/^\s*import\s+([^;]*?)\s+from\s+'([^']+)'/gm)]
    .filter((m) => m[2].startsWith('.') && resolve(dirname(file), m[2]) === target)
    .flatMap((m) => {
      const named = m[1].match(/\{([^}]*)\}/);
      if (!named || /^\s*[\w$]+\s*,|\*/.test(m[1])) return ['*'];
      return named[1]
        .split(',')
        .map((name) => name.trim().split(/\s+as\s+/)[0])
        .filter(Boolean);
    });
}

const toLabel = (file) => relative(SRC_DIR, file).replace(/\\/g, '/');

/**
 * The command modules serve help, search, escalate and ticket, none of which
 * synthesizes an answer. Only `ask` does, and it reaches the LLM through
 * ask-handler.js. Any other route to the answer pipeline, direct or through a
 * helper, would let a non-ask sub-command start calling the LLM unnoticed.
 *
 * Every module in listeners/commands is checked, so a new one is covered
 * without editing a list, and imports are followed transitively with
 * ask-handler.js taken out of the graph. Two helpers legitimately use
 * llm-caller for something other than an answer: search-caller.js for the
 * source search, and escalation.js for the hand-off summary. They may import
 * exactly those functions and nothing else from it.
 */
const SANCTIONED_LLM_IMPORTS = {
  'agent/search-caller.js': ['searchForSources'],
  'agent/escalation.js': ['summarizeForEscalation'],
};

describe('command modules and the LLM', () => {
  const graph = buildGraph();
  const llmCaller = join(SRC_DIR, 'agent', 'llm-caller.js');
  const commandsDir = join(SRC_DIR, 'listeners', 'commands');
  const askHandler = join(commandsDir, 'ask-handler.js');
  const commandModules = jsFilesUnder(commandsDir).filter((file) => file !== askHandler);

  it('finds the command modules', () => {
    expect(commandModules.map((file) => relative(commandsDir, file))).toEqual(
      expect.arrayContaining(['fiona.js', 'command-handler.js', 'command-dispatch.js']),
    );
  });

  it.each(commandModules.map((file) => [toLabel(file), file]))(
    '%s reaches the LLM only through ask-handler.js',
    (_label, file) => {
      expect(graph.has(file)).toBe(true);
      const reachable = [file, ...reachableFrom(graph, file, askHandler)];
      const llmImports = Object.fromEntries(
        reachable
          .filter((module) => graph.get(module)?.includes(llmCaller))
          .map((module) => [toLabel(module), namesImportedFrom(module, llmCaller).sort()]),
      );
      for (const [module, names] of Object.entries(llmImports)) {
        expect([module, names]).toEqual([module, SANCTIONED_LLM_IMPORTS[module] ?? []]);
      }
    },
  );

  it('reads the names a module imports from llm-caller', () => {
    expect(namesImportedFrom(join(SRC_DIR, 'agent', 'escalation.js'), llmCaller)).toEqual(['summarizeForEscalation']);
    expect(namesImportedFrom(askHandler, llmCaller)).toContain('callLLM');
  });

  it('ask-handler.js is the command layer’s one route to the LLM', () => {
    expect(graph.get(askHandler)).toContain(llmCaller);
  });
});
