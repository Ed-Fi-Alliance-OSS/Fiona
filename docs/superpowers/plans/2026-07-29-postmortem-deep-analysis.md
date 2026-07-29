# Post-mortem Deep Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich Phase 1 capture with five PII-free derived signals and steer the synthesis agents to do transient, read-only deep analysis (diff, comments, PR/ticket text) that persists only de-identified conclusions plus a cumulative digest.

**Architecture:** Capture stays no-LLM and dependency-free — new signals derive from the `files` metadata list (paths + line counts, not patch content) and from commit/review timestamps already fetched. Deep qualitative analysis moves to synthesis time, where the agent reads live sources transiently and writes de-identified output. Records rest on the long-lived `postmortem-data` branch (Approach A); a synthesis run produces two outputs (improvement PR → `main`; bookkeeping commit → `postmortem-data`).

**Tech Stack:** Node.js ESM (no deps), Node built-in test runner (`node --test`), `gh` CLI, Atlassian MCP (read-only), Markdown agent/instruction files.

## Global Constraints

- New JS/YAML/Dockerfile files start with the Apache license header (see `CLAUDE.md`). `capture.js`/`capture.test.js` already have it — do not duplicate.
- Capture stays **no-LLM and dependency-free**; derive only from `files` metadata + timestamps. No patch hunks, no comment text, no logins at capture.
- Persistent store is **PII-safe by construction**: paths, counts, classes, booleans, roles only. Never write reviewer logins or verbatim comment text anywhere that persists.
- Schema changes are **additive** — existing fields and their tests are unchanged.
- All synthesis output is **human-gated**: never auto-commit, push, `gh pr create` in the local flow, or merge in any flow. Never write to Jira.
- Test command (run from `scripts/postmortem/`): `node --test`.

---

### Task 1: `deriveChangeShape` — file-list signals

**Files:**
- Modify: `scripts/postmortem/capture.js` (add exported fn after `deriveTimeToFirstGreen`, ~line 72)
- Test: `scripts/postmortem/capture.test.js`

**Interfaces:**
- Consumes: `files` array of `{ path, additions, deletions }` (from `gh pr view --json files`).
- Produces: `deriveChangeShape(files) -> { languages: Record<string,number>, testToSourceRatio: number|null, docsTouched: boolean, depsManifestTouched: boolean }`.

- [ ] **Step 1: Write the failing test**

Add to `capture.test.js` (after the `deriveTimeToFirstGreen` tests), and add `deriveChangeShape` to the import block at the top:

```javascript
test("deriveChangeShape: languages, test/source ratio, docs & deps flags", () => {
  const files = [
    { path: "apps/fiona-slack/src/search.js", additions: 40, deletions: 2 },
    { path: "apps/fiona-slack/src/search.test.js", additions: 30, deletions: 0 },
    { path: "docs/README.md", additions: 5, deletions: 0 },
    { path: "apps/fiona-slack/package.json", additions: 1, deletions: 1 },
  ];
  const shape = deriveChangeShape(files);
  assert.deepEqual(shape.languages, { js: 3, md: 1, json: 1 });
  assert.equal(shape.testToSourceRatio, 1); // 1 test file / 1 source file
  assert.equal(shape.docsTouched, true);
  assert.equal(shape.depsManifestTouched, true);
  const none = deriveChangeShape([{ path: "docs/only.md", additions: 1, deletions: 0 }]);
  assert.equal(none.testToSourceRatio, null); // no source files
  assert.equal(none.docsTouched, true);
  assert.deepEqual(deriveChangeShape([]), {
    languages: {}, testToSourceRatio: null, docsTouched: false, depsManifestTouched: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `deriveChangeShape is not defined` / import error.

- [ ] **Step 3: Write minimal implementation**

Add to `capture.js` after `deriveTimeToFirstGreen`:

```javascript
const TEST_PATH = /(\.test\.|\.spec\.|__tests__\/|\/tests?\/)/i;
const DOC_PATH = /(\.md$|^docs\/)/i;
const DEP_PATH = /((^|\/)package\.json$|package-lock\.json$|yarn\.lock$)/i;
const SOURCE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|cs|go|rb|java|sh)$/i;

