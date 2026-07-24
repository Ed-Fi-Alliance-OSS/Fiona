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
- **Reproduction steps / expected behavior** — for bugs: the steps to
  reproduce, plus expected versus actual behavior.
- **Affected area** — a component or app hint (for example
  `apps/fiona-slack`).
- **Links** — related tickets, PRs, or docs.

## If the ticket is incomplete

Per `.github/copilot-instructions.md`, if the issue omits a clear problem
statement, acceptance criteria, or (for bugs) repro steps, the agent stops and
comments describing exactly what is missing rather than guessing.
