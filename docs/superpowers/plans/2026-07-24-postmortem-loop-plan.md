# Post-Mortem Loop (Agent #2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a PR closes, automatically capture structured post-mortem data (no LLM), then on a weekly/on-demand cadence have Copilot synthesize the accumulated data into one consolidated improvement PR that edits the coding agent's steering files.

**Architecture:** Two phases. **Phase A (capture)** is a `pull_request: closed` workflow running a dependency-free Node ESM script (`scripts/postmortem/capture.js`) that pulls PR facts via `gh`, builds a role-only (no reviewer logins) JSON record, and commits it to a dedicated `postmortem-data` branch. **Phase B (synthesis)** is a `workflow_dispatch` + weekly `schedule` workflow that opens a GitHub issue assigned to Copilot, steered by `.github/instructions/postmortem.instructions.md`, to produce the improvement PR.

**Tech Stack:** Node 22 ESM, Node built-in test runner (`node:test` + `node:assert`, no new deps), GitHub Actions, `gh` CLI, GitHub Copilot coding agent.

## Global Constraints

- New JavaScript, YAML, and Dockerfile files start with the Apache license header (repo `CLAUDE.md`):
  ```javascript
  // SPDX-License-Identifier: Apache-2.0
  // Licensed to the Ed-Fi Alliance under one or more agreements.
  // The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
  // See the LICENSE and NOTICES files in the project root for more information.
  ```
  (YAML uses `#` comment form of the same four lines.)
- **PII stance (Foundation policy):** captured JSON stores participant **roles** (`author` / `human-reviewer` / `copilot-bot`) and `authorAssociation` only — **never** human reviewer logins. Bot logins may be used transiently to classify kind but must not appear in output. Review-comment text is stored only as coarse class counts, never verbatim.
- **No external-system wiring / no auto-modify:** synthesis opens a GitHub issue/PR only; ticket-description suggestions go in the improvement-PR body as prose, never written back to Jira. The improvement PR is human-gated and never self-merges.
- **AI-use disclosure:** the synthesis instructions require the improvement-PR body to disclose AI authorship and note assumptions/limitations.
- Reuse only approved GitHub Actions at their pinned SHAs: `actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3`, `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0`.
- Post-mortem data lives on the `postmortem-data` branch (not `main`).
- Node test runner only; do not add jest or other test deps to `scripts/postmortem`.

## File Structure

```
scripts/postmortem/package.json          # ESM marker + `npm test` → node --test   [new]
scripts/postmortem/capture.js            # pure fns + thin gh I/O + CLI main         [new]
scripts/postmortem/capture.test.js       # node:test unit tests (fail-first)         [new]
docs/postmortems/README.md               # data-store docs + PII stance              [new]
docs/postmortems/.gitkeep                # dir exists on main                         [new]
docs/postmortems/processed/.gitkeep      # processed-marker dir                       [new]
.github/workflows/postmortem-capture.yml # Phase A                                    [new]
.github/instructions/postmortem.instructions.md # Phase B steering                    [new]
.github/workflows/postmortem-synthesize.yml # Phase B                                 [new]
```

---

### Task 1: Post-mortem module scaffold + classification functions

**Files:**
- Create: `scripts/postmortem/package.json`
- Create: `scripts/postmortem/capture.js`
- Test: `scripts/postmortem/capture.test.js`

**Interfaces:**
- Produces (used by Tasks 2–3):
  - `classifyComment(body: string) → "nit" | "correctness" | "rework"` (precedence: rework > correctness > nit; unknown → "nit")
  - `classifyFollowupCommit(message: string) → "fix" | "feature" | null`
  - `parseJiraKey(title: string, branch: string) → string | null` (first `[A-Z]{2,}-\d+`)
  - `classifyParticipantKind(login: string) → "copilot-bot" | "human"`

- [ ] **Step 1: Create the ESM package marker**

Create `scripts/postmortem/package.json`:

```json
{
  "name": "postmortem-capture",
  "private": true,
  "type": "module",
  "description": "PR post-mortem data capture (Phase A). No runtime dependencies.",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `scripts/postmortem/capture.test.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyComment,
  classifyFollowupCommit,
  parseJiraKey,
  classifyParticipantKind,
} from "./capture.js";

