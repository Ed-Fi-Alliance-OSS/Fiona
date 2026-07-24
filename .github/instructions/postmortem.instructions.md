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
