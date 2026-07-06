# PRD: Agentic Workflows for Fiona Development

> **Status:** draft \
> **Owner:** Robert Hunter \
> **Parent document:** [Fiona Slack PRD](PRD-Fiona-slack.md) \
> **Jira Project:** AI \
> **Repository:** `Ed-Fi-Alliance-OSS/Fiona` (monorepo)

## 1. Overview

This document defines the requirements for agentic software development workflows on the Fiona
repository. These workflows run autonomously in the cloud — triggered by a human, but executing
without local resource consumption until a PR is ready for human review.

An agentic workflow in this context means:

- The repository has agent configuration files for supported AI harnesses
- Workflows are triggered from a Jira ticket in "refined" status
- The agent executes autonomously: reads the ticket, implements the work, runs pre-checks, and opens
  a PR
- Human intervention is required only at the review stage
- Workflows are modular and extendable

### 1.1 Strategic Alignment

Developer time on the Fiona project is constrained. Routine development tasks — bug fixes, minor
features, dependency updates, tech debt — consume attention that could be directed toward design,
review, and higher-order decisions. Cloud-based agentic workflows address this by delegating
well-defined tasks to an agent that runs asynchronously, freeing the developer to trigger-and-move-on
rather than context-switching into implementation.

This is the foundational capability for a broader community contribution pipeline. Once the core
team workflows are stable, the same agent infrastructure will support routing community-submitted
GitHub Issues into the development pipeline with minimal manual triage.

### 1.2 Jobs to be Done (JTBD)

**JTBD-BUG**: When a bug ticket reaches "refined" status in Jira, I want a cloud agent to reproduce
the bug, implement a fix with appropriate tests, and open a PR with all pre-checks passing, so that
I can review a complete, verified solution without consuming local development time.

**JTBD-FEAT**: When a feature ticket with acceptance criteria reaches "refined" status in Jira, I
want a cloud agent to implement the feature using test-driven practices and open a PR with all
pre-checks passing, so that I can review production-ready code without blocking other work.

**JTBD-TECH**: When a tech debt ticket reaches "refined" status in Jira, I want a cloud agent to
implement the remediation and open a PR with all pre-checks passing, so that maintenance work does
not compete with feature development for developer attention.

**JTBD-DEP**: When a Dependabot PR is opened for a patch or minor version update, I want a cloud
agent to validate compatibility, run the pre-check suite, and auto-merge if all checks pass, so that
dependency hygiene is maintained without manual intervention. For major version updates, the agent
escalates for human review.

**JTBD-TRIAGE** *(Phase 1 — stub)*: When a GitHub Issue is submitted by a community contributor, I
want an automated triage workflow to classify and route qualifying issues into the Jira pipeline, so
that community contributions can enter the development workflow without requiring manual review for
each submission. See the [Issue Triage Design Document](TBD) for detailed design.

### 1.3 Inspiration

The following links may offer inspiration for the identification and development of these workflows:

- <https://github.com/github/gh-aw>
- <https://github.com/github/copilot-sdk/blob/main/.github/agents/agentic-workflows.agent.md>
- <https://github.com/github/gh-aw-actions/blob/main/.github/workflows/agentics-maintenance.yml>
- <https://github.com/github/awesome-copilot/tree/main/agents>
- <https://github.com/github/copilot-cli/blob/main/.github/workflows/feature-request-comment.yml>
- <https://github.com/github/copilot-cli/blob/main/.github/workflows/no-response.yml>
- <https://github.com/dotnet/runtime/tree/main/.github/agents>
- <https://github.com/anthropics/claude-code/blob/main/.github/workflows/claude-dedupe-issues.yml>
- <https://github.com/anthropics/claude-code/blob/main/.github/workflows/claude-issue-triage.yml>
- <https://github.com/anthropics/claude-code/blob/main/.github/workflows/lock-closed-issues.yml>

Skills may be adopted from <https://github.com/addyosmani/agent-skills> (credit to be given in
`NOTICES.md`).

## 2. System Context

Two pipelines feed work into the agentic workflows:

