# PRD: Agentic Workflows for Fiona Development

> **Status:** rough draft \
> **Owner:** Robert Hunter \
> **Parent document:** [Fiona Slack PRD](PRD-Fiona-slack.md) \
> **Jira Project:** AI \
> **Repository:** `Ed-Fi-Alliance-OSS/Fiona` (monorepo)

> [!WARNING]
> Robert will own this document. Stephen is writing some initial notes for asynchronous collaboration, which can
> be completely replaced by Robert.

## 1. Overview

... deliver workflows for agentic software development on the Fiona repository.

... what does it mean to have an agentic workflow?

- Repo has agent file(s) for the AI harnesses used by developers and/or cloud agents
- Repo has sandbox setup instructions
- Repo has specialized skills, agents, and hooks for optimizing AI harnesses when executing on both generalized work and
  specific workflows
- Clear documentation on how to use the workflows
- "Push button" - or as close to it - going from a ticket to launching an appropriate agent

### 1.1 Strategic Alignment

... why are we doing this, strategically speaking?

### 1.2 Jobs to be Done (JTBD)

... below are some of the workflows that could be automated, what else might we have?

- Bug Fix
- New feature
- Tech debt
- Dependabot failure
- Issue triage (lowest priority, since Issues are not used extensively by the community yet, detailed design can be deferred; there are probably multiple issue triage JTBDs; open questions around GitHub Issues vs. Jira tickets vs. Both)

### 1.3 Inspiration

The following links may offer some inspiration for identification and development of these workflows

- https://github.com/github/gh-aw
- https://github.com/github/copilot-sdk/blob/main/.github/agents/agentic-workflows.agent.md
- https://github.com/github/gh-aw-actions/blob/main/.github/workflows/agentics-maintenance.yml
- https://github.com/github/awesome-copilot/tree/main/agents
- https://github.com/github/copilot-cli/blob/main/.github/workflows/feature-request-comment.yml
- https://github.com/github/copilot-cli/blob/main/.github/workflows/no-response.yml
- https://github.com/dotnet/runtime/tree/main/.github/agents
- https://github.com/anthropics/claude-code/blob/main/.github/workflows/claude-dedupe-issues.yml
- https://github.com/anthropics/claude-code/blob/main/.github/workflows/claude-issue-triage.yml
- https://github.com/anthropics/claude-code/blob/main/.github/workflows/lock-closed-issues.yml

Might copy some skills directly from https://github.com/addyosmani/agent-skills (give credit in NOTICES.md). For example, the
`test-driven-development` skill.

## 2. System Context

... describe our context of Jira --> Agent or Issue --> Agent (which path to take is to be determined). But it is more
complex than that: we don't want to merely log a ticket and send it to the agent. We want to make sure it is ready for
development. So there is a ticket refinement process before ready for agent. That refinement process might need to covered in
the requirements below. System Context section does not need design for that process. Just show that there is some refinement cycle.

## 3. Functional Requirements

### 3.1 Cross-Cutting Concerns

... these are concerns that cut across multiple workflows and need to be addressed consistently.

- **FR-CROSS-1**: All workflows must have consistent error handling and logging mechanisms to ensure that failures and
  important events are captured and can be analyzed across different workflows.
- **FR-CROSS-2**: All workflows must have consistent authentication and authorization mechanisms to ensure that only
  authorized users and agents can execute workflows and access sensitive information.
- **FR-CROSS-3**: All workflows must have consistent configuration management to allow easy customization and adaptation of
  workflows to different environments and use cases.

... maybe good to include hooks in this list
... maybe good to specify that agentic workflows SHOULD (not SHALL) automatically monitor and fix build failures. SHALL is my
actual strong preference, but since we just don't know if that is possible in Copilot Cloud Agent, I don't want to enshrine
that as a requirement prematurely. Basic idea is that we want the agent to loop until it is done. Might just mean telling it to always run lint and test after changes, via CLAUDE.md.

### 3.2 Bug Fix Workflow

... this workflow addresses the process of identifying, fixing, and verifying bugs within the software.

- **FR-BUG-1**: ...

... mention something about test driven development and ensuring that bug fixes are accompanied by appropriate tests to
verify the correctness of the fix and prevent regressions. Do we want to be prescriptive about TDD? And clarify that, if the
bug _is_ covered by a test, the process should first modify the test to the _correct_ behavior, then modify the code so that
the test passes? Is that being overly restrictive? Also, should this point about TDD be in the cross-cutting concerns?

... then add other workflow requirements below this

### 4. Non-Functional Requirements

... are there any NFR's that should be listed? Billing tied to the repository/project is an NFR. Support for both GitHub
Copilot and Claude Code might be NFR's... certainly we want them both locally, but we might only want _one_ in the cloud as
default? Use either when you want more control locally, or when designing in the refinement process, but then use only one in
the cloud when delegating? Maybe that is unnecessarily prescriptive? Also implications for AGENTS.md reading CLAUDE.md?

### 5. Out-of-Scope and Known Limitations

...

### 6. Open Questions

... which local and cloud harnesses to support.
...

### 7. Development Phases

... does it make sense to describe any phases for the development work? If nothing else, could be a "Phase 1: software dev,
Phase 2: issue management". Phases would generally encompass JTBDs, but could also encompass scope on requirements - i.e.
defer some specific requirements from Phase 1 to Phase 2. Billing comes to mind: it is very important, but somewhat outside
of our control. I would not let that be a barrier to delivering some agents that can run locally or in the cloud,
demonstrating completion of some of the JTBDs.

### 8. Glossary

| Term | Definition |
| ---- | ---------- |
| TBD  | TBD        |