test("classifyComment: rework beats correctness beats nit", () => {
  assert.equal(classifyComment("Let's refactor this to use the SDK instead"), "rework");
  assert.equal(classifyComment("This is wrong, it fails on empty input"), "correctness");
  assert.equal(classifyComment("nit: trailing whitespace"), "nit");
  assert.equal(classifyComment("looks good"), "nit");
  assert.equal(classifyComment(""), "nit");
});

test("classifyFollowupCommit: fix vs feature vs null", () => {
  assert.equal(classifyFollowupCommit("fix: resolve biome lint errors"), "fix");
  assert.equal(classifyFollowupCommit("chore: fix flaky test"), "fix");
  assert.equal(classifyFollowupCommit("feat(AI-179): add search"), "feature");
  assert.equal(classifyFollowupCommit("docs: update readme"), null);
});

test("parseJiraKey: extracts first ticket key from title or branch", () => {
  assert.equal(parseJiraKey("feat(AI-179): implement search", ""), "AI-179");
  assert.equal(parseJiraKey("implement search", "ai-98-hitl-bug"), null);
  assert.equal(parseJiraKey("", "feature/AI-42-thing"), "AI-42");
  assert.equal(parseJiraKey("no ticket here", "plain-branch"), null);
});

test("classifyParticipantKind: detects Copilot bot vs human", () => {
  assert.equal(classifyParticipantKind("copilot-swe-agent"), "copilot-bot");
  assert.equal(classifyParticipantKind("some-bot[bot]"), "copilot-bot");
  assert.equal(classifyParticipantKind("roberthunterjr"), "human");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd scripts/postmortem && node --test`
Expected: FAIL — `capture.js` does not exist / functions not exported (`ERR_MODULE_NOT_FOUND` or `is not a function`).

- [ ] **Step 4: Write the minimal implementation**

Create `scripts/postmortem/capture.js`:

```javascript
// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const REWORK_PATTERNS = [/\brework\b/i, /refactor/i, /\bredo\b/i, /\binstead\b/i, /\bapproach\b/i, /rewrite/i];
const CORRECTNESS_PATTERNS = [/\bbug\b/i, /incorrect/i, /\bwrong\b/i, /\bfix\b/i, /\bfails?\b/i, /\berror\b/i, /should (be|not)/i];
const NIT_PATTERNS = [/\bnit\b/i, /typo/i, /formatting/i, /\bstyle\b/i, /whitespace/i];

export function classifyComment(body) {
  const text = String(body || "");
  if (REWORK_PATTERNS.some((r) => r.test(text))) return "rework";
  if (CORRECTNESS_PATTERNS.some((r) => r.test(text))) return "correctness";
  if (NIT_PATTERNS.some((r) => r.test(text))) return "nit";
  return "nit";
}

export function classifyFollowupCommit(message) {
  const m = String(message || "");
  if (/^feat(\(|:|\/)/i.test(m) || /\bfeature\b/i.test(m)) return "feature";
  if (/\bfix\b/i.test(m) || /\blint\b/i.test(m)) return "fix";
  return null;
}

export function parseJiraKey(title, branch) {
  const src = `${title || ""} ${branch || ""}`;
  const match = src.match(/\b([A-Z]{2,}-\d+)\b/);
  return match ? match[1] : null;
}

export function classifyParticipantKind(login) {
  const l = String(login || "").toLowerCase();
  if (l.includes("copilot") || l.includes("swe-agent") || l.endsWith("[bot]")) {
    return "copilot-bot";
  }
  return "human";
}
```

Note: `feature` is checked before `fix` so `feat: ... fix ...` classifies as feature; the `fix`-precedence for comments differs intentionally (a review comment about a fix is correctness/rework).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd scripts/postmortem && node --test`
Expected: PASS — 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/postmortem/package.json scripts/postmortem/capture.js scripts/postmortem/capture.test.js
git commit -m "feat(postmortem): add capture classification functions with tests"
```

---

### Task 2: Metric derivation + PII-safe participants

**Files:**
- Modify: `scripts/postmortem/capture.js` (add functions)
- Test: `scripts/postmortem/capture.test.js` (add tests)

**Interfaces:**
- Consumes: `classifyParticipantKind` (Task 1).
- Produces (used by Task 3):
  - `deriveCiFailures(checkRuns: {name,conclusion}[]) → {lint:number, test:number, build:number}`
  - `deriveMinutesBetween(startISO: string|null, endISO: string|null) → number | null`
  - `deriveTimeToFirstGreen(checkRuns: {conclusion,completedAt}[], prCreatedAt: string) → number | null`
  - `buildParticipants(prAuthorLogin: string, reviews: {author:{login},authorAssociation,state}[]) → {role,kind,association}[]` (NO logins in output)

- [ ] **Step 1: Write the failing tests**

Append to `scripts/postmortem/capture.test.js`:

```javascript
import {
  deriveCiFailures,
  deriveMinutesBetween,
  deriveTimeToFirstGreen,
  buildParticipants,
} from "./capture.js";

test("deriveCiFailures: buckets failed check runs by name", () => {
  const runs = [
    { name: "Biome lint", conclusion: "failure" },
    { name: "Unit tests", conclusion: "failure" },
    { name: "Unit tests", conclusion: "success" },
    { name: "Docker build", conclusion: "failure" },
  ];
  assert.deepEqual(deriveCiFailures(runs), { lint: 1, test: 1, build: 1 });
  assert.deepEqual(deriveCiFailures([]), { lint: 0, test: 0, build: 0 });
});

test("deriveMinutesBetween: rounds minutes, null on missing/invalid", () => {
  assert.equal(deriveMinutesBetween("2026-07-24T00:00:00Z", "2026-07-24T01:30:00Z"), 90);
  assert.equal(deriveMinutesBetween(null, "2026-07-24T01:00:00Z"), null);
  assert.equal(deriveMinutesBetween("bad", "2026-07-24T01:00:00Z"), null);
});

test("deriveTimeToFirstGreen: minutes from PR creation to earliest success", () => {
  const runs = [
    { conclusion: "success", completedAt: "2026-07-24T02:00:00Z" },
    { conclusion: "success", completedAt: "2026-07-24T00:30:00Z" },
    { conclusion: "failure", completedAt: "2026-07-24T00:10:00Z" },
  ];
  assert.equal(deriveTimeToFirstGreen(runs, "2026-07-24T00:00:00Z"), 30);
  assert.equal(deriveTimeToFirstGreen([], "2026-07-24T00:00:00Z"), null);
});

test("buildParticipants: roles only, never emits human logins", () => {
  const reviews = [
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
    { author: { login: "copilot-swe-agent" }, authorAssociation: "CONTRIBUTOR", state: "COMMENTED" },
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
  ];
  const participants = buildParticipants("copilot-swe-agent", reviews);
  assert.deepEqual(participants[0], { role: "author", kind: "copilot-bot", association: "AUTHOR" });
  const human = participants.find((p) => p.role === "human-reviewer");
  assert.deepEqual(human, { role: "human-reviewer", kind: "human", association: "MEMBER" });
  assert.ok(!JSON.stringify(participants).includes("roberthunterjr"), "no human login in output");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd scripts/postmortem && node --test`
Expected: FAIL — the four new functions are not exported.

- [ ] **Step 3: Implement**

Append to `scripts/postmortem/capture.js`:

```javascript
export function deriveCiFailures(checkRuns) {
  const failures = { lint: 0, test: 0, build: 0 };
  for (const run of checkRuns || []) {
    if (run.conclusion !== "failure") continue;
    const name = String(run.name || "").toLowerCase();
    if (name.includes("lint")) failures.lint += 1;
    else if (name.includes("test")) failures.test += 1;
    else if (name.includes("build")) failures.build += 1;
  }
  return failures;
}

export function deriveMinutesBetween(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 60000);
}

export function deriveTimeToFirstGreen(checkRuns, prCreatedAt) {
  const greens = (checkRuns || [])
    .filter((r) => r.conclusion === "success" && r.completedAt)
    .map((r) => new Date(r.completedAt).getTime())
    .filter((t) => !Number.isNaN(t));
  if (!greens.length || !prCreatedAt) return null;
  const firstGreenISO = new Date(Math.min(...greens)).toISOString();
  return deriveMinutesBetween(prCreatedAt, firstGreenISO);
}

export function buildParticipants(prAuthorLogin, reviews) {
  const participants = [
    { role: "author", kind: classifyParticipantKind(prAuthorLogin), association: "AUTHOR" },
  ];
  const seen = new Set();
  for (const review of reviews || []) {
    const kind = classifyParticipantKind(review.author?.login);
    const association = review.authorAssociation || "NONE";
    const key = `${kind}:${association}`;
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push({
      role: kind === "copilot-bot" ? "copilot-bot" : "human-reviewer",
      kind,
      association,
    });
  }
  return participants;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd scripts/postmortem && node --test`
Expected: PASS — all tests (Task 1 + Task 2) passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/postmortem/capture.js scripts/postmortem/capture.test.js
git commit -m "feat(postmortem): add metric derivation and PII-safe participants"
```

---

### Task 3: Record builder, file writer, gh I/O, and CLI

**Files:**
- Modify: `scripts/postmortem/capture.js` (add functions + CLI main)
- Test: `scripts/postmortem/capture.test.js` (add tests)

**Interfaces:**
- Consumes: all Task 1 + Task 2 functions.
- Produces:
  - `buildPostmortemRecord(raw, now?: Date) → record` where `raw = { pr, reviews, comments, commits, checkRuns }`
  - `writeRecord(record, dir?: string) → string` (path written)
  - `fetchPrData(prNumber, deps?: { run }) → raw` (thin `gh` I/O; `deps.run(args)` overridable for tests)
  - CLI: `node capture.js <prNumber>` fetches, builds, writes `docs/postmortems/PR-<n>.json`.

Record shape (matches spec §4.1):

```jsonc
{
  "prNumber": 81, "title": "...", "state": "merged", "jiraKey": "AI-179",
  "stats": { "additions": 0, "deletions": 0, "changedFiles": 0, "commits": 0,
             "reviewCycles": 0, "reviewComments": 0,
             "timeToFirstGreenCiMinutes": null, "timeToMergeMinutes": null,
             "ciFailures": { "lint": 0, "test": 0, "build": 0 } },
  "signal": { "commentClasses": { "nit": 0, "correctness": 0, "rework": 0 },
              "followupCommits": { "fix": 0, "feature": 0 },
              "changeRequestThemes": [] },
  "participants": [ { "role": "author", "kind": "copilot-bot", "association": "AUTHOR" } ],
  "capturedAt": "..."
}
```

- [ ] **Step 1: Write the failing tests**

Append to `scripts/postmortem/capture.test.js`:

```javascript
import { buildPostmortemRecord, writeRecord, fetchPrData } from "./capture.js";
import { readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RAW = {
  pr: {
    number: 81, title: "feat(AI-179): implement search", state: "MERGED",
    headRefName: "copilot/ai-179", additions: 1196, deletions: 99, changedFiles: 25,
    createdAt: "2026-07-23T16:00:00Z", mergedAt: "2026-07-24T16:00:00Z",
    author: { login: "copilot-swe-agent" },
  },
  reviews: [
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
  ],
  comments: [
    { body: "Let's use the SDK instead" }, { body: "nit: spacing" },
    { body: "this is wrong on empty input" },
  ],
  commits: [
    { messageHeadline: "feat: add search" }, { messageHeadline: "fix: lint errors" },
  ],
  checkRuns: [
    { name: "Biome lint", conclusion: "failure", completedAt: "2026-07-23T16:20:00Z" },
    { name: "Unit tests", conclusion: "success", completedAt: "2026-07-23T16:40:00Z" },
  ],
};

test("buildPostmortemRecord: assembles spec-shaped record, no human login", () => {
  const rec = buildPostmortemRecord(RAW, new Date("2026-07-24T17:00:00Z"));
  assert.equal(rec.prNumber, 81);
  assert.equal(rec.state, "merged");
  assert.equal(rec.jiraKey, "AI-179");
  assert.equal(rec.stats.additions, 1196);
  assert.equal(rec.stats.commits, 2);
  assert.equal(rec.stats.reviewCycles, 1); // deduped human reviewer
  assert.equal(rec.stats.reviewComments, 3);
  assert.equal(rec.stats.timeToMergeMinutes, 1440);
  assert.equal(rec.stats.timeToFirstGreenCiMinutes, 40);
  assert.deepEqual(rec.stats.ciFailures, { lint: 1, test: 0, build: 0 });
  assert.deepEqual(rec.signal.commentClasses, { nit: 1, correctness: 1, rework: 1 });
  assert.deepEqual(rec.signal.followupCommits, { fix: 1, feature: 1 });
  assert.deepEqual(rec.signal.changeRequestThemes, []);
  assert.equal(rec.capturedAt, "2026-07-24T17:00:00.000Z");
  assert.ok(!JSON.stringify(rec).includes("roberthunterjr"), "no human login in record");
});

test("writeRecord: writes PR-<n>.json and returns its path", () => {
  const dir = path.join(os.tmpdir(), `pm-test-${Date.now()}`);
  try {
    const file = writeRecord({ prNumber: 7, stats: {} }, dir);
    assert.equal(file, path.join(dir, "PR-7.json"));
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(parsed.prNumber, 7);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchPrData: shells through injected run and returns raw bundle", () => {
  const calls = [];
  const fakeRun = (args) => {
    calls.push(args);
    return JSON.stringify({
      number: 81, title: "feat(AI-179): x", headRefName: "b",
      additions: 1, deletions: 0, changedFiles: 1, createdAt: "2026-07-23T16:00:00Z",
      mergedAt: null, author: { login: "copilot-swe-agent" },
      reviews: [], comments: [], commits: [],
    });
  };
  const raw = fetchPrData(81, { run: fakeRun, runChecks: () => [] });
  assert.equal(raw.pr.number, 81);
  assert.ok(Array.isArray(raw.reviews));
  assert.ok(calls[0].includes("81"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd scripts/postmortem && node --test`
Expected: FAIL — `buildPostmortemRecord`, `writeRecord`, `fetchPrData` not exported.

- [ ] **Step 3: Implement**

Append to `scripts/postmortem/capture.js`:

```javascript
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function buildPostmortemRecord(raw, now = new Date()) {
  const { pr, reviews = [], comments = [], commits = [], checkRuns = [] } = raw;
  const reviewCycles = buildParticipants(pr.author?.login, reviews)
    .filter((p) => p.role === "human-reviewer").length;
  const commentClasses = { nit: 0, correctness: 0, rework: 0 };
  for (const c of comments) commentClasses[classifyComment(c.body)] += 1;
  const followupCommits = { fix: 0, feature: 0 };
  for (const c of commits) {
    const kind = classifyFollowupCommit(c.messageHeadline || c.message);
    if (kind) followupCommits[kind] += 1;
  }
  return {
    prNumber: pr.number,
    title: pr.title,
    state: pr.mergedAt ? "merged" : "closed",
    jiraKey: parseJiraKey(pr.title, pr.headRefName),
    stats: {
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changedFiles ?? 0,
      commits: commits.length,
      reviewCycles,
      reviewComments: comments.length,
      timeToFirstGreenCiMinutes: deriveTimeToFirstGreen(checkRuns, pr.createdAt),
      timeToMergeMinutes: deriveMinutesBetween(pr.createdAt, pr.mergedAt),
      ciFailures: deriveCiFailures(checkRuns),
    },
    signal: {
      commentClasses,
      followupCommits,
      changeRequestThemes: [],
    },
    participants: buildParticipants(pr.author?.login, reviews),
    capturedAt: now.toISOString(),
  };
}

export function writeRecord(record, dir = "docs/postmortems") {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `PR-${record.prNumber}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function fetchPrData(prNumber, deps = {}) {
  const run = deps.run || ((args) => execFileSync("gh", args, { encoding: "utf8" }));
  const runChecks = deps.runChecks || (() => fetchCheckRuns(prNumber, run));
  const bundle = JSON.parse(
    run([
      "pr", "view", String(prNumber),
      "--json",
      "number,title,state,headRefName,additions,deletions,changedFiles,createdAt,mergedAt,closedAt,author,reviews,comments,commits",
    ]),
  );
  return {
    pr: bundle,
    reviews: bundle.reviews || [],
    comments: bundle.comments || [],
    commits: bundle.commits || [],
    checkRuns: runChecks(),
  };
}

function fetchCheckRuns(prNumber, run) {
  try {
    const rows = JSON.parse(
      run(["pr", "checks", String(prNumber), "--json", "name,state,completedAt"]),
    );
    return rows.map((r) => ({
      name: r.name,
      conclusion: r.state === "SUCCESS" ? "success" : r.state === "FAILURE" ? "failure" : "other",
      completedAt: r.completedAt || null,
    }));
  } catch {
    return [];
  }
}

async function main() {
  const prNumber = process.argv[2];
  if (!prNumber) {
    console.error("usage: node capture.js <prNumber>");
    process.exit(1);
  }
  const raw = fetchPrData(prNumber);
  const record = buildPostmortemRecord(raw);
  const file = writeRecord(record);
  console.log(`wrote ${file}`);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main();
}
```

Note: the `import` statements are added mid-file; move them to the top of `capture.js` when implementing so all imports sit above the first function (ESM hoists imports, but keep them grouped at the top for readability).

- [ ] **Step 4: Run to verify pass**

Run: `cd scripts/postmortem && node --test`
Expected: PASS — all tests passing (Tasks 1–3).

- [ ] **Step 5: Commit**

```bash
git add scripts/postmortem/capture.js scripts/postmortem/capture.test.js
git commit -m "feat(postmortem): add record builder, file writer, gh I/O, and CLI"
```

---

### Task 4: Data-store documentation

**Files:**
- Create: `docs/postmortems/README.md`
- Create: `docs/postmortems/.gitkeep`
- Create: `docs/postmortems/processed/.gitkeep`

**Interfaces:**
- Consumes: nothing.
- Produces: the documented store contract referenced by Tasks 5–6 and the synthesis instructions.

- [ ] **Step 1: Create the README**

Create `docs/postmortems/README.md`:

```markdown
# Post-mortem data store

This directory holds per-PR post-mortem records that feed the post-mortem
improvement loop (design spec
`docs/superpowers/specs/2026-07-24-copilot-coding-and-postmortem-agents-design.md`).

## Where the data lives

- **Records** (`PR-<number>.json`) are committed to the **`postmortem-data`
  branch**, not `main`. The capture workflow
  (`.github/workflows/postmortem-capture.yml`) writes and commits them
  automatically when a PR closes.
- This directory on `main` holds only this README and `.gitkeep` markers so
  the path exists; the JSON records accumulate on `postmortem-data`.
- `processed/` holds records the synthesis step has already consumed, so they
  are not re-synthesized.

## Record shape

See `buildPostmortemRecord` in `scripts/postmortem/capture.js` for the
authoritative schema. Each record carries PR stats (size, review cycles,
CI timing, CI-failure counts), coarse signal (comment classes, follow-up
commit kinds), and participants.

## Privacy

Records store participant **roles** (`author`, `human-reviewer`,
`copilot-bot`) and `authorAssociation` only — **never** human reviewer
logins. Review-comment text is stored only as class counts, never verbatim.
This follows the Foundation guidance to minimize personal data in tooling.
```

- [ ] **Step 2: Create the keep files**

Create `docs/postmortems/.gitkeep` (empty file).
Create `docs/postmortems/processed/.gitkeep` (empty file).

Run: `printf '' > docs/postmortems/.gitkeep && printf '' > docs/postmortems/processed/.gitkeep`

- [ ] **Step 3: Verify**

Run: `test -f docs/postmortems/README.md && test -f docs/postmortems/.gitkeep && test -f docs/postmortems/processed/.gitkeep && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add docs/postmortems/README.md docs/postmortems/.gitkeep docs/postmortems/processed/.gitkeep
git commit -m "docs(postmortem): document data store and privacy stance"
```

---

### Task 5: Phase A capture workflow

**Files:**
- Create: `.github/workflows/postmortem-capture.yml`

**Interfaces:**
- Consumes: `scripts/postmortem/capture.js` (Task 3), the `postmortem-data` branch convention (Task 4).
- Produces: on every `pull_request: closed`, a committed `docs/postmortems/PR-<n>.json` on `postmortem-data`.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/postmortem-capture.yml`:

```yaml
# SPDX-License-Identifier: Apache-2.0
# Licensed to the Ed-Fi Alliance under one or more agreements.
# The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

name: Post-Mortem Capture

on:
  pull_request:
    types: [closed]

permissions:
  contents: write
  pull-requests: read
  checks: read

jobs:
  capture:
    name: Capture PR post-mortem data
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 22

      - name: Capture PR data
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/postmortem/capture.js "${{ github.event.pull_request.number }}"

      - name: Commit to postmortem-data branch
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          # Move the freshly-written record aside, switch to the data branch, restore it.
          RECORD="docs/postmortems/PR-${PR_NUMBER}.json"
          cp "${RECORD}" "/tmp/PR-${PR_NUMBER}.json"
          git fetch origin postmortem-data || true
          git checkout postmortem-data 2>/dev/null || git checkout --orphan postmortem-data
          mkdir -p docs/postmortems/processed
          cp "/tmp/PR-${PR_NUMBER}.json" "${RECORD}"
          git add "${RECORD}"
          if git diff --cached --quiet; then
            echo "No changes to commit."
            exit 0
          fi
          git commit -m "chore(postmortem): capture PR #${PR_NUMBER} data [skip ci]"
          git push origin postmortem-data
```

- [ ] **Step 2: Lint the YAML syntax**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/postmortem-capture.yml','utf8'); if(!y.includes('pull_request')||!y.includes('capture.js')) process.exit(1); console.log('OK')"`
Expected: `OK` (basic structural check; full validation happens via `workflow_dispatch`/real trigger in Task 7 of the design's validation, out of scope here).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/postmortem-capture.yml
git commit -m "feat(postmortem): add Phase A capture workflow on PR close"
```

---

### Task 6: Phase B synthesis instructions + workflow

**Files:**
- Create: `.github/instructions/postmortem.instructions.md`
- Create: `.github/workflows/postmortem-synthesize.yml`

**Interfaces:**
- Consumes: the `postmortem-data` branch records (Task 5), the steering files edited by synthesis (`.github/copilot-instructions.md`, skills).
- Produces: on weekly `schedule` / `workflow_dispatch`, a GitHub issue assigned to Copilot that drives one consolidated improvement PR.

- [ ] **Step 1: Create the synthesis instructions**

Create `.github/instructions/postmortem.instructions.md`:

```markdown
---
applyTo: "docs/postmortems/**"
---

# Post-mortem synthesis instructions

When working a post-mortem synthesis task, follow this procedure. The per-PR
data records live on the `postmortem-data` branch under `docs/postmortems/`
(`PR-<n>.json`); already-consumed records are under
`docs/postmortems/processed/`.

## Goal

Read all un-processed `docs/postmortems/PR-*.json` records and open ONE
consolidated improvement PR that makes the coding agent better.

## Answer these questions across the PRs

- What went well; what needed rework (use `signal.commentClasses` and
  `followupCommits` across records).
- Generalizable steps worth codifying into `.github/copilot-instructions.md`.
- Standardization / linting opportunities that would reduce drift (e.g. a
  recurring `ciFailures.lint` count signals a pre-PR lint gate is being
  skipped).
- Concrete, minimal edits to `.github/copilot-instructions.md`, the skills
  under `.github/skills/`, or the `.agent.md` files.

## Output rules

- Open exactly one PR. Keep each proposed edit small and justified by cited
  data (e.g. "lint failed in N of M PRs").
- Put **ticket-description improvement suggestions in the PR body as prose** —
  do NOT write them back to Jira.
- The PR body MUST include an AI-use disclosure and note assumptions and
  limitations.
- After synthesis, move the consumed `PR-*.json` files into
  `docs/postmortems/processed/` in the same PR so they are not
  re-synthesized.
- Do NOT merge the PR — it is human-gated.
- Never add human reviewer logins to any file; the records already exclude
  them, keep it that way.
```

- [ ] **Step 2: Create the synthesis workflow**

Create `.github/workflows/postmortem-synthesize.yml`:

```yaml
# SPDX-License-Identifier: Apache-2.0
# Licensed to the Ed-Fi Alliance under one or more agreements.
# The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

name: Post-Mortem Synthesis

on:
  workflow_dispatch:
  schedule:
    - cron: "0 13 * * 1" # Mondays 13:00 UTC

permissions:
  contents: read
  issues: write

jobs:
  synthesize:
    name: Open synthesis issue for Copilot
    runs-on: ubuntu-latest
    steps:
      - name: Checkout postmortem-data
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          ref: postmortem-data
          fetch-depth: 1
        continue-on-error: true

      - name: Open synthesis issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          COPILOT_ASSIGNEE: ${{ vars.COPILOT_ASSIGNEE }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          COUNT=$(ls docs/postmortems/PR-*.json 2>/dev/null | wc -l || echo 0)
          if [ "${COUNT}" -eq 0 ]; then
            echo "No un-processed post-mortem records; nothing to synthesize."
            exit 0
          fi
          BODY=$(cat <<EOF
          Consolidate the ${COUNT} un-processed post-mortem record(s) on the
          \`postmortem-data\` branch (\`docs/postmortems/PR-*.json\`) into one
          improvement PR.

          Follow \`.github/instructions/postmortem.instructions.md\`. Open a
          single human-gated PR editing the coding-agent steering files; put
          ticket-description suggestions in the PR body as prose; include an
          AI-use disclosure; move consumed records to
          \`docs/postmortems/processed/\`.
          EOF
          )
          ASSIGNEE_FLAG=""
          if [ -n "${COPILOT_ASSIGNEE}" ]; then
            ASSIGNEE_FLAG="--assignee ${COPILOT_ASSIGNEE}"
          fi
          gh issue create --repo "${REPO}" \
            --title "Post-mortem synthesis $(date +%F)" \
            --body "${BODY}" ${ASSIGNEE_FLAG}
```

Note: `COPILOT_ASSIGNEE` is a configurable repo variable (Settings → Variables). Its exact value is the org's Copilot coding-agent assignee handle; if unset, the issue is created unassigned for a human to route. This mirrors design spec §10 assumption #1 — the assignment mechanism depends on the org's Copilot configuration.

- [ ] **Step 3: Structural check**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/postmortem-synthesize.yml','utf8'); if(!y.includes('workflow_dispatch')||!y.includes('schedule')||!y.includes('gh issue create')) process.exit(1); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .github/instructions/postmortem.instructions.md .github/workflows/postmortem-synthesize.yml
git commit -m "feat(postmortem): add Phase B synthesis instructions and workflow"
```

---

## Self-Review

**Spec coverage (design §4, §5):**
- §4.1 capture: automatic on PR close, no LLM, role-only JSON, full field schema → Tasks 1–3 (functions + record) and Task 5 (workflow). Every schema field in §4.1 maps to a builder function with a test.
- §4.2 synthesis: batched `workflow_dispatch` + weekly schedule, Copilot-steered, one consolidated PR, ticket tips as prose, processed/ marking → Task 6 (instructions + workflow).
- §4.3 improvement-PR guardrails (human-gated, small justified edits) → Task 6 instructions.
- §5 PII stance (roles not logins; class counts not verbatim) → Task 2 `buildParticipants` + its PII test, Task 3 record PII assertion, Task 4 README, Task 6 instructions.
- §5 AI-use disclosure → Task 6 instructions.
- §5 cost control (Phase A no LLM) → Tasks 1–3 are pure Node, no LLM; only Task 6 issue drives Copilot.
- Data store = committed JSON in-repo (on `postmortem-data` branch) → Tasks 4–5.

**Placeholder scan:** No TBD/TODO/"handle edge cases". `changeRequestThemes: []` is intentional (populated by the LLM in Phase B, empty at capture — stated in the record shape and Task 3).

**Type consistency:** Function names are stable across tasks: `classifyComment`, `classifyFollowupCommit`, `parseJiraKey`, `classifyParticipantKind` (Task 1); `deriveCiFailures`, `deriveMinutesBetween`, `deriveTimeToFirstGreen`, `buildParticipants` (Task 2); `buildPostmortemRecord`, `writeRecord`, `fetchPrData` (Task 3). `buildPostmortemRecord` consumes exactly the Task 1/2 signatures. Record field names match the spec §4.1 shape and the tests assert them.

## Out of scope (per spec §9 + this plan)

- Empirically validating that the org's Copilot honors instructions / the `COPILOT_ASSIGNEE` handle — covered by Plan 1 Task 3 (human step).
- End-to-end live workflow runs against real PRs — verified by the human after merge (`workflow_dispatch` dry-run + first real PR close).
- Cosmos DB storage; writing back to Jira; auto-merging.
```
