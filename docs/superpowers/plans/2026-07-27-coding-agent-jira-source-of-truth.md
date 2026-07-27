# Coding Agent — Jira Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live Jira ticket the read-only source of truth for the Fiona coding agent, remove the GitHub-issue middle layer, and produce a draft PR that the agent marks ready-for-review once green.

**Architecture:** This is a documentation + configuration change across four instruction/doc files plus one MCP config file. No application code. The agent reads Jira via a read-only Atlassian MCP server; it opens a draft PR referencing the Jira key and marks it ready-for-review when lint/tests pass. Incomplete tickets halt with a notification to the requester (no Jira write, no GitHub issue).

**Tech Stack:** Markdown instruction files, JSON MCP config (`.vscode/mcp.json`), GitHub Copilot custom-agent format, Atlassian remote MCP server.

## Global Constraints

- **Read-only Jira.** The agent never transitions, comments, or otherwise writes to Jira.
- **No GitHub issues** anywhere in the flow — no "issue body is source of truth", no "comment on the issue".
- **Technology-team ownership** of the Atlassian MCP connection auth/secrets and the Jira→Copilot assignment integration; the agent config only consumes them.
- **Never merge.** The agent marks the PR ready-for-review; a human reviews and merges.
- Atlassian MCP server URL and secret names in this plan are best-effort defaults; a comment in each config must note they are confirmed against the Technology-team-provisioned setup.
- Verification for this plan is grep/JSON-parse based (no app test suite touches these files).

---

### Task 1: Add the read-only Atlassian MCP server to `.vscode/mcp.json`

**Files:**
- Modify: `.vscode/mcp.json`

**Interfaces:**
- Consumes: nothing.
- Produces: an `atlassian` MCP server entry that local/IDE runs of the agent use for read-only Jira access. Referenced by name (`atlassian`) in Task 3 and Task 4.

- [ ] **Step 1: Add the `atlassian` server entry**

Replace the file contents with:

```json
{
  "servers": {
    "azure": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"]
    },
    "atlassian": {
      "type": "sse",
      "url": "https://mcp.atlassian.com/v1/sse"
    }
  }
}
```

Note: confirm the `url` against the Technology-team-provisioned Atlassian MCP endpoint before relying on it for local runs. The agent uses only read-only Jira tools from this server.

- [ ] **Step 2: Verify the file is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.vscode/mcp.json','utf8')); console.log('valid json')"`
Expected: prints `valid json`.

- [ ] **Step 3: Verify both servers are present**

Run: `node -e "const c=JSON.parse(require('fs').readFileSync('.vscode/mcp.json','utf8')); console.log(Object.keys(c.servers).sort().join(','))"`
Expected: prints `atlassian,azure`.

- [ ] **Step 4: Commit**

```bash
git add .vscode/mcp.json
git commit -m "feat: add read-only Atlassian MCP server for local Jira access"
```

---

### Task 2: Rewrite the trigger contract in `docs/agents/coding-agent.md`

**Files:**
- Modify: `docs/agents/coding-agent.md` (full rewrite of body)

**Interfaces:**
- Consumes: the `atlassian` server name from Task 1.
- Produces: the canonical description of the Jira-source-of-truth flow, the three entry points, and the cloud Copilot coding-agent MCP config that the Technology team provisions. Referenced by Task 3 (copilot-instructions) and Task 4 (agent).

- [ ] **Step 1: Replace the file contents**

Write `docs/agents/coding-agent.md` as:

````markdown
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
````

- [ ] **Step 2: Verify no stale GitHub-issue-source language remains**

Run: `grep -niE "synced (issue|from jira)|issue body|comment on the issue|assigning a github issue" docs/agents/coding-agent.md`
Expected: no matches (exit 1 / empty output).

- [ ] **Step 3: Verify the new anchors are present**

Run: `grep -niE "source of truth|read-only|Entry points|MCP configuration|notifies the requester" docs/agents/coding-agent.md`
Expected: matches for each phrase.

