# Post-mortem Agent — design

The post-mortem improvement loop learns from every merged PR and proposes small,
cited improvements to the coding agent's steering. It has two phases with very
different cost and trust profiles:

- **Phase 1 — Capture** (`scripts/postmortem/capture.js`, no LLM): on PR merge, a
  workflow derives a PII-safe record of the PR and commits it to the
  `postmortem-data` branch.
- **Phase 2 — Synthesis** (LLM): on a schedule, a workflow files an issue that
  GitHub Copilot's coding agent (`copilot-swe-agent`) works, steered by the
  shared policy `.github/instructions/postmortem.instructions.md` and the
  **postmortem-synthesis** custom agent
  (`.github/agents/postmortem-synthesis.agent.md`). It opens one human-gated
  improvement PR.

> This document describes the design and configuration shape only. It does not
> provision the Copilot coding-agent connection or set repository
> variables/secrets — those are owned by the Technology team.

## Runtime vs. persona

`copilot-swe-agent` is the **runtime** (the executor you assign an issue to); you
do not customize it directly. Behavior is steered by, in order of scope:

- `.github/copilot-instructions.md` — always-on baseline for all Copilot work.
- `.github/instructions/postmortem.instructions.md` — the synthesis analysis
  policy, **path-scoped** via `applyTo: "docs/postmortems/**"`, so it applies
  automatically whenever the agent touches the data store.
- `.github/agents/postmortem-synthesis.agent.md` — the synthesis **persona**,
  selectable in interactive/dropdown use.

Because custom-agent auto-selection for background (issue-assigned) tasks is not
guaranteed, the synthesis steering does not depend on the persona being
auto-selected: the workflow's issue body names the persona **and** points at the
`applyTo`-scoped instructions, so the policy applies regardless.

A parallel **local** runner exists for previewing synthesis in a workspace:
`.claude/agents/postmortem-synthesis.md` reads records from the working tree and
applies edits as uncommitted changes for `git diff` review (never commits/PRs).

## Phase 1 — Capture (no LLM)

`.github/workflows/postmortem-capture.yml` runs on `pull_request: closed` but is
gated `if: github.event.pull_request.merged == true` — **only merged PRs are
captured**; closed-but-unmerged PRs are throwaway work whose signal would
mislead synthesis. It runs `scripts/postmortem/capture.js <n>` and commits
`docs/postmortems/PR-<n>.json` to the long-lived `postmortem-data` branch.

Records are **PII-safe by construction** — see `buildPostmortemRecord` in
`scripts/postmortem/capture.js` for the authoritative schema. Each record holds:

- **stats** — size, review cycles, CI timing, CI-failure counts.
- **changeShape** (from the file list, not patch content) — languages touched,
  test-to-source ratio, docs-touched, deps-manifest-touched.
- **signal** — comment classes (counts, never text), follow-up commit kinds, and
  `reworkAfterReview` (a fix-class commit dated after the first human review).
- **participants** — roles (`author`, `human-reviewer`, `copilot-bot`) and
  `authorAssociation` only, **never** human reviewer logins.

No LLM runs at capture; it is cheap and runs on every merge.

## Phase 2 — Synthesis (LLM, human-gated)

`.github/workflows/postmortem-synthesize.yml` runs weekly (and on
`workflow_dispatch`). If the `postmortem-data` branch has un-processed
`PR-*.json` records, it files an issue and assigns `copilot-swe-agent`, which
performs the synthesis per the shared policy.

**Deep analysis via transient reads.** The persistent store stays PII-safe; the
richer analysis happens transiently at synthesis. The agent uses `changeShape`
and `signal.reworkAfterReview` as a prioritization index, then reads — read-only,
never persisted verbatim — the PR diff (`gh pr diff`), the review/comment
threads, the PR description, and (best-effort, if Atlassian MCP is available) the
originating Jira ticket. Only **de-identified conclusions** are written out.

**A run has two outputs, not one PR across two branches:**

- **Improvement PR → `main`** — edits the steering files
  (`.github/copilot-instructions.md`, `.github/agents/*.agent.md`,
  `.github/skills/**`), each edit small and justified by cited data
  (e.g. "lint failed in N of M PRs"). Human-gated; **never** merged by the agent.
- **Bookkeeping commit → `postmortem-data`** — moves consumed records to
  `docs/postmortems/processed/` (kept forever) and writes a de-identified,
  cumulative-aware digest to `docs/postmortems/digests/<date>.md`. Every run
  writes a digest, including runs that propose no steering edit.

Ticket-description improvement suggestions go in the PR body as **prose** — never
written back to Jira.

## Copilot assignment

The workflow creates the issue, then assigns Copilot via the GraphQL
`replaceActorsForAssignable` mutation (the REST `--assignee` path silently drops
the Copilot bot). It resolves the actor's node id from the repository's
`suggestedActors(capabilities:[CAN_BE_ASSIGNED])`; if `COPILOT_ASSIGNEE` is unset
or not assignable, the issue is left unassigned for a human to route.

## Privacy / accountability

The persistent store stores only paths-derived counts, classes, booleans, and
roles — no reviewer logins, no verbatim comment text — following the Foundation
guidance to minimize personal data in tooling. Verbatim content is read only
transiently and read-only; only de-identified conclusions persist. All output is
AI-assisted and human-gated; a human is accountable for anything merged.

## Human follow-ups before it runs live (owned by the Technology team)

- Create the `postmortem-data` branch (the capture and synthesis workflows both
  target it).
- Set the `COPILOT_ASSIGNEE` repository variable to the org's Copilot assignee
  handle (for this repo, the assignable bot is `copilot-swe-agent`). If unset,
  synthesis issues are created unassigned for a human to route.
