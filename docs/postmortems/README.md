# Post-mortem data store

This directory holds per-PR post-mortem records that feed the post-mortem
improvement loop. See `docs/agents/postmortem-agent.md` for the design.

## Where the data lives

- **Records** (`PR-<number>.json`) are committed to the **`postmortem-data`
  branch**, not `main`. The capture workflow
  (`.github/workflows/postmortem-capture.yml`) writes and commits them
  automatically when a PR is **merged**. Closed-but-unmerged PRs are skipped —
  they are often throwaway work whose signal would mislead synthesis.
- This directory on `main` holds only this README and `.gitkeep` markers so
  the path exists; the JSON records accumulate on `postmortem-data`.
- `processed/` holds records the synthesis step has already consumed, so they
  are not re-synthesized (kept forever).
- `digests/<date>.md` holds the de-identified, cumulative-aware summary each
  synthesis run writes.

## Record shape

See `buildPostmortemRecord` in `scripts/postmortem/capture.js` for the
authoritative schema (`schemaVersion: 2`). Each record carries:

- `authorKind` — `agent`, `human`, `dependabot`, or `other-bot`. Decides which
  cohort the record belongs to; see the cohort rule in
  `.github/instructions/postmortem.instructions.md`.
- `stats` — size, `reviewCycles`, `timeToFirstGreenCiMinutes`,
  `timeToMergeMinutes`, plus `ciRuns` / `ciFailures` / `ciSkipped`.
- `changeShape` — languages, test-to-source ratio, docs-touched,
  deps-manifest-touched, derived from the file list, not patch content.
- `signal` — comment classes, follow-up commit kinds, `reworkAfterReview`.
- `participants` — roles and `authorAssociation` only.

### How the CI and review fields are derived

Two definitions are easy to get wrong, so they are spelled out here:

- **CI outcomes come from workflow-run and job-step history.** Runs are
  *retrieved* by head branch (the only way to list them in one call) but
  *scoped* by head SHA, because a branch can outlive, predate, or be reused by
  another PR, and also carries deploy (`workflow_dispatch`) and code-review
  (`dynamic`) runs. Retrieval pages through the run list — one branch already
  carries 61 runs against a 100-per-page API limit, and a truncated page would
  silently under-report failures. Runs that predate the PR are ignored, and only
  `pull_request` events count. They are *not* read from `gh pr checks`, which reports only
  the current state of the head SHA — always green on a merged PR. Step-level
  detail is what distinguishes lint from test, because this repo's check name
  (`Setup - apps/fiona-slack`) contains neither word. Reporting steps
  (`Report test results`) are excluded: that step fails whenever `junit.xml` is
  absent, which is exactly when tests were skipped. Cancelled runs (from the
  `cancel-in-progress` concurrency group) are counted separately and are not
  failures.
- **`reviewCycles` counts review decisions**, not review objects. GitHub emits
  one review object per inline comment in a batched review, so counting objects
  overstates cycles several fold. Only human `CHANGES_REQUESTED` and `APPROVED`
  reviews count. `signal.reworkAfterReview` deliberately uses a different
  anchor — the first human review of *any* state, including `COMMENTED` — because
  it answers a different question.

Known limitation: `timeToFirstGreenCiMinutes` is the first *successful workflow
run* after the PR opened. On a PR that triggers several workflows, the fastest
one dominates, so the value is a floor rather than full-suite green.

## Privacy

Records store participant **roles** (`author`, `human-reviewer`,
`bot-reviewer`) and `authorAssociation` only — **never** human reviewer
logins. Review-comment text is stored only as class counts, never verbatim.
This follows the Foundation guidance to minimize personal data in tooling.

The test fixtures under `scripts/postmortem/fixtures/` are captured from real
merged PRs and are **de-identified**: logins are replaced with synthetic
handles (bot-shaped logins are preserved, because author-kind classification is
what they exercise) and comment bodies are replaced with canonical text of the
same class.
