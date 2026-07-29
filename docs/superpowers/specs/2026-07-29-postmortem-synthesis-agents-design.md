# Post-mortem synthesis agents — design

Date: 2026-07-29
Status: Proposed (extends
`docs/superpowers/specs/2026-07-24-copilot-coding-and-postmortem-agents-design.md`)

## Problem

Phase 2 (synthesis) of the post-mortem loop currently exists only as a GitHub
workflow that opens a Copilot-assigned issue plus a steering file
(`.github/instructions/postmortem.instructions.md`). There is no way to run the
synthesis **locally in the workspace** to preview and apply the suggested
steering-file improvements, and the analysis policy is entangled with the
GitHub-specific delivery mechanics (the `postmortem-data` branch and "open a
PR"), so a second runtime cannot reuse it cleanly.

## Goal

Let a synthesis run happen in two runtimes that **share one analysis policy** and
differ only in their I/O adapter:

- **Locally (Claude Code):** read records from the working tree, apply the
  consolidated edits as **uncommitted** changes for `git diff` review.
- **In production (Copilot/GitHub):** read records from the `postmortem-data`
  branch, open **one human-gated PR**.

## Design

A synthesis agent = **shared analysis policy** + a thin **I/O adapter**. Only
the adapter differs between runtimes.

### 1. `.github/instructions/postmortem.instructions.md` (edit)

Refactor into the delivery-neutral **analysis core**: the questions to answer
across records, the steering files that may be edited
(`.github/copilot-instructions.md`, `.github/agents/*.agent.md`), the PII rules,
"one consolidated minimal change justified by cited data", "ticket-description
suggestions as prose (never written to Jira)", and the human-gated /
never-merge principle. Move the branch + PR + `processed/` mechanics into a
short **"Delivery (Copilot production flow)"** section so the core is
runtime-agnostic and both adapters can delegate to it.

### 2. `.claude/agents/postmortem-synthesis.md` (new) — local runner

Claude Code subagent. Tools: read, edit, grep/glob, bash. Body delegates the
analysis to file #1, then overrides I/O:

- **Input:** local working tree `docs/postmortems/PR-*.json`.
- **Delivery:** apply the consolidated edits as **uncommitted** working-tree
  changes; move consumed records to `docs/postmortems/processed/`. Do **not**
  commit, push, or open a PR — the human reviews via `git diff` and keeps or
  discards.

### 3. `.github/agents/postmortem-synthesis.agent.md` (new) — production adapter

Copilot custom agent, symmetric with `coding-agent.agent.md`, giving the live
Phase 2 flow a named agent. Body delegates the analysis to file #1, then
overrides I/O:

- **Input:** records on the `postmortem-data` branch.
- **Delivery:** open exactly one **human-gated** PR editing the steering files;
  move consumed records to `processed/` in that PR; never merge.

### Prerequisite bug fix

`deriveTimeToFirstGreen` in `scripts/postmortem/capture.js` takes
`Math.min(...greens)` over green check timestamps without excluding GitHub's
sentinel `0001-01-01T00:00:00Z` (returned for status contexts such as
`license/cla`). The sentinel becomes the "first green", producing a garbage
negative `timeToFirstGreenCiMinutes` (~-1.06e9) in 6 of 7 sampled records. Fix:
drop non-positive timestamps (`t > 0`) before `Math.min`. Add a regression test.
Re-capture the sample records afterward so the local Phase 2 run reads clean
data.

## What is shared vs. what differs

| | Shared | Differs |
|---|---|---|
| Analysis questions, editable files, PII rules, output constraints | ✅ (file #1) | |
| Record schema | ✅ (`capture.js`) | |
| Input location | | working tree (local) vs `postmortem-data` branch (prod) |
| Delivery | | uncommitted edits (local) vs one PR (prod) |
| Format/runtime | | `.claude/agents/*.md` vs `.github/agents/*.agent.md` |

## Non-goals

- No auto-commit, auto-push, or auto-merge in either runtime — human-gated
  throughout.
- No change to Phase 1 capture behavior beyond the `timeToFirstGreen` bug fix.
- No writing suggestions back to Jira.

## Privacy / accountability

Records already store only participant roles + `authorAssociation`, never
reviewer logins, and comment text only as class counts. Both agents preserve
this and must never add reviewer logins to any file. All output is AI-assisted
and human-gated; a human is accountable for anything merged.