**Phase 0 — Jira pipeline (core team):** A human refines a Jira ticket, sets its status to
"Refined", and triggers the agent. The agent performs a lightweight readiness check, executes the
work autonomously, and opens a PR. The human reviews the PR.

**Phase 1 — GitHub Issue pipeline (community):** A community contributor opens a GitHub Issue. An
automated triage step classifies the issue, validates it, and promotes qualifying issues into the
Jira pipeline as refined tickets. From that point, the Phase 0 workflow applies. Detailed design
for this pipeline is deferred to a separate document.

The trigger mechanism for the Phase 0 pipeline is an open question (see Section 6). Options under
consideration include Jira custom agents, GitHub Actions workflows that assign a label to kick off a
cloud routine, and extending a GitHub agent workflow to develop in a sandbox environment. In all
cases, the agent runs in the cloud — local resources are not required to remain active during
execution.

The boundary of agent responsibility is: ticket in "Refined" status → PR open with pre-checks
passing → human review requested. The agent does not deploy, does not merge, and does not perform
code review.

## 3. Functional Requirements

### 3.1 Cross-Cutting Concerns

**FR-CROSS-1**: All workflows must have consistent error handling and logging so that failures and
significant events are captured and analyzable across workflows.

**FR-CROSS-2**: All workflows must use consistent authentication and authorization mechanisms to
ensure only authorized users and agents can execute workflows and access sensitive resources.

**FR-CROSS-3**: All workflows must use consistent configuration management to allow customization
and adaptation across environments.

**FR-CROSS-4 — Modular Pre-check Suite**: All workflows must run a defined pre-check suite before
requesting human review. At minimum this includes linting, automated tests, and applicable agent
skills. The suite must be modular and extendable so that additional checks (e.g., Copilot code
review, security scans) can be added without modifying individual workflow definitions.

**FR-CROSS-5 — Ticket Readiness Check**: Before beginning any work, the agent must validate that
the Jira ticket meets readiness criteria: acceptance criteria are present, a story point estimate is
set, and the ticket is linked to a parent epic (exempt if the ticket is investigative or a one-off
task). If any criterion is not met, the agent must comment on the Jira ticket with the specific
reason for failure and halt without making code changes.

**FR-CROSS-6 — Cost Attribution**: All workflow execution costs, including API key usage, must be
attributable to the Fiona project and must not be commingled with personal or unrelated development
activity.

### 3.2 Bug Fix Workflow

Addresses JTBD-BUG.

**FR-BUG-1**: The agent must perform the readiness check defined in FR-CROSS-5 before beginning
implementation.

**FR-BUG-2**: The agent must follow test-driven development practices. If the bug is not covered by
an existing test, the agent must write a failing test that reproduces the bug before implementing
the fix.

**FR-BUG-3**: If the bug is covered by an existing test, the agent must first update the test to
reflect the correct expected behavior, then modify the implementation until the test passes.

**FR-BUG-4**: The agent must open a PR against the appropriate base branch with the full pre-check
suite passing before requesting human review.

### 3.3 New Feature Workflow

Addresses JTBD-FEAT.

**FR-FEAT-1**: The agent must perform the readiness check defined in FR-CROSS-5 before beginning
implementation.

**FR-FEAT-2 *(Phase 0 failure mode)***: If the ticket lacks sufficient specification for
implementation — missing acceptance criteria detail, ambiguous scope, or unresolved design questions
— the agent must comment on the Jira ticket with the specific gap identified and halt. Resolution
of underspecified tickets is a human responsibility upstream of this workflow.

**FR-FEAT-3**: The agent must follow test-driven development practices, writing tests against the
acceptance criteria before or alongside implementation.

**FR-FEAT-4**: The agent must open a PR against the appropriate base branch with the full pre-check
suite passing before requesting human review.

### 3.4 Tech Debt Workflow

Addresses JTBD-TECH.

**FR-TECH-1**: The agent must perform the readiness check defined in FR-CROSS-5 before beginning
implementation.

**FR-TECH-2**: The agent must open a PR against the appropriate base branch with the full pre-check
suite passing before requesting human review.

### 3.5 Dependabot Workflow

Addresses JTBD-DEP.

