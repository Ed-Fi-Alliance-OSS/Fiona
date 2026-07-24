# Design: Copilot Coding Agent + Post-Mortem Improvement Loop

- **Date:** 2026-07-24
- **Status:** Approved (design); implementation to follow in two plans
- **Author:** roberthunterjr (with Claude Code, brainstorming skill)
- **Baseline reference:** [PR #81](https://github.com/Ed-Fi-Alliance-OSS/Fiona/pull/81) (Copilot coding agent, `feat(AI-179)`)

> **AI-use disclosure:** This design was produced with substantial AI assistance
> (Claude Code). Assumptions and limitations are called out inline. A human must
> review this document and all downstream artifacts before adoption.

## 1. Problem & Goals

Two agents, forming one self-improvement loop:

1. **Coding Agent** — a Jira-triggered GitHub Copilot coding agent that plans
   first and follows fail-first Test-Driven Development (write a failing test,
   confirm it fails for the intended reason, then implement). It uses the
   context handed off from the Jira ticket to drive coordination.
2. **Post-Mortem Agent** — runs after a PR closes, collects data about that PR,
   and periodically opens a consolidated PR proposing improvements to the
   agent's steering (instructions, skills) and to ticket-writing practice.

The two are one loop because the artifacts the Post-Mortem Agent edits
(`copilot-instructions.md`, skills) are exactly what steers the Coding Agent.
Every merged PR should make the next one a little better.

```
Jira ticket ──▶ [Coding Agent] ──▶ PR ──▶ human review ──▶ merge/close
                    ▲                                          │
                    │                                          ▼
            improvement PR ◀── [Post-Mortem Agent] ◀── per-PR data capture
              (edits instructions/skills;             (docs/postmortems/PR-<n>.json)
               ticket tips in PR body)
```

### Key finding from the baseline

There is currently **no `.github/copilot-instructions.md` and no
`.github/instructions/`** in this repo. Copilot ran PR #81 with zero repo-level
steering, which is why it did not do plan-first / fail-first TDD and tripped a
lint check that required a follow-up fix commit. **Agent #1 is largely the act
of putting existing discipline (the `automate-bug-fix` skill) where Copilot
actually reads it.**

## 2. Runtime & Foundational Decisions

| Decision | Choice |
|---|---|
| Execution substrate | **GitHub Copilot coding agent** (matches baseline PR #81) |
| Coding-agent scope | **Global** — applies to all Copilot work in the repo |
| Post-mortem runner | **GHA on PR close → Copilot** (capture in Actions, synthesize via Copilot) |
| Post-mortem cadence | **Batched / periodic** — one consolidated improvement PR, not one per PR |
| Data store | **Committed JSON in-repo** (`docs/postmortems/PR-<n>.json`) |
| Ticket-description improvements | **PR-body suggestions only** (not written back to Jira) |

### Foundation / policy constraints honored

- **No external-system wiring.** The Jira→GitHub→Copilot assignment integration
  is an existing/Tech-team concern; this design only *documents the expected
  handoff contract*, it does not connect accounts or APIs.
- **No auto-modifying external systems.** Ticket-description improvements are
  delivered as recommendations in the improvement-PR body; a human applies them
  to Jira.
- **Human accountability.** Every improvement PR is human-reviewed; the loop
  never self-merges. All AI-generated content is reviewed before use.
- **Minimize personal data.** Captured post-mortem data stores **roles**
  (`author` / `human-reviewer` / `copilot-bot`) and `authorAssociation`, **not**
  human reviewer logins. Bot logins (e.g. `copilot-swe-agent`) are retained
  because they are not personal. See §5 PII stance.

## 3. Agent #1 — Coding Agent (global Copilot steering)

### 3.1 Artifacts

- **`.github/copilot-instructions.md`** (new) — Copilot's always-loaded custom
  instructions. Single source of truth for coding discipline.
- **`.github/skills/automate-bug-fix/SKILL.md`** (existing) — retained as the
  deep bug-specific playbook. `copilot-instructions.md` references it so the
  Copilot path and the Claude/superpowers path converge; the detailed workflow
  is **not duplicated**.

### 3.2 What `copilot-instructions.md` mandates (all Copilot work)

1. **Context handoff** — treat the synced Jira issue body as source of truth;
   parse the bug/feature statement, acceptance criteria, and repro/expected
   behavior. If required information is missing, stop and comment what is
   missing (mirrors `automate-bug-fix` §1).
2. **Plan first** — post a scoped plan to the PR before implementing:
   files/modules expected to change, why each is in scope, patterns to
   preserve, test strategy, and a **feasibility score (1–4)** using the existing
   rubric. Score 3–4 ⇒ stop and propose a decomposition instead of coding.
3. **Fail-first TDD** — write the test(s) encoding intended behavior, run them,
   and explicitly state they fail *for the intended reason* before writing
   implementation code.
4. **Scope-drift check** — before opening the PR, compare changed files against
   the plan; justify or revert anything unexpected.
5. **Local verification** — run `npm run lint` (Biome) and the relevant test
   suite locally and confirm green *before* opening the PR. (Directly targets
   the PR #81 lint miss.)
6. **License headers** — new JS/YAML/Dockerfile files start with the Apache
   header per repo `CLAUDE.md`.
7. **PR body** — include: bug/feature summary, plan + feasibility score, test
   intent-alignment outcome, verification results, any justified scope
   exceptions.

### 3.3 Trigger contract (documented, not built)

Documented in `copilot-instructions.md` and/or a short
`docs/agents/coding-agent.md`:

- The Jira automation creates/updates a GitHub issue and assigns it to Copilot.
- Expected issue-body shape (so context handoff is reliable): title, problem
  statement, acceptance criteria, repro/expected behavior, affected area, links.
- If the issue omits these, the agent follows rule §3.2.1 (stop + comment).

> **Assumption:** the Jira→GitHub→Copilot integration already exists or will be
> configured by the Tech team. This design does not build or authenticate it.

## 4. Agent #2 — Post-Mortem Agent (two phases)

### 4.1 Phase A — Capture (automatic, no LLM)

- **`.github/workflows/postmortem-capture.yml`** (new) — triggers on
  `pull_request: [closed]`.
- **`scripts/postmortem/capture.js`** (new, Apache header) — pulls PR facts via
  the GitHub API (`gh` / `GITHUB_TOKEN`) and writes
  `docs/postmortems/PR-<number>.json`, then the workflow commits it.

Captured schema (`docs/postmortems/PR-<number>.json`):

```jsonc
{
  "prNumber": 81,
  "title": "feat(AI-179): ...",
  "state": "merged",              // merged | closed
  "jiraKey": "AI-179",            // parsed from title/branch if present
  "stats": {
    "additions": 1196,
    "deletions": 99,
    "changedFiles": 25,
    "commits": 6,
    "reviewCycles": 4,            // count of review submissions by humans
    "reviewComments": 12,
    "timeToFirstGreenCiMinutes": 73,
    "timeToMergeMinutes": 1440,
    "ciFailures": { "lint": 1, "test": 0, "build": 0 }
  },
  "signal": {
    "commentClasses": { "nit": 3, "correctness": 5, "rework": 4 },
    "followupCommits": { "fix": 2, "feature": 1 },
    "changeRequestThemes": ["use SDK not raw fetch", "truncate output",
                            "clearer result separation"]
  },
  "participants": [
    { "role": "author", "kind": "copilot-bot", "association": "CONTRIBUTOR" },
    { "role": "human-reviewer", "association": "MEMBER" }
  ],
  "capturedAt": "2026-07-24T00:00:00Z"
}
```

- CI-failure types are derived from GitHub **check runs** and follow-up commit
  messages (`fix:` / `lint` keywords).
- Comment classification (nit / correctness / rework) is coarse and
  keyword/heuristic based in Phase A; Phase B may refine it with the LLM.

### 4.2 Phase B — Synthesis (batched / on-demand, Copilot-driven)

- **`.github/workflows/postmortem-synthesize.yml`** (new) — `workflow_dispatch`
  + weekly `schedule`. Assigns a Copilot task steered by
  **`.github/instructions/postmortem.instructions.md`** (new).
- The synthesis agent reads all un-processed `docs/postmortems/PR-*.json` and
  opens **one consolidated improvement PR** answering the driving questions
  **across** PRs:
  - What went well; what needed rework.
  - Generalizable steps worth codifying.
  - Standardization / linting opportunities that would reduce drift.
  - Concrete edits to `.github/copilot-instructions.md`, skills, or
    `.agent.md` files.
  - **Ticket-description improvement suggestions — in the PR body as prose.**
- Processed files are moved to `docs/postmortems/processed/` (same PR) so they
  are not re-synthesized.

### 4.3 Improvement-PR guardrails

- Human-gated via normal PR review; never self-merges.
- Edits are proposals — small, scoped, and justified by cited data
  (e.g. "lint failed in N of M PRs ⇒ add pre-PR `npm run lint` gate").

## 5. Cross-cutting concerns

### PII stance (Foundation policy)

- Store roles + `authorAssociation`, **not** human logins. Bot logins retained.
- Review-comment *text* stored only as classified themes, not verbatim, to
  avoid incidentally persisting names. If verbatim snippets are ever needed,
  they must be redacted of personal identifiers first.

### AI-use disclosure

- The improvement-PR body and this design carry an AI-use disclosure and note
  assumptions/limitations, per Foundation transparency guidance.

### Cost control

- Phase A is pure API, no LLM. Only Phase B invokes Copilot, on a cadence.

## 6. Files added / changed

```
.github/copilot-instructions.md                  # Agent #1 (global steering)   [new]
.github/instructions/postmortem.instructions.md  # Agent #2 synthesis steering  [new]
.github/workflows/postmortem-capture.yml         # Phase A (on PR close)         [new]
.github/workflows/postmortem-synthesize.yml      # Phase B (weekly/dispatch)     [new]
scripts/postmortem/capture.js                    # PR-facts collector           [new]
scripts/postmortem/*.test.js                     # unit tests (fail-first)       [new]
docs/postmortems/README.md + .gitkeep            # data store + docs             [new]
docs/agents/coding-agent.md                      # trigger contract (optional)   [new]
.github/skills/automate-bug-fix/SKILL.md         # referenced, unchanged         [keep]
```

## 7. Testing strategy

- `capture.js`: unit-tested with mocked `gh`/API JSON — schema shape, CI-failure
  derivation, comment classification, and PII exclusion (asserts no human login
  is written). Written fail-first, matching the discipline being codified.
- Workflows: validated via `workflow_dispatch` dry-runs; capture verified
  against the real PR #81 as a fixture.
- `copilot-instructions.md` / `postmortem.instructions.md`: no automated test;
  validated by a follow-up Copilot PR observably following the discipline.

## 8. Implementation sequencing

Two plans (approved):

- **Plan 1 — Coding Agent (Agent #1):** `copilot-instructions.md` +
  trigger-contract doc. Low risk, improves every subsequent PR immediately.
- **Plan 2 — Post-Mortem loop (Agent #2):** Phase A capture (workflow + script +
  tests), then Phase B synthesis (workflow + instructions). Depends on Plan 1's
  steering files existing as edit targets.

## 9. Out of scope / non-goals

- Building or authenticating the Jira→GitHub→Copilot integration (Tech team).
- Writing back to Jira.
- Cosmos DB storage for post-mortem data (in-repo JSON chosen for auditability
  and zero new infra; revisit if volume demands querying at scale).
- Auto-merging any agent-generated PR.

## 10. Open assumptions to confirm during implementation

1. Copilot coding agent reliably loads `.github/copilot-instructions.md` in this
   org's configuration.
2. `GITHUB_TOKEN` in Actions has sufficient scope to read reviews/comments/check
   runs for capture.
3. A weekly cadence is the right default for synthesis (adjustable).