- [ ] **Step 4: Commit**

```bash
git add docs/agents/coding-agent.md
git commit -m "docs: rewrite coding-agent trigger contract for Jira source of truth"
```

---

### Task 3: Update the always-on baseline in `.github/copilot-instructions.md`

**Files:**
- Modify: `.github/copilot-instructions.md:14-22` (the "Source of truth: the ticket" section) and the closing "Deep playbook" reference.

**Interfaces:**
- Consumes: the flow described in Task 2.
- Produces: the baseline source-of-truth rule that the agent (Task 4) layers on top of.

- [ ] **Step 1: Replace the "Source of truth" section**

Replace the current section:

```markdown
## Source of truth: the ticket

- Treat the linked issue body (synced from Jira) as the source of truth.
- Parse the bug or feature statement, any acceptance criteria, and the
  reproduction steps and/or the expected behavior.
- If required information is missing (no clear statement, no acceptance
  criteria, or no reproduction steps for a bug), STOP and comment describing
  exactly what is missing. Do not guess.
```

with:

```markdown
## Source of truth: the Jira ticket

- Treat the **live Jira ticket** (read-only, via the Atlassian MCP server) as
  the source of truth. There is no GitHub issue in the flow. The ticket key
  arrives from the Jira→Copilot assignment, an explicit key, or manual
  invocation (see `docs/agents/coding-agent.md`).
- Parse the bug or feature statement, any acceptance criteria, and the
  reproduction steps and/or the expected behavior directly from the ticket.
- Jira access is read-only: never transition, comment on, or write to Jira.
- If required information is missing (no clear statement, no acceptance
  criteria, or no reproduction steps for a bug), STOP and notify the requester
  with a message describing exactly what is missing. Do not guess, and do not
  open a pull request for an unworkable ticket.
```

- [ ] **Step 2: Reword the decomposition follow-ups so they don't reference GitHub issues**

There are two decomposition references to "issues" in the "Right-size the ceremony first" section. Since there are no GitHub issues and Jira is read-only (the agent recommends, it does not create tickets):

Replace:

```markdown
  first slice as a Standard-path change and list the remaining slices (in the
  PR body or as follow-up issues). If you cannot split it cleanly, STOP and
  propose the decomposition instead of coding.
```

with:

```markdown
  first slice as a Standard-path change and list the remaining slices in the PR
  body (and recommend them to the requester as follow-up tickets). If you cannot
  split it cleanly, STOP and propose the decomposition instead of coding.
```

Replace:

```markdown
- **Too large (score 4)** — STOP and propose a decomposition into smaller,
  independently reviewable issues instead of coding.
```

with:

```markdown
- **Too large (score 4)** — STOP and propose a decomposition into smaller,
  independently reviewable tickets instead of coding.
```

- [ ] **Step 3: Verify no stale issue-source or GitHub-issue language remains**

Run: `grep -niE "issue body|synced from jira|comment describing|linked issue|follow-up issues|reviewable issues" .github/copilot-instructions.md`
Expected: no matches.

- [ ] **Step 4: Verify the new rule is present**

Run: `grep -niE "live Jira ticket|read-only|notify the requester" .github/copilot-instructions.md`
Expected: matches for each phrase.

- [ ] **Step 5: Commit**

```bash
git add .github/copilot-instructions.md
git commit -m "docs: baseline copilot-instructions to Jira source of truth (read-only)"
```

---

### Task 4: Update the coding-agent custom agent `.github/agents/coding-agent.agent.md`

**Files:**
- Modify: `.github/agents/coding-agent.agent.md` (frontmatter `tools` + `description`, the "Source of truth" section, and the "Pull request" section)

**Interfaces:**
- Consumes: the `atlassian` MCP server (Task 1), the flow doc (Task 2), the baseline rule (Task 3).
- Produces: the selectable agent persona with read-only Jira access and the draft→ready-for-review PR behavior.

