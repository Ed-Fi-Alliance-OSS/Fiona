# PRD: Agentic Workflows for Fiona Development

> **Status:** draft \
> **Owner:** Robert Hunter \
> **Parent document:** [Fiona Slack PRD](PRD-Fiona-slack.md) \
> **Jira Project:** AI \
> **Repository:** `Ed-Fi-Alliance-OSS/Fiona` (monorepo)

## 1. Overview

This document defines the requirements for an agentic development platform on the Fiona repository.
The platform enables the internal product team — and eventually the broader community — to delegate
software development tasks to cloud agents using natural language specifications, without babysitting
an IDE, steering a chat session, or maintaining local compute.

This platform is an implementation of **Agentic Loop Engineering**: a shift from automation built
on deterministic, sequential steps to systems built on loops — cycles of reasoning, action, and
observation that continue until a governance condition terminates them. The analogy to recursion is
useful: just as recursion trades simplicity and stack predictability for expressive power, agentic
loops trade determinism for flexibility. And just as unbounded recursion causes call-stack explosion,
agentic loops without guardrails cause token and cost explosion. The governance layer is the base
case.

The agent in these workflows is the combination of a model and a harness. What this platform
engineers is the layer above that: the **meta-harness** — the collection of skills, configuration
files, hooks, and agent definitions that load context, enforce practices, and shape how the agent
reasons. Previously, a developer would guide an agent interactively, effectively playing the factory.
This platform shifts the developer into the role of **factory operator**: designing and tuning the
system that runs the factory, rather than running it personally.

The result is a workflow that product owners and community contributors can steer with natural
language (through a refined Jira ticket), which the agent executes from ticket to Draft PR with
minimal human oversight.

### 1.1 Strategic Alignment

Developer time on the Fiona project is constrained. Routine implementation tasks — bug fixes, minor
features, dependency updates, tech debt remediation — consume cycles that could be directed toward
system architecture, meta-harness design, and governance. Cloud-based agentic workflows address this
directly: a human verifies that a ticket is ready for work, kicks off the pipeline from Jira, and
returns when there is a PR to review.

The longer-term goal is a platform that product owners and community contributors alike can use to
steer development with natural language. Specifications in a refined ticket, combined with the
meta-harness (model, skills, best-practice configuration), drive the Agentic Development Life Cycle
(ADLC) from ticket to Draft PR. This reduces time spent on implementation details and frees it for
the higher-order work of designing the systems that govern agents.

A secondary output of operating this platform is the accumulation of observability data: links
between agent actions, code quality outcomes, and reviewer feedback. This data feeds back into
meta-harness improvement — better skills, better configuration, better governance. The platform
learns from its own operation over time.

### 1.2 Jobs to be Done (JTBD)

**JTBD-BUG**: When a bug ticket reaches "refined" status in Jira, I want to trigger a cloud agent
from the ticket that reproduces the bug, implements a fix with tests following TDD/BDD practices,
and opens a Draft PR with all pre-checks passing, so that I can review a complete, verified solution
without consuming local development time or steering the agent interactively.

**JTBD-FEAT**: When a feature ticket with acceptance criteria reaches "refined" status in Jira, I
want to trigger a cloud agent from the ticket that implements the feature using BDD/TDD practices
and opens a Draft PR with all pre-checks passing, so that I can review production-ready code without
blocking other work.

**JTBD-TECH**: When a tech debt ticket reaches "refined" status in Jira, I want to trigger a cloud
agent from the ticket that implements the remediation and opens a Draft PR with all pre-checks
passing, so that maintenance work does not compete with feature development for developer attention.

**JTBD-DEP**: When a Dependabot PR is opened for a patch or minor version update, I want a cloud
agent to validate compatibility, run the pre-check suite, and auto-merge if all checks pass, so that
dependency hygiene is maintained without manual intervention. For major version updates, the agent
escalates for human review.

