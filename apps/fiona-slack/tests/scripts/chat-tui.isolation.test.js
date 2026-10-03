// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Isolation guard for the local chat harness. `scripts/chat-tui.js` must never be able to record
 * anything — no Cosmos, no Slack, no interaction store. Rather than trust that convention holds,
 * this test walks the relative import graph (static `import`/`export`, dynamic `import()`, and
 * `require()`) starting from `chat-tui.js`, and fails if any reachable local file is a
 * store/Cosmos/telemetry module, or if any reachable file imports a bare package specifier that
 * isn't explicitly allow-listed. Reuses the approach in `tests/agent/layering.test.js`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = resolve(APP_ROOT, 'scripts/chat-tui.js');

const FORBIDDEN_LOCAL_PATTERNS = [/-store\.js$/, /^cosmos-utils\.js$/, /^interaction-telemetry\.js$/];

// Allowlist, not a denylist: anything reachable that isn't a `node:` builtin (or its unprefixed
// legacy name) or one of these two packages fails the check below.
const ALLOWED_BARE_SPECIFIERS = new Set(['dotenv', '@perplexity-ai/perplexity_ai']);

function isAllowedBareSpecifier(specifier) {
  return isBuiltin(specifier) || ALLOWED_BARE_SPECIFIERS.has(specifier);
}

/** Strip a trailing `?query` or `#hash` fragment, e.g. from a cache-busting `?reload=n` import. */
function stripQueryAndHash(specifier) {
  return specifier.split(/[?#]/)[0];
}

/**
 * Neutralize JSDoc type-only `import(...)` references — e.g. `@param {import("@slack/web-api").X}`
 * — without stripping comments in general.
 *
 * General `/\* ... *\/` block-comment stripping was deliberately removed: it treats any `/*`
 * inside a string or regex literal (e.g. `'src/*.js'`) as a comment start, and then swallows real
 * code — including a forbidden import — up to the next real `*\/`. That is a silent false
 * negative, which this guard must not have. A false alarm is fine; a missed forbidden import is
 * not — so this guard fails closed.
 *
 * The brace/import pattern below is only ever applied to lines that already look like a
 * comment — matching `JSDOC_LINE` (`/** ... *\/` opener, or a `*` continuation line). Applying it
 * unconditionally to every line is unsafe: real code routinely has a `{` and a `}` around an
 * `import(...)` call on the same line too (an object literal, an `if` block, an arrow function
 * body, ...), and those are real imports that must still be caught, not stripped.
 *
 * One direct consequence: a forbidden import that is genuinely commented out inside a block
 * comment (not a type annotation) now trips the guard, since the comment markers themselves are
 * left in place and only this narrow `{...}` pattern is removed from comment lines. That's an
 * intentional, accepted trade-off, not a bug.
 *
 * Within a qualifying comment line, this still handles one level of nesting — e.g.
 * `{Promise<{ x: import('y').Z }>}` — since the innermost `{ x: import('y').Z }` matches (and is
 * stripped) on its own, leaving the outer `{Promise<>}` with nothing left to misread. Deeper
 * nesting, or a type annotation split across multiple lines, is not handled.
 */
const JSDOC_LINE = /^\s*(\/\*+|\*)/;
function stripJSDocTypeImports(source) {
  return source
    .split('\n')
    .map((line) =>
      JSDOC_LINE.test(line) ? line.replace(/\{[^{}\n]*\bimport\(\s*['"][^'"]+['"]\s*\)[^{}\n]*\}/g, '') : line,
    )
    .join('\n');
}

/**
 * Strip `//` line comments, but only when `//` is the first non-whitespace token on the line.
 * A `//` appearing anywhere else on a line (e.g. inside a string like `'https://example.com'`) is
 * left completely alone, so it can never eat real code.
 */
function stripLineComments(source) {
  return source.replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Specifiers imported by one file: relative imports resolved to absolute paths that exist on
 * disk, and bare package specifiers (untouched, for the allowlist check).
 *
 * @param {string} file
 * @returns {{ relative: string[], bare: string[] }}
 */
function importsOf(file) {
  const source = stripLineComments(stripJSDocTypeImports(readFileSync(file, 'utf8')));
  const specifiers = [];

  // Static `import`/`export`, with or without a `from` clause — covers both
  // `import { x } from './x.js'` and a bare side-effect import like `import '@slack/bolt'`.
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]);
  }

  // Dynamic `import('./x.js')`, `import("./x.js")`, or a template literal such as
  // `` import(`../src/agent/llm-caller.js?reload=${n}`) `` (Task 5's cache-busting reload). The
  // lazy capture stops at the first of a matching closing quote/backtick or a `${` interpolation
  // start, so the template literal's static prefix is captured on its own.
  for (const match of source.matchAll(/import\(\s*[`'"]([^`'"]*?)(?:\$\{|[`'"])/g)) {
    specifiers.push(match[1]);
  }

  // `require('./x.js')` / `require("./x.js")` — including via `createRequire`, which still ends
  // up calling a (locally bound) function literally named `require`.
  for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1]);
  }

  const relativeTargets = [];
  const bare = [];
  for (const raw of specifiers) {
    const specifier = stripQueryAndHash(raw);
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(file), specifier);
      if (existsSync(target)) {
        relativeTargets.push(target);
      }
    } else {
      bare.push(specifier);
    }
  }
  return { relative: relativeTargets, bare };
}

