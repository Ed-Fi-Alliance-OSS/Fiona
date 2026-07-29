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

## Output rules (all runtimes)

- Produce exactly ONE consolidated change. Keep each proposed edit small and
  justified by cited data (e.g. "lint failed in N of M PRs").
- Only edit the coding-agent steering files above. Do not touch application
  code, the capture script, or the records' schema.
- Put **ticket-description improvement suggestions as prose** (in the PR body
  for the production flow, or in the run summary locally) — do NOT write them
  back to Jira.
- Include an AI-use disclosure and note assumptions and limitations.
- After synthesis, move the consumed `PR-*.json` files into
  `docs/postmortems/processed/` so they are not re-synthesized.
- The result is **human-gated**: never merge, and never auto-apply beyond what
  the runtime's delivery section allows.
- Never add human reviewer logins to any file; the records already exclude
  them — keep it that way.

## Delivery (Copilot production flow)

The production Copilot agent runs against the `postmortem-data` branch and:

- Reads the un-processed records from that branch.
- Opens exactly one **draft, human-gated** pull request applying the
  consolidated edits, with the ticket-description suggestions as prose in the
  PR body.
- Moves the consumed records to `docs/postmortems/processed/` in the same PR.
- Does NOT merge — a human takes the final pass.

The local Claude Code subagent overrides this delivery: it reads records from
the working tree and applies the edits as uncommitted changes for `git diff`
review (see its own agent file).
