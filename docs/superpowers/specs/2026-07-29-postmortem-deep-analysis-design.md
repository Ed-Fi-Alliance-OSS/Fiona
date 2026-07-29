# Post-mortem deep analysis — design

Date: 2026-07-29
Status: Proposed (extends
`docs/superpowers/specs/2026-07-29-postmortem-synthesis-agents-design.md`
and the original loop spec
`docs/superpowers/specs/2026-07-24-copilot-coding-and-postmortem-agents-design.md`)

## Problem

The post-mortem loop currently captures only coarse, PII-safe counts
(`classifyComment` collapses each comment to a nit/correctness/rework label; the
diff, comment text, PR description, and ticket are never captured;
`signal.changeRequestThemes` is an empty placeholder). The synthesis agent
therefore reasons over counts alone and cannot answer the questions that make
the loop worthwhile: what pattern in the diff should be standardized, what
concept should have been documented before deep work, whether rounds of
iteration came from inadequate tests. That qualitative analysis exists nowhere
today — it is absent, not backend.

## Goal

Give the loop enough signal to derive steering improvements from the *substance*
of each PR — the diff, the review conversation, the stated intent, and the
originating ticket — while keeping the **persistent** store PII-safe by
construction. Sensitive content is read **transiently** at synthesis, never
stored; only de-identified conclusions persist.

## Architecture decisions

- **Records rest in this repo** on the long-lived, append-only `postmortem-data`
  branch (Approach A). The records are PII-safe, so an external/closed data repo
  would add cross-repo credential cost for no protection gain. `processed/` is
  kept **forever** (trend history).
- **Synthesis runs in this repo** for now, but is designed **environment-
  portable** — it reads only via `gh` and the Atlassian MCP and opens a PR, with
  nothing repo-local — so it can later be lifted into the hardened closed repo
  (running the transient verbatim reads there) without a rewrite. Standing up any
  cross-repo credentials is out of scope and must be routed through the
  Technology team.
- **A synthesis run has two outputs, not one PR** (see Part 4).

## Part 1 — Enriched capture (Phase 1, no-LLM, PII-free)

Reopen `scripts/postmortem/capture.js` to add five derived signals. All are
computed from **file paths + per-file line counts** (`gh pr view --json files`,
which is metadata, not patch content) and from commit/review timestamps the
capture already fetches. No patch hunks, no comment text, no logins.

New record fields (additive; existing fields unchanged):

```jsonc
"changeShape": {
  "languages": { "js": 12, "md": 2 },   // extension -> changed-file count
  "testToSourceRatio": 0.25,             // test files / source files, null if no source files
  "docsTouched": false,                  // any *.md or docs/** in the file list
  "depsManifestTouched": false           // package.json / lockfile in the file list (proxy; true new-dep confirmed at synthesis)
},
"signal": {
  // ...existing commentClasses, followupCommits, changeRequestThemes...
  "reworkAfterReview": true               // a fix-class commit dated after the first human review
}
```

Derivation rules (pure functions, unit-tested, matching existing style):

- **languages:** tally file extensions from the `files` list.
- **testToSourceRatio:** test file if path matches `\.test\.|\.spec\.|__tests__/|/tests?/`;
  source file if it is a code file and not a test/doc/config; ratio =
  testFiles / sourceFiles (`null` when sourceFiles is 0).
- **docsTouched:** any path matching `\.md$` or `^docs/`.
- **depsManifestTouched:** any path matching `(^|/)package\.json$`,
  `package-lock.json`, or `yarn.lock`.
- **reworkAfterReview:** let `firstHumanReviewAt` = earliest `submittedAt` over
  reviews whose author kind is `human`; `true` if any commit classified `fix`
  has `committedDate > firstHumanReviewAt`. Uses timestamps only — no logins.

`fetchPrData` adds `files` to the `gh pr view --json` field list; the
`--json` for commits/reviews already returns `committedDate`/`submittedAt`.
Re-capture the sample PRs after the change. The privacy stance is unchanged:
still only paths, counts, classes, booleans, and roles.

## Part 2 — Deep analysis at synthesis (transient reads)

The enriched capture is a **prioritization index**: the synthesis agent uses it
to decide *which* PRs and *which* sources to deep-read (e.g. `reworkAfterReview`
+ low `testToSourceRatio` → read this PR's tests and review thread), so transient
reads are targeted rather than "read everything."

Transient, read-only sources (never persisted verbatim):

- **PR diff** — `gh pr diff <n>` → recurring patterns/styles to standardize;
  confirm `depsManifestTouched` was a real new dependency.
- **Comment threads** — review + issue comments → sentiment and the real reason
  for rework. Reviewer logins are stripped before any conclusion is written.
- **PR description** — stated intent, plan, scope notes.
- **Jira ticket description** — read-only via the existing Atlassian MCP (the
  same read-only pattern `coding-agent.agent.md` uses) → was the concept
  under-specified going in. Never write to Jira.

**De-identification of persisted conclusions** (applies to both the digest and
the improvement PR body): themes + cited evidence only; PRs referenced by number
(public); Jira keys allowed (issue identifiers, not personal data); **no
reviewer logins; no verbatim comment text** — comments are paraphrased to
themes. Cost bounding: cap the diff volume the agent ingests per PR (sample
large diffs by directory/file rather than ingesting everything).

## Part 3 — Cumulative digest

Every synthesis run — **including runs that propose no edits** — writes one
de-identified digest to `docs/postmortems/digests/<date>.md` on the
`postmortem-data` branch. It records the aggregate signal used, the themes with
cited evidence, ticket-description suggestions as prose, and an AI-use
disclosure with assumptions/limitations.

**Cumulative-aware:** because `postmortem-data` is long-lived, the agent reads
prior `digests/*.md` and the `processed/` archive on the same branch and calls
out **recurring vs. new** themes and whether a previously-flagged issue has
recurred or resolved. This is the longitudinal "is the agent improving, and
where does it keep tripping" view that motivates the loop. Null runs still emit
a digest so there is always a record that synthesis ran and what it found.

## Part 4 — Two outputs, not one PR

A production synthesis run touches two branches, so it produces two artifacts
(the merged instructions' "move records in the same PR" wording is corrected):

- **(a) Improvement PR → `main`** — edits the steering files
  (`.github/copilot-instructions.md`, `.github/agents/*.agent.md`,
  `.github/skills/**`), human-gated. **This is the product that merges.**
- **(b) Bookkeeping commit → `postmortem-data`** — moves consumed
  `PR-*.json` into `processed/` and writes the new `digests/<date>.md`.

In the **local Claude flow** both collapse into uncommitted working-tree changes
on the current branch; the human reviews everything via `git diff`.

## Non-goals

- No external/closed data repo now; no cross-repo credentials (Technology team
  owns that if ever pursued).
- No LLM at capture time — capture stays cheap and dependency-free.
- No writing suggestions or anything else back to Jira.
- No auto-commit / auto-merge — human-gated throughout.
- No persistence of verbatim diffs, comment text, or ticket text.

## Privacy / accountability

The persistent store remains PII-safe by construction. Verbatim content is read
transiently, read-only, and only de-identified conclusions are written. All
output is AI-assisted and human-gated; a human is accountable for anything
merged. If synthesis is ever relocated to the closed repo, the credential and
access setup goes through the Technology team.

## Follow-ups (not code)

- Re-capture sample PRs after the schema change to exercise the new fields.
- Decide, at first live run, the per-PR diff-ingestion cap value.