**JTBD-OBS**: When a workflow executes, I want telemetry linking agent actions to code quality
outcomes and pre-check results, so that I can observe the effectiveness of the meta-harness and
identify improvements to skills, configuration, and governance policies.

**JTBD-FEEDBACK** *(Phase 1 — stub)*: When a reviewer comments on an agent-produced PR, I want
those comments to be captured and used to refine skills and configuration, so that the agent handles
similar issues better in future runs and the meta-harness improves continuously.

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

**Phase 0 — Jira pipeline (core team):** A human refines a Jira ticket and triggers the workflow
directly from the ticket via a button or API call. The agent loads the meta-harness (Ed-Fi best
practices, relevant skills, configuration), performs a lightweight readiness check, executes the
ADLC autonomously, and opens a Draft PR. The human reviews the PR. Local compute is not required
during execution.

**Phase 1 — GitHub Issue pipeline (community):** A community contributor opens a GitHub Issue. An
automated triage step classifies the issue, validates it, and promotes qualifying issues into the
Jira pipeline as refined tickets. From that point, the Phase 0 workflow applies. Detailed design
for this pipeline is deferred to a separate document.

The boundary of agent responsibility is: ticket in "Refined" status → Draft PR open with pre-checks
passing → human review requested. The agent does not deploy, does not merge, and does not perform
code review. Governance policies regulate loop termination throughout execution.

Observability telemetry is emitted throughout the workflow, linking actions to outcomes and feeding
back into meta-harness improvement over time (see JTBD-OBS, JTBD-FEEDBACK).

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

**FR-CROSS-7 — Observability**: All workflows must emit telemetry (via OpenTelemetry or equivalent)
linking agent actions to their observed outcomes (pre-check results, test pass/fail, review
feedback). This telemetry must be structured to support future feedback loops into meta-harness
improvement.

**FR-CROSS-8 — Governance and Guardrails**: All workflows must implement governance policies that
define loop termination conditions — equivalent to a base case in recursion. Policies must be
observable: when a guardrail is triggered, it must be logged and surfaced to the operator. Policies
must be configurable without modifying workflow definitions.

**FR-CROSS-9 — Jira Trigger**: Phase 0 workflows must be triggerable directly from a Jira ticket
via a button or API call. No local tooling should be required to initiate execution.

**FR-CROSS-10 — Meta-Harness Loading**: Upon trigger, the agent must load the current Ed-Fi
best-practice configuration, applicable skills, and relevant context before beginning any
implementation work. This configuration is the meta-harness and must be version-controlled alongside
the codebase.

### 3.2 Agentic Development Life Cycle (ADLC)

The ADLC defines the ordered sequence of activities the agent follows for all implementation
workflows (JTBD-BUG, JTBD-FEAT, JTBD-TECH). It is not a one-shot prompt but a governed loop:

1. **Load meta-harness** — load skills, configuration, and Ed-Fi best practices (FR-CROSS-10)
2. **Readiness check** — validate ticket criteria (FR-CROSS-5); halt and comment if not met
3. **Write failing tests** — using acceptance criteria (BDD) and/or reproduction steps (bug),
   write tests that express the expected behavior and confirm they fail before any implementation
   begins. Commit the failing tests as an early commit to allow reviewers to validate direction.
4. **Open Draft PR** — open the PR in draft status immediately after the failing-test commit,
   enabling reviewers to steer the implementation before deep changes are made
5. **Implement** — write implementation code in small, focused commits that make tests pass one
   by one, minimizing the blast radius of merge conflicts
6. **Pre-check suite** — run all checks defined in FR-CROSS-4; iterate to resolve failures before
   proceeding
7. **Request review** — transition the PR from Draft to ready for review and notify the assignee

### 3.3 Bug Fix Workflow

Addresses JTBD-BUG.

**FR-BUG-1**: The agent must follow the ADLC defined in Section 3.2.

**FR-BUG-2**: The failing test written in ADLC step 3 must reproduce the reported bug. If an
existing test already covers the scenario, the agent must first update that test to reflect the
correct expected behavior, confirm it fails, then implement the fix.