export function deriveChangeShape(files) {
  const list = files || [];
  const languages = {};
  let testFiles = 0;
  let sourceFiles = 0;
  let docsTouched = false;
  let depsManifestTouched = false;
  for (const f of list) {
    const p = String(f.path || "");
    if (p.includes(".")) {
      const ext = p.split(".").pop().toLowerCase();
      languages[ext] = (languages[ext] || 0) + 1;
    }
    if (DOC_PATH.test(p)) docsTouched = true;
    if (DEP_PATH.test(p)) depsManifestTouched = true;
    if (TEST_PATH.test(p)) testFiles += 1;
    else if (SOURCE_EXT.test(p) && !DOC_PATH.test(p)) sourceFiles += 1;
  }
  const testToSourceRatio =
    sourceFiles === 0 ? null : Math.round((testFiles / sourceFiles) * 100) / 100;
  return { languages, testToSourceRatio, docsTouched, depsManifestTouched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add scripts/postmortem/capture.js scripts/postmortem/capture.test.js
git commit -m "feat(postmortem): derive change-shape signals from file list"
```

---

### Task 2: `deriveReworkAfterReview` — fix-after-review signal

**Files:**
- Modify: `scripts/postmortem/capture.js` (add exported fn after `deriveChangeShape`)
- Test: `scripts/postmortem/capture.test.js`

**Interfaces:**
- Consumes: `commits` array of `{ messageHeadline, committedDate }`; `reviews` array of `{ author: { login }, submittedAt }`. Reuses existing `classifyFollowupCommit` and `classifyParticipantKind`.
- Produces: `deriveReworkAfterReview(commits, reviews) -> boolean` — true iff a `fix`-class commit was committed after the earliest human review submission.

- [ ] **Step 1: Write the failing test**

Add to `capture.test.js`, and add `deriveReworkAfterReview` to the import block:

```javascript
test("deriveReworkAfterReview: fix commit after first human review => true", () => {
  const reviews = [
    { author: { login: "roberthunterjr" }, submittedAt: "2026-07-24T10:00:00Z" },
  ];
  const afterFix = [
    { messageHeadline: "feat: initial", committedDate: "2026-07-24T09:00:00Z" },
    { messageHeadline: "fix: address review", committedDate: "2026-07-24T11:00:00Z" },
  ];
  assert.equal(deriveReworkAfterReview(afterFix, reviews), true);
  // fix commit BEFORE the review does not count
  const beforeFix = [
    { messageHeadline: "fix: pre-review", committedDate: "2026-07-24T08:00:00Z" },
  ];
  assert.equal(deriveReworkAfterReview(beforeFix, reviews), false);
  // no human review => false
  assert.equal(deriveReworkAfterReview(afterFix, []), false);
  // bot-only review => false (not a human review)
  const botReview = [{ author: { login: "copilot-swe-agent" }, submittedAt: "2026-07-24T10:00:00Z" }];
  assert.equal(deriveReworkAfterReview(afterFix, botReview), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `deriveReworkAfterReview is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add to `capture.js` after `deriveChangeShape`:

```javascript
export function deriveReworkAfterReview(commits, reviews) {
  const humanReviewTimes = (reviews || [])
    .filter((r) => classifyParticipantKind(r.author?.login) === "human" && r.submittedAt)
    .map((r) => new Date(r.submittedAt).getTime())
    .filter((t) => !Number.isNaN(t));
  if (!humanReviewTimes.length) return false;
  const firstReview = Math.min(...humanReviewTimes);
  for (const c of commits || []) {
    if (classifyFollowupCommit(c.messageHeadline || c.message) !== "fix") continue;
    const t = new Date(c.committedDate || c.authoredDate || 0).getTime();
    if (!Number.isNaN(t) && t > firstReview) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/postmortem/capture.js scripts/postmortem/capture.test.js
git commit -m "feat(postmortem): derive rework-after-review signal from timestamps"
```

---

### Task 3: Wire signals into the record and re-capture

**Files:**
- Modify: `scripts/postmortem/capture.js` — `fetchPrData` (line 143-149 field list + return at 150-156) and `buildPostmortemRecord` (line 96-131)
- Modify: `scripts/postmortem/capture.test.js` — extend the `RAW` fixture + `buildPostmortemRecord` assertions
- Test: `scripts/postmortem/capture.test.js`

**Interfaces:**
- Consumes: `deriveChangeShape` (Task 1), `deriveReworkAfterReview` (Task 2).
- Produces: record gains top-level `changeShape` and `signal.reworkAfterReview`; `fetchPrData` now returns `files`.

- [ ] **Step 1: Write the failing test**

In `capture.test.js`, extend the `RAW` fixture (add a `files` array and timestamps so rework-after-review is true). Add to `RAW.pr` nothing; add these keys to the `RAW` object:

```javascript
  files: [
    { path: "src/search.js", additions: 40, deletions: 2 },
    { path: "src/search.test.js", additions: 30, deletions: 0 },
  ],
```

Change `RAW.reviews` entries to include `submittedAt` and `RAW.commits` to include `committedDate`:

```javascript
  reviews: [
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED", submittedAt: "2026-07-24T10:00:00Z" },
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED", submittedAt: "2026-07-24T12:00:00Z" },
  ],
  commits: [
    { messageHeadline: "feat: add search", committedDate: "2026-07-23T18:00:00Z" },
    { messageHeadline: "fix: lint errors", committedDate: "2026-07-24T11:00:00Z" },
  ],
```

Add assertions inside the existing `buildPostmortemRecord` test (do not remove existing ones):

```javascript
  assert.deepEqual(rec.changeShape.languages, { js: 2 });
  assert.equal(rec.changeShape.testToSourceRatio, 1);
  assert.equal(rec.changeShape.docsTouched, false);
  assert.equal(rec.changeShape.depsManifestTouched, false);
  assert.equal(rec.signal.reworkAfterReview, true); // fix at 11:00 after first review 10:00
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `rec.changeShape` is undefined / `reworkAfterReview` missing.

- [ ] **Step 3: Write minimal implementation**

In `buildPostmortemRecord`, destructure `files` and add the fields. Change line 97:

```javascript
  const { pr, reviews = [], comments = [], commits = [], checkRuns = [], files = [] } = raw;
```

Add `changeShape` to the returned object (top level, after `stats`) and `reworkAfterReview` inside `signal`:

```javascript
    changeShape: deriveChangeShape(files),
    signal: {
      commentClasses,
      followupCommits,
      reworkAfterReview: deriveReworkAfterReview(commits, reviews),
      changeRequestThemes: [],
    },
```

In `fetchPrData`, add `files` to the `--json` field list (line 147) and to the returned bundle:

```javascript
      "number,title,state,headRefName,additions,deletions,changedFiles,createdAt,mergedAt,closedAt,author,reviews,comments,commits,files",
```
```javascript
  return {
    pr: bundle,
    reviews: bundle.reviews || [],
    comments: bundle.comments || [],
    commits: bundle.commits || [],
    files: bundle.files || [],
    checkRuns: runChecks(),
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS (all tests).

- [ ] **Step 5: Re-capture the sample PRs (live verification)**

Run from repo root:
```bash
for n in 92 90 89 85 82 80 77; do node scripts/postmortem/capture.js $n; done
node -e 'const fs=require("fs");const p=require("path");const d="docs/postmortems";for(const f of fs.readdirSync(d).filter(f=>/^PR-\d+\.json$/.test(f))){const r=JSON.parse(fs.readFileSync(p.join(d,f)));console.log(`PR-${r.prNumber}`, JSON.stringify(r.changeShape), "reworkAfterReview="+r.signal.reworkAfterReview);}'
```
Expected: each record prints a populated `changeShape` and a boolean `reworkAfterReview`; no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/postmortem/capture.js scripts/postmortem/capture.test.js
git commit -m "feat(postmortem): add changeShape and reworkAfterReview to record"
```
(Do not commit the regenerated `docs/postmortems/PR-*.json` — they are local test data.)

---

### Task 4: Deep-analysis policy in the shared instructions

**Files:**
- Modify: `.github/instructions/postmortem.instructions.md`

**Interfaces:**
- Consumes: the enriched record schema (Task 3) — `changeShape`, `signal.reworkAfterReview`.
- Produces: the shared policy both agent adapters delegate to, now covering transient reads, de-identification, the digest, and the two-output model.

- [ ] **Step 1: Add a "Deep analysis (transient reads)" section**

After the "Answer these questions across the PRs" section, insert:

```markdown
## Deep analysis (transient reads)

Use the enriched record fields as a prioritization index: `changeShape`
(languages, `testToSourceRatio`, `docsTouched`, `depsManifestTouched`) and
`signal.reworkAfterReview` tell you which PRs and which sources are worth a
deep read (e.g. `reworkAfterReview` + low `testToSourceRatio` → read that PR's
tests and review thread).

For the prioritized PRs, read these sources **transiently and read-only** —
never persist them verbatim:

- PR diff (`gh pr diff <n>`) — patterns/styles to standardize; confirm a
  `depsManifestTouched` change was a real new dependency.
- Review + issue comment threads — sentiment and the real reason for rework.
- The PR description — stated intent, plan, scope.
- The originating Jira ticket description — read-only via the Atlassian MCP;
  was the concept under-specified going in. Never write to Jira.

Cap the diff volume ingested per PR (sample large diffs by directory/file
rather than ingesting everything).
```

- [ ] **Step 2: Add de-identification rules to the Output rules section**

Under "## Output rules (all runtimes)", add these bullets:

```markdown
- De-identify everything that persists (digest and PR body): themes + cited
  evidence only; reference PRs by number and Jira keys by key; **never** write
  reviewer logins or verbatim comment text — paraphrase comments to themes.
```

- [ ] **Step 3: Replace the single-`processed`-move rule with the two-output model**

Replace the "After synthesis, move the consumed..." bullet and the "Do NOT merge the PR" bullet with a new section after "## Output rules (all runtimes)":

```markdown
## A run has two outputs (production flow)

A synthesis run touches two branches, so it produces two artifacts — not one
PR spanning both:

- **Improvement PR → `main`:** edits the steering files only; human-gated;
  never merged by the agent. This is the product.
- **Bookkeeping commit → `postmortem-data`:** move the consumed `PR-*.json`
  into `docs/postmortems/processed/` (kept forever) and write the digest (see
  below).

In the local Claude flow both collapse into uncommitted working-tree changes
for `git diff` review.

## Digest (every run, including no-edit runs)

Write one de-identified digest to `docs/postmortems/digests/<YYYY-MM-DD>.md`
containing: the aggregate signal used, themes with cited evidence
("rework-after-review in N of M PRs"), ticket-description suggestions as prose,
and an AI-use disclosure with assumptions/limitations. Be cumulative-aware:
read prior `digests/*.md` and the `processed/` archive and call out recurring
vs. new themes and whether a previously-flagged issue recurred or resolved.
Even a run that proposes no steering edits still writes a digest.
```

- [ ] **Step 4: Verify the file reads coherently**

Run: `git diff .github/instructions/postmortem.instructions.md`
Expected: the Delivery (Copilot production flow) section no longer contradicts the new two-output section; no leftover "move records in the same PR" wording.

- [ ] **Step 5: Commit**

```bash
git add .github/instructions/postmortem.instructions.md
git commit -m "docs(postmortem): shared policy for transient deep analysis, de-identification, digest, two outputs"
```

---

### Task 5: Update both agent adapters

**Files:**
- Modify: `.claude/agents/postmortem-synthesis.md`
- Modify: `.github/agents/postmortem-synthesis.agent.md`

**Interfaces:**
- Consumes: the shared policy (Task 4).
- Produces: adapters whose procedure references the enriched signals, transient reads, the digest, and their own delivery half of the two-output model.

- [ ] **Step 1: Update the local Claude adapter procedure**

In `.claude/agents/postmortem-synthesis.md`, in the "Procedure" section, replace step 2 and add a step so it reads:

```markdown
2. Use `changeShape` and `signal.reworkAfterReview` as a prioritization index,
   then deep-read the prioritized PRs' diff, comments, PR description, and Jira
   ticket transiently (read-only) per `.github/instructions/postmortem.instructions.md`.
   Aggregate `signal.commentClasses`, `signal.followupCommits`, and
   `stats.ciFailures`; note review-cycle and CI-timing outliers. Ignore null fields.
```

In the "Local I/O override" section, add to the Delivery bullet:

```markdown
- **Digest:** write `docs/postmortems/digests/<YYYY-MM-DD>.md` (de-identified,
  cumulative-aware) on every run, including runs with no steering edits. It is
  part of the uncommitted working-tree output for `git diff` review.
```

- [ ] **Step 2: Update the production Copilot adapter procedure**

In `.github/agents/postmortem-synthesis.agent.md`, mirror the same prioritization + transient-read step in its "Procedure", and update its "Production I/O override" Delivery bullet to name the two outputs explicitly (improvement PR → `main`; bookkeeping commit → `postmortem-data` moving records to `processed/` and writing the digest).

- [ ] **Step 3: Verify both agents still delegate analysis to file #1**

Run: `git diff .claude/agents/postmortem-synthesis.md .github/agents/postmortem-synthesis.agent.md`
Expected: both still point to `.github/instructions/postmortem.instructions.md` for analysis; only I/O + the new prioritization/digest steps changed.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/postmortem-synthesis.md .github/agents/postmortem-synthesis.agent.md
git commit -m "docs(postmortem): adapters use enriched signals, transient reads, and digest"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (five enriched signals) → Tasks 1-3. ✅ (languages, testToSourceRatio, docsTouched, depsManifestTouched in Task 1; reworkAfterReview in Task 2; wired + re-captured in Task 3.)
- Part 2 (transient deep analysis, prioritization index, four sources, de-identification, diff cap) → Task 4 Steps 1-2, Task 5 Steps 1-2. ✅
- Part 3 (cumulative digest, every run incl. null) → Task 4 Step 3, Task 5. ✅
- Part 4 (two outputs, not one PR) → Task 4 Step 3, Task 5 Step 2. ✅
- Approach A / portability / keep-forever → encoded in Task 4's two-output + digest wording; no code needed. ✅

**Placeholder scan:** No TBD/TODO. The diff-ingestion cap is intentionally a policy instruction ("cap the diff volume … sample large diffs"), not a code value, matching the spec's first-run follow-up. Task 5 Step 2 describes prose edits by reference to Step 1's concrete pattern rather than repeating a large block — acceptable as it is a mirror edit in a different file.

**Type consistency:** `deriveChangeShape(files)` and `deriveReworkAfterReview(commits, reviews)` signatures match between definition (Tasks 1-2) and use (Task 3). Record fields `changeShape` (top-level) and `signal.reworkAfterReview` are named consistently in Tasks 3-5. `fetchPrData` returns `files`, consumed by `buildPostmortemRecord`'s `files` destructure.
