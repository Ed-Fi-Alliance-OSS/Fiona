# Coding Agent (Copilot Steering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GitHub Copilot repo-level steering so every Copilot PR plans first, follows fail-first TDD, verifies lint/tests green before opening, and right-sizes ceremony to change size.

**Architecture:** Create `.github/copilot-instructions.md` (Copilot's auto-loaded, always-on custom-instructions file) as the single source of truth for coding discipline, referencing the existing `.github/skills/automate-bug-fix/SKILL.md` as the deep playbook rather than duplicating it. Add a short trigger-contract doc describing the Jira→issue→Copilot handoff (documented, not built). Empirically confirm the org's Copilot honors the file.

**Tech Stack:** Markdown steering files consumed by GitHub Copilot coding agent. No runtime code in this plan.

## Global Constraints

- New JavaScript, YAML, and Dockerfile files start with the Apache license header (repo `CLAUDE.md`). *(No such files created in this plan; applies if any are added.)*
- Copilot's custom-instructions file MUST be exactly `.github/copilot-instructions.md` (auto-loaded per GitHub Docs; verified in the design spec §10).
- Feasibility rubric and bug workflow live in `.github/skills/automate-bug-fix/SKILL.md`; do not duplicate — reference it.
- Small-change thresholds are a tunable baseline (≲2 files / ≲~50 lines / no new dep or API surface / feasibility 1), acknowledged to drift over time.
- markdownlint config (`.markdownlint.json`) uses `MD029: {style: one}` (ordered list items all `1.`) and `MD034` (no bare URLs). Generated docs should comply, though nothing gates it in CI/husky.

---

### Task 1: Create global Copilot steering file

**Files:**
- Create: `.github/copilot-instructions.md`

**Interfaces:**
- Consumes: `.github/skills/automate-bug-fix/SKILL.md` (feasibility rubric §3, bug workflow) — referenced by path, not duplicated.
- Produces: the always-on steering contract that Task 3 validates and that Plan 2's post-mortem agent will edit as an improvement target.

- [ ] **Step 1: Create the file with exact content**

Create `.github/copilot-instructions.md`:

```markdown
# Copilot Instructions for Fiona

These instructions apply to all GitHub Copilot work in this repository,
including the Copilot coding agent. Follow them for every task.

## Source of truth: the ticket

- Treat the linked issue body (synced from Jira) as the source of truth.
- Parse the bug/feature statement, the acceptance criteria, and the repro /
  expected behavior.
- If required information is missing (no clear statement, no acceptance
  criteria, or no repro for a bug), STOP and comment describing exactly what
  is missing. Do not guess.

## Right-size the ceremony first

Before planning, classify the change:

- **Small** — ALL of: touches about 2 files or fewer and about 50 changed
  lines or fewer; adds no new module, dependency, or public interface / API
  surface; feasibility score 1.
- **Standard** — anything else at feasibility score 2.
- **Too large** — feasibility score 3 or 4: STOP and propose a decomposition
  into smaller, independently reviewable issues instead of coding.

Feasibility score rubric (from `.github/skills/automate-bug-fix/SKILL.md`):

1. Small: single reviewer, minimal context switching, focused files.
1. Medium: reviewable by one reviewer with moderate context.
1. Large: likely too broad for one-pass review.
1. XL: cross-cutting / multi-area / high coordination.

## Always required (every path, never skipped)

1. **Fail-first TDD.** Write the test(s) that encode the intended behavior,
   run them, and state explicitly that they fail for the intended reason,
   BEFORE writing implementation code.
1. **Green before PR.** Run the relevant app's lint and tests locally and
   confirm they pass before opening the PR:
   - `apps/fiona-slack`: `npm run lint` and `npm test`
   - `apps/usage-report-function`: `npm run lint` and `npm test`
1. **License headers.** New JavaScript, YAML, and Dockerfile files start with
   the Apache license header (see repo `CLAUDE.md` for the exact text).

## Standard path

For Standard changes, additionally:

1. **Plan first.** Post a scoped plan to the PR before implementing:
   files/modules expected to change, why each is in scope, patterns to
   preserve, the test strategy, and the feasibility score.
1. **Scope-drift check.** Before opening the PR, compare changed files against
   the plan; justify or revert anything unexpected.
1. **PR body.** Include the summary, the plan and feasibility score, the test
   intent-alignment outcome, the verification results, and any justified scope
   exceptions.

## Fast path (Small changes)

For Small changes, trim the ceremony:

- Replace the formal posted plan with a 1-2 sentence intent note in the PR
  body (what, why, and which test proves it). No feasibility writeup.
- The scope-drift check is implicit; if the change outgrows the Small
  thresholds, escalate to the Standard path.
- The PR body is short form: summary, intent note, and verification result.

## Deep playbook

For bug tickets, the full high-discipline workflow (readiness validation,
scoped plan, fail-first tests, intent-alignment iterations, scope-drift check,
verification, PR) is documented in
`.github/skills/automate-bug-fix/SKILL.md`. This file is the always-on
summary; that skill is the detailed reference. Keep the two consistent.
```

- [ ] **Step 2: Verify content acceptance against the spec**

Confirm each is present in the file (read it back and check):
- Ticket-as-source-of-truth + stop-if-incomplete rule.
- Small / Standard / Too-large classification with the exact thresholds.
- Three never-skipped rules: fail-first TDD, green-before-PR (with both app lint/test commands), license headers.
- Standard path: plan-first, scope-drift, PR body.
- Fast path: 1-2 sentence intent note, implicit scope-drift, short PR body.
- Reference to `.github/skills/automate-bug-fix/SKILL.md` (no duplication of the rubric text beyond the four one-line labels).

Expected: all present.

- [ ] **Step 3: Verify the referenced skill path exists**

Run: `test -f .github/skills/automate-bug-fix/SKILL.md && echo OK`
Expected: `OK` (the reference is not dangling).

- [ ] **Step 4: (Optional) markdownlint the file**

Run: `npx markdownlint-cli2 ".github/copilot-instructions.md"` (if available)
Expected: no errors, or only pre-existing-config-driven notes. Not a hard gate — nothing in CI/husky runs markdownlint.

- [ ] **Step 5: Commit**

```bash
git add .github/copilot-instructions.md
git commit -m "feat: add global Copilot coding-agent steering (plan-first + fail-first TDD)"
```

---

### Task 2: Document the Jira→Copilot trigger contract

**Files:**
- Create: `docs/agents/coding-agent.md`

**Interfaces:**
- Consumes: `.github/copilot-instructions.md` (Task 1) — references the incomplete-ticket rule rather than restating it.
- Produces: the documented expected issue-body shape so context handoff is reliable. No code.

- [ ] **Step 1: Create the file with exact content**

Create `docs/agents/coding-agent.md`:

```markdown
# Coding Agent — trigger contract

The coding agent is GitHub Copilot's coding agent, steered by
`.github/copilot-instructions.md`. It is triggered by assigning a GitHub issue
to Copilot; a Jira automation creates or updates that issue from a Jira ticket.

> This document describes the expected handoff only. It does not configure or
> authenticate the Jira and GitHub integration — that is owned by the
> Technology team.

## Expected issue body shape

For reliable context handoff, the synced issue body should contain:

- **Title / summary** — a concise statement of the change.
- **Problem statement** — the bug or feature described in plain language.
- **Acceptance criteria** — a testable definition of done.
- **Repro / expected behavior** — for bugs: steps to reproduce, plus expected
  versus actual behavior.
- **Affected area** — a component or app hint (for example
  `apps/fiona-slack`).
- **Links** — related tickets, PRs, or docs.

## If the ticket is incomplete

Per `.github/copilot-instructions.md`, if the issue omits a clear problem
statement, acceptance criteria, or (for bugs) repro steps, the agent stops and
comments describing exactly what is missing rather than guessing.
```

- [ ] **Step 2: Verify cross-reference integrity**

Run: `test -f .github/copilot-instructions.md && echo OK`
Expected: `OK` (the doc's reference target exists from Task 1).

- [ ] **Step 3: Commit**

```bash
git add docs/agents/coding-agent.md
git commit -m "docs: document Jira to Copilot coding-agent trigger contract"
```

---

### Task 3: Empirically validate Copilot loads the instructions

This task closes design spec §10 assumption #1's remaining empirical gap. It requires GitHub/Copilot access and is performed by a human (or whoever has Copilot task-assignment rights); it is not automatable from this repo checkout.

**Files:**
- None created. Validation only; optionally record the result in `docs/agents/coding-agent.md`.

**Interfaces:**
- Consumes: `.github/copilot-instructions.md` (Task 1) on the default branch (or a branch Copilot reads).
- Produces: a confirmed yes/no on whether this org's Copilot honors the file, gating Plan 2's reliance on Copilot-driven synthesis.

- [ ] **Step 1: Add a small, observable directive (temporary probe)**

Temporarily append one unambiguous, low-cost directive to
`.github/copilot-instructions.md` on a test branch, e.g. a required PR-body
line:

```markdown
## Probe (temporary — remove after validation)

Every PR body MUST begin with the exact line: `steering-loaded: yes`.
```

Commit and push to a branch Copilot will read for the test task.

- [ ] **Step 2: Assign a trivial task to Copilot**

Create a tiny throwaway issue (e.g. "add a one-line comment to a README") and
assign it to Copilot, targeting the probe branch.

- [ ] **Step 3: Verify the probe was honored**

Check the resulting PR:
- PR body begins with `steering-loaded: yes` — instructions ARE loaded.
- GitHub.com PR/References surface lists `.github/copilot-instructions.md` (per GitHub Docs, custom instructions appear in the References list).

Expected: at least one signal confirms loading. If neither appears, escalate to the Technology team — the org's Copilot config may not enable repo custom instructions, which would change Plan 2's synthesis approach.

- [ ] **Step 4: Remove the probe and close out**

Revert the temporary `## Probe` section, close the throwaway issue/PR, and
record the outcome (loaded: yes/no + date) as a note in
`docs/agents/coding-agent.md`.

```bash
git add .github/copilot-instructions.md docs/agents/coding-agent.md
git commit -m "chore: remove Copilot steering probe; record validation outcome"
```

---

## Self-Review

**Spec coverage (design §3, §10.1):**
- §3.1 artifacts (`copilot-instructions.md` new; `automate-bug-fix` referenced not duplicated) → Task 1.
- §3.2 mandates 1–7 → Task 1 file content (source-of-truth, plan-first, fail-first TDD, scope-drift, green-before-PR, license headers, PR body).
- §3.2a proportional discipline (Small/Standard/Too-large, non-negotiables) → Task 1 file content.
- §3.3 trigger contract → Task 2.
- §10.1 empirical validation of Copilot loading → Task 3.
- No spec requirement for Plan 1 is unaddressed.

**Placeholder scan:** No TBD/TODO/"handle edge cases". The temporary `## Probe` block in Task 3 is intentional and explicitly removed in Step 4.

**Type consistency:** N/A (no code). File paths are consistent across tasks: `.github/copilot-instructions.md`, `docs/agents/coding-agent.md`, `.github/skills/automate-bug-fix/SKILL.md`.
