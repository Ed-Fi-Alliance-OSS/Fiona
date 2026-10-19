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
  return source.replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Classify the argument of every dynamic `import(...)` call in `source`. Fails closed: anything
 * that is not statically resolvable is reported as `unresolvable` instead of being skipped, since
 * a skipped call (`const t = './x-store.js'; await import(t)`) would let a forbidden module be
 * reached unseen.
 *
 * Resolvable forms: a string literal; a template literal with no interpolation; and a template
 * literal whose static prefix is a complete file path (ends in a module extension) followed by an
 * interpolated suffix, e.g. `` `../src/agent/llm-caller.js${reloadQuery(n)}` `` (a cache-busting
 * query). `` `${dir}/x.js` `` or `` `./${name}` `` are NOT resolvable.
 *
 * @param {string} source - Source with comments already neutralized (line numbers preserved).
 * @returns {{ specifiers: string[], unresolvable: Array<{ line: number, snippet: string }> }}
 */
function classifyDynamicImports(source) {
  const specifiers = [];
  const unresolvable = [];
  for (const match of source.matchAll(/(?<![.\w$])import\s*\(/g)) {
    const rest = source.slice(match.index + match[0].length);
    const literal = rest.match(/^\s*(['"])([^'"\n]*)\1\s*[,)]/) ?? rest.match(/^\s*`([^`$\n]*)`\s*[,)]/);
    const templateWithQuery = rest.match(/^\s*`([^`$\n]*\.(?:m?js|cjs|json))\$\{/);
    if (literal) {
      specifiers.push(literal[literal.length - 1]);
    } else if (templateWithQuery) {
      specifiers.push(templateWithQuery[1]);
    } else {
      const line = source.slice(0, match.index).split('\n').length;
      unresolvable.push({ line, snippet: source.slice(match.index, match.index + 60).split('\n')[0] });
    }
  }
  return { specifiers, unresolvable };
}

/**
 * Pure analysis of one file's source text: relative/bare specifiers it imports, plus any
 * `import(...)` / `require(...)` calls whose target cannot be resolved statically.
 *
 * @param {string} rawSource
 * @returns {{ specifiers: string[], unresolvable: Array<{ line: number, snippet: string }> }}
 */
function analyzeSource(rawSource) {
  const source = stripLineComments(stripJSDocTypeImports(rawSource));
  const specifiers = [];

  // Static `import`/`export`, with or without a `from` clause — covers both
  // `import { x } from './x.js'` and a bare side-effect import like `import '@slack/bolt'`.
  // Detection is independent of line position (e.g. `/* x */ import './y.js';` or `a; import ...`):
  // the keyword only has to not be part of an identifier or a property access.
  //
  // The clause before `from` may contain quoted names (`import { 'a-b' as c } from '...'`,
  // `export { x as 'a-b' } from '...'`), but must not run across a `;` or into another
  // `import`/`export` keyword: otherwise a `export const a = 'x'` with no semicolon could swallow a
  // following bare `import './x-store.js'` and hide it.
  // Comments inside the clause (`a, // don't; do this`, `a /* x; y's */`) are consumed whole, so a
  // `;` or quote inside them can't end the clause early. A bare `/` is only a generic character
  // when it doesn't start a comment, and both comment forms can only match whole (never a prefix),
  // which keeps each position matchable exactly one way and rules out catastrophic backtracking.
  const clauseChar = `(?:(?!(?<![.\\w$])(?:import|export)\\b)(?://[^\\n]*(?![^\\n])|/\\*(?:[^*]|\\*(?!/))*\\*/|[^'";/]|/(?![/*])|'[^'\\n]*'|"[^"\\n]*"))`;
  const staticImport = new RegExp(`(?<![.\\w$])(?:import|export)\\s+(?:${clauseChar}*?from\\s+)?['"]([^'"]+)['"]`, 'g');
  for (const match of source.matchAll(staticImport)) {
    specifiers.push(match[1]);
  }

  const dynamic = classifyDynamicImports(source);
  specifiers.push(...dynamic.specifiers);
  const unresolvable = [...dynamic.unresolvable];

  // `require('./x.js')` / `require("./x.js")`. A non-literal argument is unresolvable and fails
  // closed, like a non-literal `import()`.
  //
  // `createRequire(...)` and `module.require(...)` return a loader under an arbitrary local name
  // (`const r = createRequire(import.meta.url); r('./x.js')`) that a text scan cannot follow, so any
  // mention of either is reported as unresolvable too.
  for (const match of source.matchAll(/(?<![.\w$])createRequire\b|\bmodule\.require\b/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    unresolvable.push({ line, snippet: source.slice(match.index, match.index + 60).split('\n')[0] });
  }

  for (const match of source.matchAll(/(?<![.\w$])require\s*\(/g)) {
    const rest = source.slice(match.index + match[0].length);
    const literal = rest.match(/^\s*(['"])([^'"\n]*)\1\s*\)/);
    if (literal) {
      specifiers.push(literal[2]);
    } else {
      const line = source.slice(0, match.index).split('\n').length;
      unresolvable.push({ line, snippet: source.slice(match.index, match.index + 60).split('\n')[0] });
    }
  }

  return { specifiers, unresolvable };
}

/**
 * Specifiers imported by one file: relative imports resolved to absolute paths that exist on
 * disk, bare package specifiers (untouched, for the allowlist check), and unresolvable dynamic
 * loads.
 *
 * @param {string} file
 * @returns {{ relative: string[], bare: string[], unresolvable: Array<{ line: number, snippet: string }> }}
 */
function importsOf(file) {
  const { specifiers, unresolvable } = analyzeSource(readFileSync(file, 'utf8'));

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
  return { relative: relativeTargets, bare, unresolvable };
}

/**
 * Breadth-first walk of the relative import graph from `entry`. Returns every reachable file
 * (including `entry`), a parent pointer per file for reconstructing the import chain, and the
 * bare package specifiers and unresolvable dynamic loads found in each file.
 */
function walk(entry) {
  const parents = new Map([[entry, null]]);
  const bareImportsByFile = new Map();
  const unresolvableByFile = new Map();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift();
    const { relative: relativeTargets, bare, unresolvable } = importsOf(file);
    bareImportsByFile.set(file, bare);
    unresolvableByFile.set(file, unresolvable);
    for (const next of relativeTargets) {
      if (!parents.has(next)) {
        parents.set(next, file);
        queue.push(next);
      }
    }
  }

  return { parents, bareImportsByFile, unresolvableByFile };
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
  const { parents, bareImportsByFile, unresolvableByFile } = walk(ENTRY);
  const reachable = [...parents.keys()];

  it('reaches src/agent/llm-caller.js (sanity check that the walk found something)', () => {
    expect(reachable).toContain(resolve(APP_ROOT, 'src/agent/llm-caller.js'));
  });

  it('has no dynamic import()/require() whose target cannot be resolved statically (fails closed)', () => {
    const problems = [];
    for (const [file, found] of unresolvableByFile) {
      for (const { line, snippet } of found) {
        problems.push(
          `${relative(APP_ROOT, file).replace(/\\/g, '/')}:${line}: unresolvable load \`${snippet}\`\n  reached via: ${chainTo(parents, file)}`,
        );
      }
    }
    expect(problems).toEqual([]);
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

// A literal `$` so the fixtures below can contain template placeholders without tripping the linter.
const D = '$';

describe('analyzeSource (specifier extraction and classification)', () => {
  it('resolves string and plain template-literal import() calls', () => {
    const { specifiers, unresolvable } = analyzeSource(
      'const a = await import(\'./a.js\');\nconst b = await import("./b.js");\nconst c = await import(`./c.js`);',
    );
    expect(specifiers).toEqual(['./a.js', './b.js', './c.js']);
    expect(unresolvable).toEqual([]);
  });

  it('resolves a literal path followed by an interpolated query suffix', () => {
    const { specifiers, unresolvable } = analyzeSource(
      `return import(\`../src/agent/llm-caller.js${D}{reloadQuery(n)}\`);`,
    );
    expect(specifiers).toEqual(['../src/agent/llm-caller.js']);
    expect(unresolvable).toEqual([]);
  });

  it('flags a variable specifier as unresolvable, with its line number', () => {
    const { unresolvable } = analyzeSource("const t = './interaction-store.js';\nawait import(t);");
    expect(unresolvable).toHaveLength(1);
    expect(unresolvable[0].line).toBe(2);
  });

  it('flags template literals that begin with, or interpolate into, the path', () => {
    expect(analyzeSource(`import(\`${D}{dir}/x.js\`);`).unresolvable).toHaveLength(1);
    expect(analyzeSource(`import(\`./${D}{name}\`);`).unresolvable).toHaveLength(1);
    expect(analyzeSource(`import(\`./x-${D}{name}.js\`);`).unresolvable).toHaveLength(1);
  });

  it('flags a concatenated specifier and a non-literal require()', () => {
    expect(analyzeSource("import('./a' + suffix);").unresolvable).toHaveLength(1);
    expect(analyzeSource('require(path);').unresolvable).toHaveLength(1);
    expect(analyzeSource("require('./ok.js');").unresolvable).toEqual([]);
  });

  it('flags any createRequire token or module.require, which return untraceable loaders', () => {
    const viaImport =
      "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\nr('./x-store.js');";
    const found = analyzeSource(viaImport).unresolvable;
    expect(found.map((entry) => entry.line)).toContain(2);
    expect(analyzeSource("module.require('./x.js');").unresolvable).toHaveLength(1);
    expect(analyzeSource('const mod = foo.createRequire;').unresolvable).toEqual([]);
  });

  it('detects static imports and re-exports that are not at the start of a line', () => {
    expect(analyzeSource("/* x */ import './a.js';").specifiers).toEqual(['./a.js']);
    expect(analyzeSource("const q = 1; import { b } from './b.js';").specifiers).toEqual(['./b.js']);
    expect(analyzeSource("/* x */ export * from './c.js';").specifiers).toEqual(['./c.js']);
    expect(analyzeSource("export {\n  d,\n} from './d.js';").specifiers).toEqual(['./d.js']);
  });

  it('detects quoted (string) import and export names in the clause', () => {
    expect(analyzeSource("import { 'a-b' as c } from './x-store.js';").specifiers).toEqual(['./x-store.js']);
    expect(analyzeSource("export { x as 'a-b' } from './y-store.js';").specifiers).toEqual(['./y-store.js']);
    expect(analyzeSource('export { x as "a-b" } from "./z.js";').specifiers).toEqual(['./z.js']);
  });

  it('consumes comments inside an import clause whole (semicolon, apostrophe, block comment)', () => {
    expect(analyzeSource("import {\n  a, // note; semicolon\n  b\n} from './x-store.js';").specifiers).toEqual([
      './x-store.js',
    ]);
    expect(analyzeSource("import {\n  a, // don't do this\n  b\n} from './y-store.js';").specifiers).toEqual([
      './y-store.js',
    ]);
    expect(analyzeSource("import { a /* x; y's */, b } from './z.js';").specifiers).toEqual(['./z.js']);
  });

  it('stays fast on long comment-heavy input with no from clause (no catastrophic backtracking)', () => {
    const source = `export {\n${"  a, // comment's text\n  /* block; */\n".repeat(3000)}`;
    const started = Date.now();
    expect(analyzeSource(source).specifiers).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not let a semicolon-less export swallow a following bare import', () => {
    const { specifiers } = analyzeSource("export const a = 'x'\nimport './hidden-store.js'\nimport b from './ok.js'");
    expect(specifiers).toEqual(['./hidden-store.js', './ok.js']);
  });

  it('does not treat ordinary code as a static import', () => {
    const { specifiers } = analyzeSource(
      "export const label = 'x';\nconst reimport = 'y';\nobj.import = 'z';\nexport function f() { return 'w'; }\nexport default 'x';\nconst o = { import: 'x' };",
    );
    expect(specifiers).toEqual([]);
  });

  it('keeps line numbers correct after comment stripping', () => {
    const { unresolvable } = analyzeSource('// c1\n\n// c2\nimport(x);');
    expect(unresolvable[0].line).toBe(4);
  });

  it('ignores JSDoc type-only import() references and method calls named import', () => {
    const { specifiers, unresolvable } = analyzeSource(
      "/**\n * @param {import('x').Y} a\n * @returns {Promise<typeof import('../src/z.js')>}\n */\nfoo.import(bar);",
    );
    expect(specifiers).toEqual([]);
    expect(unresolvable).toEqual([]);
  });
});
