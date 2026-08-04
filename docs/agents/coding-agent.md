# Coding Agent — trigger contract

The coding agent is GitHub Copilot's coding agent, steered by
`.github/copilot-instructions.md` and the **coding-agent** custom agent
(`.github/agents/coding-agent.agent.md`). The **live Jira ticket is the source
of truth** — read-only, via an Atlassian MCP server. There is no GitHub issue
in the flow.

> This document describes the expected handoff and configuration shape only. It
> does not authenticate or provision the Atlassian MCP connection, and it does
> not own the Jira → Copilot assignment integration — those are owned by the
> Technology team.

## Entry points

All three resolve to a Jira issue key; the agent then reads the live ticket via
the Atlassian MCP server:

1. **Jira assignment to Copilot** (primary, cloud route) — the
   Technology-team-owned integration assigns the ticket to Copilot and hands the
   agent the Jira key.
1. **Explicit Jira key** passed to the agent.
1. **Manual / local invocation** (IDE) where the operator supplies the key.

## Source-of-truth ticket shape

The agent reads these directly from the live Jira ticket:

- **Summary** — a concise statement of the change.
- **Problem statement** — the bug or feature described in plain language.
- **Acceptance criteria** — a testable definition of done.
- **Reproduction steps / expected behavior** — for bugs: the steps to
  reproduce, plus expected versus actual behavior.
- **Affected area** — a component or app hint (for example `apps/fiona-slack`).
- **Links** — related tickets, PRs, or docs.

## If the ticket is incomplete

If the ticket omits a clear problem statement, acceptance criteria, or (for
bugs) reproduction steps, the agent **stops** and **notifies the requester with
a message** describing exactly what is missing. Jira is read-only, so the agent
does not comment on the ticket; there is no GitHub issue to comment on either.
It does not open a pull request for an unworkable ticket.

## Jira access is read-only

The agent uses only read-only Atlassian MCP Jira tools (fetch issue by key,
search). It never transitions, comments on, or otherwise writes to Jira.

## MCP configuration

- **Local / manual (IDE):** `.vscode/mcp.json` defines an `atlassian` MCP
  server for local runs.
- **Cloud (Copilot coding agent):** the cloud agent does **not** read
  `.vscode/mcp.json`. The Technology team provisions the equivalent MCP
  configuration in the repository's Copilot coding-agent settings. Expected
  shape (confirm URL, tool names, and secret names against the provisioned
  setup):

  ```json
  {
    "mcpServers": {
      "atlassian": {
        "type": "sse",
        "url": "https://mcp.atlassian.com/v1/sse",
        "tools": ["getJiraIssue", "searchJiraIssuesUsingJql"]
      }
    }
  }
  ```

  Any credential is supplied via a `COPILOT_MCP_*` repository secret referenced
  by that configuration, owned by the Technology team.