**FR-BUG-3**: Implementation commits must be small and focused. No unrelated refactoring or
cleanup should be included in the same PR.

### 3.4 New Feature Workflow

Addresses JTBD-FEAT.

**FR-FEAT-1**: The agent must follow the ADLC defined in Section 3.2.

**FR-FEAT-2 *(Phase 0 failure mode)***: If the ticket lacks sufficient specification —
missing acceptance criteria detail, ambiguous scope, or unresolved design questions — the agent
must comment on the Jira ticket with the specific gap identified and halt. Resolution of
underspecified tickets is a human responsibility upstream of this workflow.

**FR-FEAT-3**: Failing tests in ADLC step 3 must be derived from the acceptance criteria in the
Jira ticket, expressing the expected behavior in BDD style where appropriate.

**FR-FEAT-4**: Implementation commits must be small and focused, limited to the scope of the
acceptance criteria.

### 3.5 Tech Debt Workflow

Addresses JTBD-TECH.

**FR-TECH-1**: The agent must follow the ADLC defined in Section 3.2.

**FR-TECH-2**: Implementation commits must be small and focused. Scope must not expand beyond what
is described in the ticket.

### 3.6 Dependabot Workflow

Addresses JTBD-DEP.

**FR-DEP-1**: When a Dependabot PR is opened for a patch or minor version update, the agent must
validate compatibility and run the full pre-check suite. If all checks pass, the agent must
auto-merge the PR.

**FR-DEP-2**: When a Dependabot PR is opened for a major version update, the agent must run the
pre-check suite and escalate to human review regardless of check results.

**FR-DEP-3**: If the pre-check suite fails for any Dependabot PR, the agent must comment on the PR
with the failure details and halt without merging.

### 3.7 Observability Workflow

Addresses JTBD-OBS.

**FR-OBS-1**: The platform must collect and expose telemetry covering at minimum: workflow trigger
events, readiness check outcomes, ADLC step completions, pre-check suite results, and PR open
events.

**FR-OBS-2**: Telemetry records must link each action to its observed result in a format that
supports future automated feedback into meta-harness improvement.

**FR-OBS-3**: Governance policy activations (guardrail triggers, loop terminations) must appear as
distinct, observable events in the telemetry stream.

### 3.8 Feedback Loop *(Phase 1 — stub)*

Addresses JTBD-FEEDBACK. Detailed functional requirements are deferred. At a minimum, this
capability must:

- Capture reviewer comments and requested changes from agent-produced PRs
- Associate feedback with the workflow run and meta-harness version that produced the PR
- Provide a mechanism to translate feedback into improvements to skills, `CLAUDE.md`, or other
  meta-harness configuration
- Maintain a link between each piece of feedback, its source, and the resulting configuration change

### 3.9 Issue Triage Workflow *(Phase 1 — stub)*

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

**NFR-3 — Observability**: The platform must expose telemetry in a format compatible with
OpenTelemetry-based tooling. Operators must be able to assess workflow quality and governance
activity without inspecting logs manually.

**NFR-4 — Governance**: Loop termination conditions must be defined and configurable for all
agentic workflows. Unbounded execution is not acceptable. Token and cost limits must be enforceable
as governance policies.

## 5. Out of Scope

- Workflows not originating from a Jira ticket (Phase 0) or a GitHub Issue routed through triage
  (Phase 1)
- Cross-repository workflows
- Agent-performed code review (triggering an external review tool such as Copilot code review as a
  pre-check gate step is in scope; the agent itself is not a reviewer)
- Automated deployment or release management
- Self-identification of tech debt (deferred to Phase 2)
- Automated meta-harness improvement without human review of the proposed changes (feedback loop
  produces suggestions; a human applies them in Phase 1)

## 6. Open Questions