- [ ] **Step 1: Update the frontmatter**

Replace the frontmatter `description` and `tools` lines:

```yaml
description: "Use for Jira-assigned implementation work in the Fiona repo. Reads the live Jira ticket (read-only) as the source of truth, scores and right-sizes the work, follows fail-first TDD, keeps changes tightly scoped, verifies lint and tests green, and opens a draft pull request it marks ready-for-review for HITL."
tools: ["read", "edit", "search", "execute", "atlassian"]
```

Note: `atlassian` names the read-only Jira MCP server; confirm the exact tool identifier(s) against the Technology-team-provisioned Copilot MCP configuration (see `docs/agents/coding-agent.md`).

- [ ] **Step 2: Replace the "Source of truth: the ticket" section**

Replace:

```markdown
## Source of truth: the ticket

- Treat the assigned issue body (synced from Jira) as the source of truth.
- Parse the bug or feature statement, any acceptance criteria, and the
  reproduction steps and/or the expected behavior.
- If required information is missing (no clear statement, no acceptance
  criteria, or no reproduction steps for a bug), STOP and comment on the issue
  describing exactly what is missing. Do not guess or invent requirements.
```

with:

```markdown
## Source of truth: the live Jira ticket

- You are handed a Jira issue key (from a Jira→Copilot assignment, an explicit
  key, or manual invocation). Read the **live Jira ticket** for that key,
  read-only, via the Atlassian MCP server. There is no GitHub issue in the flow.
- Treat that live ticket as the source of truth. Parse the bug or feature
  statement, any acceptance criteria, and the reproduction steps and/or the
  expected behavior.
- Jira access is read-only: never transition, comment on, or write to Jira.
- If required information is missing (no clear statement, no acceptance
  criteria, or no reproduction steps for a bug), STOP and notify the requester
  with a message describing exactly what is missing. Do not guess or invent
  requirements, and do not open a pull request for an unworkable ticket.
```

- [ ] **Step 3: Replace the "Pull request" section**

Replace:

```markdown
## Pull request

Open a draft pull request for human review. Include:

- a summary of the bug or feature and the fix;
- the plan and feasibility score (Standard path) or the intent note (Fast path);
- the test intent-alignment outcome;
- the verification results (lint and tests green);
- any justified scope exceptions;
- a flag if the change affects a user-facing interface or API that needs
  documentation.

Never merge the pull request yourself — it is always human-reviewed.
```

with:

```markdown
## Pull request

Open a **draft** pull request that references the Jira key in the title and
body, and keep it in draft while work is in progress. Include:

- a summary of the bug or feature and the fix;
- the plan and feasibility score (Standard path) or the intent note (Fast path);
- the test intent-alignment outcome;
- the verification results (lint and tests green);
- any justified scope exceptions;
- a flag if the change affects a user-facing interface or API that needs
  documentation.

Once the work is complete and the affected app's lint and tests are green, mark
the PR **ready-for-review** so a human can take the final HITL pass. Never mark
the PR ready before verifying it is green, and never merge it yourself — merge
is always human.
```

- [ ] **Step 4: Reword the decomposition follow-ups so they don't reference GitHub issues**

In the "Score the work" section, replace:

```markdown
  first slice as a Standard-path change and list the remaining slices in the PR
  body or as follow-up issues. If you cannot split it cleanly, STOP and propose
  the decomposition instead of coding.
```

with:

```markdown
  first slice as a Standard-path change and list the remaining slices in the PR
  body (and recommend them to the requester as follow-up tickets). If you cannot
  split it cleanly, STOP and propose the decomposition instead of coding.
```

Replace:

```markdown
- **Too large (score 4)** — STOP and propose a decomposition into smaller,
  independently reviewable issues instead of coding.
```

with:

```markdown
- **Too large (score 4)** — STOP and propose a decomposition into smaller,
  independently reviewable tickets instead of coding.
```