/**
 * Breadth-first walk of the relative import graph from `entry`. Returns every reachable file
 * (including `entry`), a parent pointer per file for reconstructing the import chain, and the
 * bare package specifiers imported by each file.
 */
function walk(entry) {
  const parents = new Map([[entry, null]]);
  const bareImportsByFile = new Map();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift();
    const { relative: relativeTargets, bare } = importsOf(file);
    bareImportsByFile.set(file, bare);
    for (const next of relativeTargets) {
      if (!parents.has(next)) {
        parents.set(next, file);
        queue.push(next);
      }
    }
  }

  return { parents, bareImportsByFile };
}

/** Render the import chain from the entry point down to `file`, relative to the app root. */
function chainTo(parents, file) {
  const chain = [];
  for (let node = file; node !== null; node = parents.get(node)) {
    chain.unshift(relative(APP_ROOT, node).replace(/\\/g, '/'));
  }
  return chain.join(' -> ');
}

function findForbiddenLocalFile(reachable) {
  return reachable.find((file) => FORBIDDEN_LOCAL_PATTERNS.some((pattern) => pattern.test(basename(file))));
}

function findForbiddenBareImport(bareImportsByFile) {
  for (const [file, bare] of bareImportsByFile) {
    const specifier = bare.find((spec) => !isAllowedBareSpecifier(spec));
    if (specifier) return { file, specifier };
  }
  return null;
}

describe('chat-tui isolation (no DB / Slack)', () => {
  const { parents, bareImportsByFile } = walk(ENTRY);
  const reachable = [...parents.keys()];

  it('reaches src/agent/llm-caller.js (sanity check that the walk found something)', () => {
    expect(reachable).toContain(resolve(APP_ROOT, 'src/agent/llm-caller.js'));
  });

  it('never reaches a *-store.js, cosmos-utils.js, or interaction-telemetry.js module', () => {
    const offender = findForbiddenLocalFile(reachable);
    const reason = offender
      ? `${relative(APP_ROOT, offender).replace(/\\/g, '/')}\n  reached via: ${chainTo(parents, offender)}`
      : null;
    expect(reason).toBeNull();
  });

  it('only imports allow-listed bare packages (node:* builtins, dotenv, @perplexity-ai/perplexity_ai) from any reachable file', () => {
    const found = findForbiddenBareImport(bareImportsByFile);
    const reason = found
      ? `"${found.specifier}" imported by ${relative(APP_ROOT, found.file).replace(/\\/g, '/')}\n  reached via: ${chainTo(parents, found.file)}`
      : null;
    expect(reason).toBeNull();
  });
});