| # | Question | Status |
| --- | -------- | ------ |
| OQ-1 | Phase 0 trigger is Jira-initiated (FR-CROSS-9). The specific mechanism — Jira custom agent, GitHub Actions label-based trigger, or GitHub agent sandbox — remains to be decided at implementation. | Partially resolved |
| OQ-2 | Which AI harness(es) to designate for cloud execution? Harness selection is an implementation detail outside this PRD, but affects configuration and cost attribution. | Open |
| OQ-3 | Should the issue triage workflow (Phase 1) live in this repository or a separate one? | Open |
| OQ-4 | What OpenTelemetry backend or observability tooling will be used to receive and visualize workflow telemetry? | Open |

## 7. Development Phases

### Phase 0 — Core team, Jira-driven workflows

Deliver the four core implementation workflows (JTBD-BUG, JTBD-FEAT, JTBD-TECH, JTBD-DEP) and
the observability foundation (JTBD-OBS) for the core development team. The ADLC (Section 3.2)
and all cross-cutting concerns (FR-CROSS-1 through FR-CROSS-10) must be addressed in this phase.

Cost attribution (NFR-1) is a Phase 0 requirement but must not block delivery of functional
workflows if attribution tooling is not yet available — workflows may be delivered with a documented
gap and attribution addressed as a follow-on task.

### Phase 1 — Feedback loop and community pipeline

Deliver the feedback loop capability (JTBD-FEEDBACK, Section 3.8) enabling reviewer comments to
improve the meta-harness over time. Deliver the issue triage workflow (JTBD-TRIAGE, Section 3.9),
enabling community-submitted GitHub Issues to enter the Jira pipeline. Detailed design for both is
deferred to separate documents.

### Phase 2 — Self-identification of tech debt

Extend the tech debt workflow to allow the agent to identify and create tech debt tickets without
requiring a human to initiate the Jira ticket. Scope and design are deferred.

## 8. Glossary

| Term | Definition |
| ---- | ---------- |
| ADLC | Agentic Development Life Cycle — the governed sequence of steps (load meta-harness, readiness check, failing tests, Draft PR, implement, pre-checks, request review) that the agent follows for implementation workflows. |
| Agentic Loop Engineering | An approach to software automation that builds systems around governed reasoning loops rather than deterministic sequential steps. Governance (termination conditions, guardrails) is the base case that prevents unbounded execution. |
| Agentic Workflow | An automated process in which an AI agent executes a defined task autonomously from trigger to completion, requiring human input only at review. |
| BDD | Behavior-Driven Development — a practice in which tests are derived from acceptance criteria and express expected behavior in human-readable form before implementation begins. |
| Factory Operator | The role of a developer who configures and tunes the meta-harness rather than steering the agent interactively. The operator designs the system that runs the loop, rather than running it personally. |
| Governance | The set of policies, guardrails, and termination conditions that regulate agentic loop execution — equivalent to the base case in recursion. |
| Guardrail | A specific governance policy that halts or constrains agent execution when a defined condition is met (e.g., token budget exceeded, pre-check suite fails repeatedly). |
| Harness | The AI development tool used to run an agent (e.g., Claude Code, GitHub Copilot). The agent is the combination of a model and a harness. |
| JTBD | Jobs to be Done — a framework for expressing user needs as outcomes rather than feature descriptions. Format: "When [situation], I want to [action], so that [outcome]." |
| Meta-harness | The configuration layer above the agent: skills, `CLAUDE.md`, hooks, agent definition files, and best-practice configuration that shape how the agent reasons and what context it loads. The artifact the factory operator engineers. |
| Pre-check Suite | The modular set of automated validations (lint, tests, skills, and optional gates) that must pass before a PR is eligible for human review. |
| Readiness Check | The lightweight validation an agent performs against a Jira ticket before beginning work, confirming that acceptance criteria, estimate, and epic linkage are present. |
| Refined | The Jira ticket status indicating that a ticket has been reviewed by a human, meets readiness criteria, and is ready for agent or developer pickup. |
| TDD | Test-Driven Development — a practice in which failing tests are written before implementation code, ensuring the implementation is verifiably correct. |
