---
applyTo: "docs/postmortems/**"
---

# Post-mortem synthesis instructions

This file is the **shared analysis policy** for post-mortem synthesis. It is
runtime-neutral: both the local Claude Code subagent
(`.claude/agents/postmortem-synthesis.md`) and the production Copilot agent
(`.github/agents/postmortem-synthesis.agent.md`) delegate their analysis here
and override only where records are read from and how output is delivered.

The per-PR data records are `PR-<n>.json` files under `docs/postmortems/`;
already-consumed records are under `docs/postmortems/processed/`. See
`buildPostmortemRecord` in `scripts/postmortem/capture.js` for the record shape.

## Goal

Read all un-processed `docs/postmortems/PR-*.json` records and produce ONE
consolidated, human-gated set of improvements that makes the coding agent
better.

## Answer these questions across the PRs

- What went well; what needed rework (use `signal.commentClasses` and
  `followupCommits` across records).
- Generalizable steps worth codifying into `.github/copilot-instructions.md`.
- Standardization / linting opportunities that would reduce drift (e.g. a
  recurring `ciFailures.lint` count signals a pre-PR lint gate is being
  skipped).
- Concrete, minimal edits to `.github/copilot-instructions.md`, the skills
  under `.github/skills/`, or the `.agent.md` files.

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

## Output rules (all runtimes)

- Produce exactly ONE consolidated change. Keep each proposed edit small and
  justified by cited data (e.g. "lint failed in N of M PRs").
- Only edit the coding-agent steering files above. Do not touch application
  code, the capture script, or the records' schema.
- Put **ticket-description improvement suggestions as prose** (in the PR body
  for the production flow, or in the run summary locally) — do NOT write them
  back to Jira.
- Include an AI-use disclosure and note assumptions and limitations.
- De-identify everything that persists (digest and PR body): themes + cited
  evidence only; reference PRs by number and Jira keys by key; **never** write
  reviewer logins or verbatim comment text — paraphrase comments to themes.
- The result is **human-gated**: never merge, and never auto-apply beyond what
  the runtime's delivery section allows.
- Never add human reviewer logins to any file; the records already exclude
  them — keep it that way.

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

## Delivery (Copilot production flow)

The production Copilot agent runs against the `postmortem-data` branch and:

- Reads the un-processed records from that branch.
- Opens exactly one **draft, human-gated** pull request to `main` applying the
  consolidated edits, with the ticket-description suggestions as prose in the
  PR body.
- Does NOT merge — a human takes the final pass.
- Separately commits the bookkeeping change (moved records + digest) to the
  `postmortem-data` branch, per the two-output model above.

The local Claude Code subagent overrides this delivery: it reads records from
the working tree and applies the edits, moved records, and digest as
uncommitted changes for `git diff` review (see its own agent file).
