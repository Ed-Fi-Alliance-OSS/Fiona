# Coding Agent — Jira as source of truth (read-only)

**Date:** 2026-07-27
**Status:** Approved (design)

## Summary

Rework the Fiona coding agent so the **live Jira ticket is the source of
truth**, read directly (read-only) via an Atlassian MCP server. Remove the
current "synced GitHub issue body is the source of truth" model — GitHub issues
are no longer part of the flow. The agent produces a draft pull request, marks
it ready-for-review once green, and never merges. When a ticket is unworkable,
the agent halts and notifies the requester instead of commenting on an issue or
on Jira.

## Motivation

Today the coding agent (GitHub Copilot's cloud coding agent) is triggered by
assigning a Jira-synced GitHub issue to Copilot and treats the *issue body
snapshot* as the source of truth. That snapshot can drift from the live Jira
ticket. Reading the live ticket directly removes the drift and the GitHub-issue
middle layer.

## Scope

### In scope

- Agent, baseline instructions, skill, and docs updated to read the live Jira
  ticket as source of truth.
- Read-only Atlassian MCP access for Jira.
- Local MCP config (`.vscode/mcp.json`) for manual/IDE runs.
- Documentation of the cloud Copilot coding-agent MCP configuration (the cloud
  agent does not read `.vscode/mcp.json`).

### Out of scope (owned by the Technology team)

- Authenticating/provisioning the Atlassian MCP connection and secrets.
- The Jira → Copilot assignment integration itself.
- Any Jira writes (transitions, comments, worklogs) — the agent is read-only on
  Jira.

## Design

### Source of truth

The live Jira ticket, resolved by issue key and fetched read-only via the
Atlassian MCP server. The agent parses the bug/feature statement, acceptance
criteria, and reproduction/expected behavior from the ticket. There is no
GitHub issue in the flow.

### Entry points

All three resolve to a Jira issue key; the agent then reads the live ticket via
MCP:

1. **Jira assignment to Copilot** (primary, cloud route) — the
   Technology-team-owned integration hands the agent the Jira key.
1. **Explicit Jira key** passed to the agent.
1. **Manual / local invocation** (IDE) where the operator supplies the key.

### Jira access (read-only)

Atlassian MCP, read-only Jira tools only (get issue / search). No transitions,
comments, worklogs, or any write. Connection auth/provisioning is owned by the
Technology team.

### Incomplete-ticket handling

If the ticket is missing a clear problem statement, acceptance criteria, or (for
bugs) reproduction steps, the agent **stops** and **notifies the requester with
a message** describing exactly what is missing. It does not comment on Jira
(read-only) and there is no GitHub issue to comment on. It does **not** open a
pull request for an unworkable ticket.

### Pull request flow

- Open a **draft** pull request that references the Jira key in the title/body.
- Keep it draft while work is in progress.
- Once the affected app's lint and tests are green and the work is complete,
  mark the PR **ready-for-review** (final human pass only).
- Never mark work complete before it is verified green; never merge — merge is
  always human.

### MCP configuration

- **Local/manual (IDE):** add an `atlassian` server entry to `.vscode/mcp.json`,
  mirroring the existing `azure` entry, scoped to read-only Jira usage.
- **Cloud (Copilot coding agent):** the cloud agent does not read
  `.vscode/mcp.json`. Document the equivalent MCP configuration in
  `docs/agents/coding-agent.md` (repository Copilot coding-agent MCP settings
  JSON plus the required secret), noting the Technology team provisions it.

## Files changed

1. `.github/agents/coding-agent.agent.md` — Jira ticket as source of truth; add
   the read-only Atlassian Jira toolset; three entry points; notify-and-halt on
   incomplete tickets; draft → ready-for-review PR marking.
1. `.github/copilot-instructions.md` — update the always-on baseline: source of
   truth → live Jira ticket; drop issue-body and issue-comment language.
1. `docs/agents/coding-agent.md` — rewrite the trigger contract: Jira source of
   truth, three entry points, read-only MCP, the cloud MCP config note, and
   Technology-team ownership of auth and the Jira→Copilot integration.
1. `.github/skills/automate-bug-fix/SKILL.md` — inputs/validation read from the
   live Jira ticket; replace the "comment on the issue" fallback with
   notify-the-requester.
1. `.vscode/mcp.json` — add the read-only `atlassian` MCP server entry.

## Testing / verification

This is a documentation and configuration change (agent persona, baseline
instructions, skill, MCP config) with no application code. Verification is:

- The four instruction/doc files are internally consistent — no remaining
  "GitHub issue is source of truth" or "comment on the issue" language.
- `.vscode/mcp.json` remains valid JSON with the new `atlassian` server.
- The cloud MCP configuration is documented well enough for the Technology team
  to provision it.

## Risks / open items

- The exact notification channel for incomplete tickets (Slack, email, Copilot
  session summary) depends on what the Technology team provisions; the design
  specifies "notify the requester with a message" and leaves the concrete
  channel to that team.
- The precise Atlassian MCP server URL/command and secret names should be
  confirmed against the Technology-team-provisioned setup before the config is
  relied on in the cloud.
