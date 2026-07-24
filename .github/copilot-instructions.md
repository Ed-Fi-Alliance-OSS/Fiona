# Copilot Instructions for Fiona

These instructions apply to all GitHub Copilot work in this repository,
including the Copilot coding agent. Follow them for every task.

## Preferred agent

For implementation tickets assigned from Jira (bug fixes and features), prefer
the **coding-agent** custom agent (`.github/agents/coding-agent.agent.md`) and
the skills it carries. The instructions below are the always-on baseline for
all Copilot work; the coding-agent is the selectable persona for implementation
work and layers on top of them.

## Source of truth: the ticket

- Treat the linked issue body (synced from Jira) as the source of truth.
- Parse the bug or feature statement, any acceptance criteria, and the
  reproduction steps and/or the expected behavior.
- If required information is missing (no clear statement, no acceptance
  criteria, or no reproduction steps for a bug), STOP and comment describing
  exactly what is missing. Do not guess.

## Right-size the ceremony first

Before planning, score the change's feasibility:

1. **Score 1 (Small):** single reviewer, minimal context switching, focused files.
1. **Score 2 (Medium):** reviewable by one reviewer with moderate context.
1. **Score 3 (Large):** likely too broad for one-pass review.
1. **Score 4 (XL):** cross-cutting / multi-area / high coordination.

Then classify and act:

- **Small (Fast path)** — feasibility score 1 AND all of: touches 2 files or
  fewer and 50 changed lines or fewer; adds no new module, dependency, or
  public interface / API surface.
- **Standard path** — feasibility score 2 (or a score-1 change that exceeds
  the Small size triggers above).
- **Large (score 3)** — attempt a decomposition: split the work into
  independently-reviewable slices. If a clean split exists, proceed on the
  first slice as a Standard-path change and list the remaining slices (in the
  PR body or as follow-up issues). If you cannot split it cleanly, STOP and
  propose the decomposition instead of coding.
- **Too large (score 4)** — STOP and propose a decomposition into smaller,
  independently reviewable issues instead of coding.

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

The detailed, high-discipline implementation workflow (ticket validation,
scoped plan, fail-first tests, intent-alignment iterations, scope-drift check,
verification, PR) lives in the **coding-agent** custom agent
(`.github/agents/coding-agent.agent.md`). Lean on that agent and the skills it
carries for implementation tickets. These instructions remain the always-on
baseline that applies underneath it.