- [ ] **Step 5: Verify no stale issue-source or GitHub-issue language remains**

Run: `grep -niE "issue body|synced from jira|comment on the issue|follow-up issues|reviewable issues" .github/agents/coding-agent.agent.md`
Expected: no matches.

- [ ] **Step 6: Verify the new behavior is present**

Run: `grep -niE "live Jira ticket|Atlassian MCP|read-only|ready-for-review|notify the requester" .github/agents/coding-agent.agent.md`
Expected: matches for each phrase.

- [ ] **Step 7: Commit**

```bash
git add .github/agents/coding-agent.agent.md
git commit -m "feat: coding-agent reads live Jira ticket (read-only), marks PR ready-for-review"
```

---

### Task 5: Update the `automate-bug-fix` skill

**Files:**
- Modify: `.github/skills/automate-bug-fix/SKILL.md` (frontmatter `description`, the `## Inputs` section, and step `### 1) Validate Jira Ticket Readiness`)

**Interfaces:**
- Consumes: the read-only Jira flow (Tasks 2–4).
- Produces: the skill workflow aligned with reading the live ticket and notifying (not commenting) on incompleteness.

- [ ] **Step 1: Update the `## Inputs` section**

Replace:

```markdown
## Inputs

- Jira issue link or ticket details
- Target repository and branch context
- Any acceptance criteria or reproduction details from the bug report
```

with:

```markdown
## Inputs

- A Jira issue key (from a Jira→Copilot assignment, an explicit key, or manual
  invocation). Read the live ticket read-only via the Atlassian MCP server — it
  is the source of truth. There is no GitHub issue in the flow.
- Target repository and branch context.
- Acceptance criteria or reproduction details are read from the live ticket, not
  from a pasted snapshot.
```

- [ ] **Step 2: Update the incomplete-ticket fallback in step 1**

In `### 1) Validate Jira Ticket Readiness`, replace the line:

```markdown
If required information is missing, stop and leave a comment detailing what is missing.
```

with:

```markdown
If required information is missing, STOP and notify the requester with a message detailing what is missing. Jira is read-only — do not comment on the ticket, and there is no GitHub issue to comment on. Do not open a pull request for an unworkable ticket.
```

- [ ] **Step 3: Align the description frontmatter (read-only wording)**

Replace the frontmatter `description` value with:

```yaml
description: Use when triaging and fixing Jira bugs that are marked ready for work; reads the live Jira ticket read-only as the source of truth, performs validation, feasibility scoring, scoped planning, fail-first tests, intent alignment checks, constrained refactor, lint/test verification, and draft-then-ready-for-review PR creation.
```

- [ ] **Step 4: Verify no stale issue-source language remains**

Run: `grep -niE "leave a comment|issue link|comment on" .github/skills/automate-bug-fix/SKILL.md`
Expected: no matches (the `## Output Expectations` PR-link line is fine; this grep targets issue-comment wording only).

- [ ] **Step 5: Verify the new wording is present**

Run: `grep -niE "live ticket|Atlassian MCP|read-only|notify the requester" .github/skills/automate-bug-fix/SKILL.md`
Expected: matches for each phrase.

- [ ] **Step 6: Commit**

```bash
git add .github/skills/automate-bug-fix/SKILL.md
git commit -m "docs: automate-bug-fix reads live Jira ticket (read-only), notify on incomplete"
```

---

## Cross-file consistency check (final)

- [ ] **Step 1: Confirm no file still names a GitHub issue as source of truth**

Run: `grep -rniE "issue body|synced from jira|comment on the issue|assigning a github issue|follow-up issues|reviewable issues" .github/agents/coding-agent.agent.md .github/copilot-instructions.md docs/agents/coding-agent.md .github/skills/automate-bug-fix/SKILL.md`
Expected: no matches across all four files.

- [ ] **Step 2: Confirm `.vscode/mcp.json` is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.vscode/mcp.json','utf8')); console.log('ok')"`
Expected: prints `ok`.