**FR-DEP-1**: When a Dependabot PR is opened for a patch or minor version update, the agent must
validate compatibility and run the full pre-check suite. If all checks pass, the agent must
auto-merge the PR.

**FR-DEP-2**: When a Dependabot PR is opened for a major version update, the agent must run the
pre-check suite and escalate to human review regardless of check results.

**FR-DEP-3**: If the pre-check suite fails for any Dependabot PR, the agent must comment on the PR
with the failure details and halt without merging.

### 3.6 Issue Triage Workflow *(Phase 1 — stub)*

Addresses JTBD-TRIAGE. Detailed functional requirements are deferred to the Issue Triage Design
Document. At a minimum, this workflow must:

- Accept a GitHub Issue as its input
- Classify the issue type and validate it meets minimum quality criteria
- Promote qualifying issues into the Jira pipeline as refined tickets
- Comment on the GitHub Issue with the outcome (accepted, rejected with reason, or escalated)

## 4. Non-Functional Requirements

**NFR-1 — Cost Attribution**: API keys and compute resources used by these workflows must be scoped
to the Fiona project. Usage must not be attributable to personal accounts or other projects.

**NFR-2 — Cloud Autonomy**: Workflows must execute entirely in cloud-hosted environments. Local
machines must not be required to remain active or connected for a workflow to run to completion.

## 5. Out of Scope

- Workflows not originating from a Jira ticket (Phase 0) or a GitHub Issue routed through triage
  (Phase 1)
- Cross-repository workflows
- Agent-performed code review (triggering an external review tool such as Copilot code review as a
  pre-check gate step is in scope; the agent itself is not a reviewer)
- Automated deployment or release management
- Self-identification of tech debt (deferred to Phase 2)

## 6. Open Questions

| # | Question | Status |
| --- | -------- | ------ |
| OQ-1 | Which trigger mechanism to use for the Phase 0 Jira pipeline: Jira custom agent, GitHub Actions label-based trigger, or GitHub agent sandbox workflow? | Open |
| OQ-2 | Which AI harness(es) to designate for cloud execution? Harness selection is an implementation detail outside this PRD, but the decision affects configuration and cost attribution. | Open |
| OQ-3 | Should the issue triage workflow (Phase 1) live in this repository or a separate one? | Open |

## 7. Development Phases

### Phase 0 — Core team, Jira-driven workflows

Deliver the four core JTBD workflows (JTBD-BUG, JTBD-FEAT, JTBD-TECH, JTBD-DEP) for the core
development team, triggered from Jira. All cross-cutting concerns (FR-CROSS-1 through FR-CROSS-6)
must be addressed in this phase. Cost attribution (NFR-1) is a Phase 0 requirement, but must not
block delivery of functional workflows if attribution tooling is not yet available — workflows may
be delivered with a documented gap and attribution addressed as a follow-on task.

### Phase 1 — Community contribution pipeline

Deliver the issue triage workflow (JTBD-TRIAGE), enabling community-submitted GitHub Issues to
enter the Jira pipeline. Detailed design is deferred to the Issue Triage Design Document.

### Phase 2 — Self-identification of tech debt

Extend the tech debt workflow to allow the agent to identify and create tech debt tickets without
requiring a human to initiate the Jira ticket. Scope and design are deferred.

## 8. Glossary

| Term | Definition |
| ---- | ---------- |
| Agentic Workflow | An automated process in which an AI agent executes a defined task autonomously from trigger to completion, requiring human input only at review. |
| Pre-check Suite | The modular set of automated validations (lint, tests, skills, and optional gates) that must pass before a PR is eligible for human review. |
| Readiness Check | The lightweight validation an agent performs against a Jira ticket before beginning work, confirming that acceptance criteria, estimate, and epic linkage are present. |
| Refined | The Jira ticket status indicating that a ticket has been reviewed by a human, meets readiness criteria, and is ready for agent or developer pickup. |
| JTBD | Jobs to be Done — a framework for expressing user needs as outcomes rather than feature descriptions. Format: "When [situation], I want to [action], so that [outcome]." |
| TDD | Test-Driven Development — a practice in which tests are written before or alongside implementation code. |
| Harness | The AI development tool used to run an agent (e.g., Claude Code, GitHub Copilot). |
