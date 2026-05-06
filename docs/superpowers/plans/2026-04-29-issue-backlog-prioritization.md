# Fiona Issue Backlog Prioritization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all remaining open Jira issues and GitHub issues in the Fiona project by working in priority order from critical bugs through infrastructure automation to feature work.

**Architecture:** Issues are grouped into five tiers — Tier 1 (bugs/memory leaks, immediate), Tier 2 (in-progress work to land), Tier 3 (assigned feature work), Tier 4 (infrastructure & automation), Tier 5 (product features and epics). Within each tier work is ordered by risk: stability first, security second, UX third.

**Tech Stack:** Node.js (ESM), Jest, Slack Bolt SDK, Azure AI Foundry, Perplexity Sonar, GitHub Actions, Docker/Azurite

**Sources:**
- GitHub: https://github.com/Ed-Fi-Alliance-OSS/Fiona (2 open issues — #10 closed 2026-04-29)
- Jira: https://edfi.atlassian.net/jira/software/c/projects/AI/ (41 open issues)
- Snapshot date: 2026-04-29

---

## Resolved/Closed Confirmation

The following issues from the original AI-80 epic are **confirmed Done** in Jira. GitHub #10 (Gap Analysis & Agent Implementation Plan) has been **closed** (2026-04-29).

| Issue | Title | Jira Status |
|-------|-------|-------------|
| AI-43 | Unbounded Recursive Tool-Call Loop (recursion depth limit) | ✅ Done |
| AI-44 | Null Context Guard in Assistant Thread Handler | ✅ Done (2026-04-15) |
| AI-47 | Sensitive Data Leakage to Disk | ✅ Done (2026-04-17) |
| AI-49 | User-Controlled Provider Routing | ✅ Done (2026-04-17) |
| AI-57 | Remove Boilerplate Elements | ✅ Done (2026-04-15) |
| AI-85 | Memory Leak in Rate Limiter | ✅ Done (2026-04-28) |
| AI-86 | Error Handler Coverage in Message Handler | ✅ Done (2026-04-17) |
| GitHub #10 | Gap Analysis & Agent Implementation Plan | ✅ Closed (2026-04-29) |

**AI-50** (AZURE_AGENT_ID validation) is still In Progress — tracked separately in GitHub #16 and Jira AI-50.

---

## Approved for Removal — Superseded

Two tickets have been reviewed and approved for closure as "Won't Do":

| Issue | Reason |
|-------|--------|
| **AI-35** Performance Testing Script | Under AI-10 (Website UX epic). The current Slack Socket Mode deployment has no HTTP endpoint to load test against. If Slack event simulation performance testing is wanted in the future, open a new scoped ticket under AI-77. |
| **AI-98** Plan for how to automate bug fixes | Meta-process spike superseded by the AI-92 agent orchestration approach. |

> **Action:** Transition AI-35 and AI-98 to "Won't Do" in Jira with the rationale above.

---

## Architecture Notes (Updated)

The following context corrects earlier assumptions and should inform how remaining tickets are read:

- **Sonar API (Perplexity)** is the primary response synthesizer. Responses are fed back to connected clients via an **Azure API gateway**. Perplexity is not merely a search tool — it drives answers.
- **Azure AI Foundry** is the *older* architecture. **AI-111** (Simplify codebase LLM provider usage) is specifically about reducing this complexity and aligning the codebase to the Sonar-first model.
- **Docs website layer** (docs.ed-fi.org) exists as a planned client surface — it has not yet been implemented. AI-1, AI-10, AI-11 are valid future work for that layer.
- **AI-62** (PDF to HTML for LLM Indexing) supports the docs website integration and is valid — it prepares Ed-Fi documentation for LLM consumption via that layer.
- **AI-22 + AI-24** (Question catalog / question bank) are for regression testing model quality against a standard battery of questions — not tied to any specific retrieval architecture.
- **AI-70** (TEA/TWEDS research) stands as written — external repository integration is independent of retrieval provider.

---

## Tier 1 — Critical Bugs (Land First)

These are stability and memory-safety issues. None require design decisions — implement, test, merge.

### Task 1: Close GitHub #18 — Rate Limiter Memory Leak

**Status:** AI-85 is **Done in Jira** (2026-04-28). GitHub #18 still open — needs PR merged and issue closed.

**Files:**
- Modify: `apps/fiona-slack/src/agent/rate-limiter.js`
- Test: `apps/fiona-slack/tests/agent/rate-limiter.test.js`

- [ ] **Step 1: Verify branch state**
  ```bash
  git log --oneline fix/ai-85-rate-limiter-leak-local | head -10
  git diff main...fix/ai-85-rate-limiter-leak-local -- apps/fiona-slack/src/agent/rate-limiter.js
  ```
  Expected: see the empty-array deletion fix in `rate-limiter.js`.

- [ ] **Step 2: Run existing tests**
  ```bash
  cd apps/fiona-slack
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js --testPathPattern="rate-limiter" --verbose
  ```
  Expected: all rate-limiter tests pass.

- [ ] **Step 3: Verify MAX_REQUESTS=0 edge case is covered**
  Check that `tests/agent/rate-limiter.test.js` has a test for `MAX_REQUESTS=0`.
  If missing, add:
  ```javascript
  it('allows all requests when MAX_REQUESTS is 0', () => {
    process.env.MAX_REQUESTS = '0';
    const limiter = new RateLimiter();
    expect(limiter.isAllowed('user1')).toBe(true);
  });
  ```

- [ ] **Step 4: Run full test suite**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js --testPathPattern="tests/" --verbose
  ```
  Expected: all 18+ suites pass, no regressions.

- [ ] **Step 5: Create PR and close issues**
  ```bash
  gh pr create --title "fix(ai-85): fix memory leak in rate-limiter userTimestamps Map" \
    --body "Closes #18. Resolves AI-85. Deletes map entry when timestamp array empties."
  ```
  After merge: close GitHub #18 (AI-85 is already Done in Jira).

---

### Task 2: Close AI-95 — Unbounded Set Memory Growth in idempotent-finalize.js

**Jira:** AI-95 | **Type:** Bug | **Severity:** HIGH

**Problem:** `idempotent-finalize.js` uses an unbounded `Set` to track finalized message IDs. In a long-running process this Set grows without bound.

**Related:** AI-93 (investigation spike — can be resolved alongside this task).

**Files:**
- Modify: `apps/fiona-slack/src/agent/idempotent-finalize.js`
- Test: `apps/fiona-slack/tests/agent/idempotent-finalize.test.js`

- [ ] **Step 1: Read the current implementation**
  ```bash
  cat apps/fiona-slack/src/agent/idempotent-finalize.js
  ```
  Identify where the Set (or equivalent) is declared and populated.

- [ ] **Step 2: Write the failing test**
  In `tests/agent/idempotent-finalize.test.js`, add:
  ```javascript
  it('does not grow unbounded after TTL expiry', async () => {
    const TTL_MS = 100;
    const finalize = createIdempotentFinalize({ ttlMs: TTL_MS });
    finalize('msg-1');
    finalize('msg-2');
    await new Promise(r => setTimeout(r, TTL_MS + 50));
    // After TTL the Set/Map should have evicted old entries
    expect(finalize.size()).toBe(0);
  });
  ```

- [ ] **Step 3: Run test to confirm it fails**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js \
    --testPathPattern="idempotent-finalize" --verbose
  ```
  Expected: FAIL — `finalize.size is not a function` or size does not reach 0.

- [ ] **Step 4: Implement TTL-based eviction**
  Replace the bare `Set` with a `Map<id, expiresAt>` and evict on each call:
  ```javascript
  // idempotent-finalize.js
  const TTL_MS = parseInt(process.env.IDEMPOTENT_FINALIZE_TTL_MS ?? '300000', 10); // 5 min default

  function createStore() {
    const store = new Map();
    return {
      has(id) {
        const exp = store.get(id);
        if (exp === undefined) return false;
        if (Date.now() > exp) { store.delete(id); return false; }
        return true;
      },
      add(id) {
        this._evict();
        store.set(id, Date.now() + TTL_MS);
      },
      _evict() {
        const now = Date.now();
        for (const [id, exp] of store) {
          if (now > exp) store.delete(id);
        }
      },
      size() { return store.size; },
    };
  }
  ```

- [ ] **Step 5: Run tests to confirm pass**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js \
    --testPathPattern="idempotent-finalize" --verbose
  ```
  Expected: all idempotent-finalize tests pass.

- [ ] **Step 6: Run full test suite**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js --testPathPattern="tests/" --verbose
  ```
  Expected: no regressions.

- [ ] **Step 7: Commit and create PR**
  ```bash
  git add apps/fiona-slack/src/agent/idempotent-finalize.js \
           apps/fiona-slack/tests/agent/idempotent-finalize.test.js
  git commit -m "fix(ai-95): replace unbounded Set with TTL-evicting Map in idempotent-finalize"
  gh pr create --title "fix(ai-95): bound idempotent-finalize Set with TTL eviction" \
    --body "Closes AI-95. Also resolves AI-93 investigation — TTL/LRU approach chosen."
  ```
  After merge: transition AI-95 and AI-93 to Done in Jira.

---

### Task 3: Close AI-94 — Citation Inline [n] Markers Not Linkified During Streaming

**Jira:** AI-94 | **Type:** Bug

**Problem:** `source_index_map` is empty at chunk time so `[n]` markers in streamed text are never converted to links in the final Slack message.

**Files:**
- Modify: `apps/fiona-slack/src/agent/llm-caller.js` (metadata aggregation timing)
- Modify: `apps/fiona-slack/src/listeners/assistant/message.js` or `app_mention.js` (post-process after metadata ready)
- Test: `apps/fiona-slack/tests/agent/llm-caller.metadata.test.js`

- [ ] **Step 1: Reproduce the bug**
  In `tests/agent/llm-caller.metadata.test.js`, add:
  ```javascript
  it('source_index_map is populated before READY_TO_FINALIZE fires', async () => {
    // Arrange: mock Perplexity response with citations
    const meta = await callLLMWithMockPerplexity({ query: 'test', sources: ['https://example.com'] });
    await meta.waitForReady();
    expect(Object.keys(meta.source_index_map).length).toBeGreaterThan(0);
  });
  ```
  Run and confirm it fails — `source_index_map` is empty.

- [ ] **Step 2: Trace the aggregation path**
  In `llm-caller.js`, find where Perplexity search results are processed and where `source_index_map` is populated vs. when `READY_TO_FINALIZE` state is set. The bug is a race: state transitions before map is written.

- [ ] **Step 3: Fix the ordering**
  Move the `source_index_map` population to occur **before** the state transition to `READY_TO_FINALIZE`. Ensure the map is built from aggregated Perplexity metadata, not from streaming chunks.
  ```javascript
  // WRONG (current):
  metadata.state = 'READY_TO_FINALIZE';
  metadata.source_index_map = buildSourceMap(citations);

  // CORRECT:
  metadata.source_index_map = buildSourceMap(citations);
  metadata.state = 'READY_TO_FINALIZE';
  ```

- [ ] **Step 4: Run tests to confirm fix**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js \
    --testPathPattern="llm-caller.metadata" --verbose
  ```
  Expected: the new test passes.

- [ ] **Step 5: Run full test suite**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js --testPathPattern="tests/" --verbose
  ```
  Expected: all 18+ suites pass.

- [ ] **Step 6: Commit and create PR**
  ```bash
  git add apps/fiona-slack/src/agent/llm-caller.js \
           apps/fiona-slack/tests/agent/llm-caller.metadata.test.js
  git commit -m "fix(ai-94): populate source_index_map before READY_TO_FINALIZE state transition"
  gh pr create --title "fix(ai-94): citation inline markers now linkified in final message" \
    --body "Closes AI-94. Fixes ordering so source_index_map is populated before state transitions."
  ```
  After merge: transition AI-94 to Done in Jira.

---

### Task 4: Close AI-50 / GitHub #16 — AZURE_AGENT_ID Validation

**Status:** In Progress (Robert Hunter). Branch likely exists.

**Files:**
- Modify: `apps/fiona-slack/src/agent/llm-caller.js`
- Test: `apps/fiona-slack/tests/agent/llm-caller.test.js`

- [ ] **Step 1: Check current branch state**
  ```bash
  git branch -a | grep -i ai-50
  ```

- [ ] **Step 2: Write the failing tests**
  In the test file:
  ```javascript
  describe('validateAzureAgentId', () => {
    it.each(['my-agent:1', 'my-agent:1.0', 'my-agent:1.0.0', 'my-agent'])(
      'accepts valid format: %s', (id) => {
        expect(() => validateAzureAgentId(id)).not.toThrow();
      }
    );
    it.each(['', 'bad agent!', 'a:b:c', '../traversal', 'a'.repeat(300)])(
      'rejects invalid format: %s', (id) => {
        expect(() => validateAzureAgentId(id)).toThrow(/invalid/i);
      }
    );
  });
  ```

- [ ] **Step 3: Implement `validateAzureAgentId`**
  ```javascript
  function validateAzureAgentId(id) {
    if (!id || typeof id !== 'string') throw new Error('AZURE_AGENT_ID is required');
    const [name, version, ...rest] = id.split(':');
    if (rest.length > 0) throw new Error(`AZURE_AGENT_ID invalid: too many colons in "${id}"`);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name))
      throw new Error(`AZURE_AGENT_ID invalid name segment: "${name}"`);
    if (version !== undefined && !/^\d+(\.\d+){0,2}$/.test(version))
      throw new Error(`AZURE_AGENT_ID invalid version segment: "${version}"`);
  }
  ```
  Call `validateAzureAgentId(AZURE_AGENT_ID)` at module load time (top-level, before any export).

- [ ] **Step 4: Run tests**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js \
    --testPathPattern="llm-caller" --verbose
  ```
  Expected: all 5+ new tests pass.

- [ ] **Step 5: Run full suite and create PR**
  ```bash
  node --experimental-vm-modules node_modules/jest-cli/bin/jest.js --testPathPattern="tests/" --verbose
  gh pr create --title "fix(ai-50): validate AZURE_AGENT_ID format on startup" \
    --body "Closes #16. Resolves AI-50."
  ```
  After merge: close GitHub #16, transition AI-50 to Done.

---

## Tier 2 — Complete In-Progress Work

### Task 5: Close AI-92 — Coordinate Agent Teams (Orchestration Epic Wrap-up)

**Status:** In Progress (Robert Hunter). Coordinate closing of sub-issues.

- [ ] **Step 1: Verify sub-issues status in Jira**
  Confirm AI-43, AI-44, AI-47, AI-49, AI-57, AI-86 are all transitioned to Done.

- [ ] **Step 2: Confirm AI-50 and AI-85 PRs merged** (completed in Tier 1 tasks above).

- [ ] **Step 3: Close GitHub #10**
  Once all 8 sub-issues are confirmed closed:
  ```bash
  gh issue close 10 --comment "All 8 sub-issues from AI-80 and AI-19 epics resolved. AI-43, AI-44, AI-47, AI-49, AI-57, AI-86 closed previously; AI-50 and AI-85 closed in this sprint."
  ```

- [ ] **Step 4: Transition AI-92 and AI-91 to Done in Jira.**

---

### Task 6: Close AI-104 — SKILLS CLI Instructions (Stephen Fuqua)

**Status:** In Progress (Stephen Fuqua).

- [ ] **Step 1: Confirm with Stephen that documentation is written.**

- [ ] **Step 2: Review and merge the PR (if one exists).**
  ```bash
  gh pr list --repo Ed-Fi-Alliance-OSS/Fiona --assignee sfuqua
  ```

- [ ] **Step 3: Transition AI-104 to Done in Jira.**

---

## Tier 3 — Assigned Work Not Yet Started

Complete in dependency/risk order.

### Task 7: Close AI-108 — Update Branch Configuration for Insiders (Robert Hunter)

- [ ] **Step 1: Determine what branch configuration changes are needed** (check Jira issue description for details).

- [ ] **Step 2: Apply configuration changes** to the Insiders Slack workspace/app configuration.

- [ ] **Step 3: Verify Insiders users see the correct branch behavior.**

- [ ] **Step 4: Transition AI-108 to Done.**

---

### Task 8: Close AI-109 — Deploy Usage Analytics Azure Container Function (Robert Hunter)

- [ ] **Step 1: Verify the container function code exists** (check `apps/` for an analytics function app).

- [ ] **Step 2: Deploy to Azure** using existing deployment scripts or GitHub Actions.
  ```bash
  # Example — confirm actual deploy command from repo docs
  az functionapp deployment source config-zip ...
  ```

- [ ] **Step 3: Validate data flowing into Cosmos DB.**

- [ ] **Step 4: Transition AI-109 to Done.**

---

### Task 9: Close AI-55 — End-to-End Testing (Stephen Fuqua)

- [ ] **Step 1: Define E2E test scope** — at minimum: send a Slack message, get a Fiona response, verify citation blocks.

- [ ] **Step 2: Write E2E tests** using Playwright or Slack API test harness.

- [ ] **Step 3: Add to CI pipeline** (GitHub Actions).

- [ ] **Step 4: Transition AI-55 to Done.**

---

### Task 10: Close AI-61 — Investigate Salesforce Org Integration (Stephen Fuqua)

- [ ] **Step 1: Complete the investigation** and document findings (Confluence page or Jira comment).

- [ ] **Step 2: Create follow-on stories** if integration is viable, or close as "won't do" with rationale.

- [ ] **Step 3: Transition AI-61 to Done.**

---

### Task 11: Close AI-64 — Add User Stories from Roy's Slash Commands (Stephen Fuqua)

- [ ] **Step 1: Collect Roy's slash command use cases** and translate into Jira stories under AI-81 (Slack UX post-GA).

- [ ] **Step 2: Transition AI-64 to Done** (the output is new stories, not code).

---

## Tier 4 — Infrastructure & Automation

### Task 12: Close AI-87 + AI-88 — Secure Slack CLI Installation

**AI-87:** Implement secure Slack CLI installation with signature verification.
**AI-88:** Verify if new workflow is needed or if alternative exists.

- [ ] **Step 1: Resolve AI-88 spike first** — check Slack CLI docs for built-in signature verification.

- [ ] **Step 2: If built-in: close AI-87 as "won't do" with comment referencing Slack CLI's native support.**

- [ ] **Step 3: If not built-in: implement signature verification script** and add to `scripts/install-slack-cli.sh`.

- [ ] **Step 4: Update `AI-77` (DX Improvements Deployment) if needed.**

---

### Task 13: Close AI-71 — Automate Deployment Processes

- [ ] **Step 1: Identify current manual deployment steps** (check CI/CD docs or GitHub Actions workflows).

- [ ] **Step 2: Write/extend GitHub Actions workflow** to automate any manual steps.

- [ ] **Step 3: Verify deployment works end-to-end in CI.**

- [ ] **Step 4: Transition AI-71 to Done.**

---

### Task 14: Close AI-99 — Automate GitHub Action Dependency Updates

**Labels:** automation, github-actions, infrastructure

- [ ] **Step 1: Add Dependabot configuration** for GitHub Actions:
  Create `.github/dependabot.yml`:
  ```yaml
  version: 2
  updates:
    - package-ecosystem: "github-actions"
      directory: "/"
      schedule:
        interval: "weekly"
      labels:
        - "automation"
        - "github-actions"
    - package-ecosystem: "npm"
      directory: "/apps/fiona-slack"
      schedule:
        interval: "weekly"
  ```

- [ ] **Step 2: Commit and merge.**
  ```bash
  git add .github/dependabot.yml
  git commit -m "infra(ai-99): add Dependabot for GitHub Actions and npm dependency updates"
  gh pr create --title "infra(ai-99): add Dependabot configuration" \
    --body "Closes AI-99. Enables automated weekly dependency update PRs."
  ```

- [ ] **Step 3: Transition AI-99 to Done.**

---

### Task 15: Close AI-111 — Simplify Codebase LLM Provider Usage

- [ ] **Step 1: Audit `llm-caller.js`** for dead provider paths (e.g., any provider no longer configured).

- [ ] **Step 2: Remove dead code paths** — do not refactor for hypothetical future providers.

- [ ] **Step 3: Run full test suite** to confirm no regressions.

- [ ] **Step 4: Transition AI-111 to Done.**

---

### Task 16: Close AI-83 — Clean Up Slack Workspaces for Sandbox and Insiders

- [ ] **Step 1: Identify stale channels, apps, or tokens** in Sandbox and Insiders workspaces.

- [ ] **Step 2: Archive/delete stale resources** with approval from team lead.

- [ ] **Step 3: Document the clean state** in a Confluence page or Jira comment.

- [ ] **Step 4: Transition AI-83 to Done.**

---

### Task 17: Close AI-32 — Azure Billing and Activity Alerts

- [ ] **Step 1: Create Azure Monitor alert rules** for spend threshold and anomaly detection.

- [ ] **Step 2: Configure notification action group** (email robert.hunter@ed-fi.org and team lead).

- [ ] **Step 3: Document alert thresholds** in a Jira comment.

- [ ] **Step 4: Transition AI-32 to Done.**

---

## Tier 5 — Product Features

These require design discussion before implementation. Prioritize by user impact.

### Task 18: Close AI-112 — Provide Reason for Feedback

**Parent:** Unassigned

- [ ] **Step 1: Design the UX** — after thumbs down, show a modal or prompt with reason options (e.g., "Inaccurate", "Unhelpful", "Offensive").

- [ ] **Step 2: Implement Slack modal/dropdown** in the feedback listener.

- [ ] **Step 3: Store reason alongside feedback in Cosmos DB.**

- [ ] **Step 4: Write tests** covering reason capture and storage.

- [ ] **Step 5: Transition AI-112 to Done.**

---

### Task 19: Close AI-75 — User Memory / Profile (AI-81 Epic)

- [ ] **Step 1: Spike design** — what profile data to persist (preferences, prior queries, org context).

- [ ] **Step 2: Choose storage** — Cosmos DB (already in use for analytics) preferred.

- [ ] **Step 3: Implement profile fetch/store** in the message handler, gated behind feature flag.

- [ ] **Step 4: Write tests.**

- [ ] **Step 5: Transition AI-75 to Done.**

---

### Task 20: Close AI-110 — Evaluate Options for Open API Schema into Fiona (AI-78 Epic)

- [ ] **Step 1: Spike** — evaluate 3 approaches: (a) embed schema as tool context, (b) index schema chunks in retriever, (c) dynamic schema lookup tool.

- [ ] **Step 2: Document recommendation** in a Jira comment or Confluence.

- [ ] **Step 3: Create follow-on implementation story** if viable.

- [ ] **Step 4: Transition AI-110 to Done.**

---

### Task 21: Close AI-65 — Create Fiona Analytics Bot (AI-79 Epic)

- [ ] **Step 1: Verify AI-109 (analytics container) is deployed** (dependency).

- [ ] **Step 2: Create a private Slack channel** for analytics queries.

- [ ] **Step 3: Register a new Slack app** scoped to that channel.

- [ ] **Step 4: Implement bot** that queries Cosmos DB and Perplexity on slash command.

- [ ] **Step 5: Write integration tests.**

- [ ] **Step 6: Transition AI-65 to Done.**

---

### Task 22: Close AI-70 — Research External Repository Integration (AI-78 Epic)

- [ ] **Step 1: Research TEA (Texas Education Agency) and TWEDS** API availability and licensing.

- [ ] **Step 2: Document findings** in Jira.

- [ ] **Step 3: Create follow-on implementation story** if integration is approved.

- [ ] **Step 4: Transition AI-70 to Done.**

---

### Task 23: Close AI-30 — Formalize Evaluation and Response Feedback Workflow (AI-79 Epic)

- [ ] **Step 1: Document current feedback data schema** (thumbs up/down in Cosmos DB).

- [ ] **Step 2: Design evaluation workflow** — how responses are reviewed against question bank.

- [ ] **Step 3: Write workflow spec** in Confluence.

- [ ] **Step 4: Create follow-on implementation stories** under AI-79.

- [ ] **Step 5: Transition AI-30 to Done.**

---

### Task 24: Close AI-22 + AI-24 — Question Evaluation System (AI-76 Epic)

**AI-22:** Author Initial Product Catalog
**AI-24:** Design and Define Question Bank

- [ ] **Step 1: Draft product catalog** — list of 20–50 representative user questions with expected answers.

- [ ] **Step 2: Store catalog** in a structured format (JSON or Confluence table).

- [ ] **Step 3: Design question bank schema** for evaluation tracking.

- [ ] **Step 4: Transition AI-22 and AI-24 to Done.**

---

### Task 25: Close AI-35 — Performance Testing Script (AI-10 Epic)

- [ ] **Step 1: Write a k6 or Artillery performance script** targeting the Slack event endpoint.

- [ ] **Step 2: Define SLA thresholds** (e.g., p95 < 3s response time).

- [ ] **Step 3: Add script to `scripts/perf/`.**

- [ ] **Step 4: Document how to run** in README or Confluence.

- [ ] **Step 5: Transition AI-35 to Done.**

---

## Epics to Close After Sub-Issues Done

Once all child issues are resolved, transition parent epics to Done:

| Epic | Close When |
|------|------------|
| AI-80 | AI-50 Done (all 8 sub-issues complete) |
| AI-91 | AI-92 Done (orchestration wrap-up) |
| AI-77 | AI-55, AI-71, AI-87, AI-88, AI-104, AI-113 all Done |
| AI-79 | AI-30, AI-65 Done |
| AI-78 | AI-70, AI-110 Done |
| AI-76 | AI-22, AI-24 Done |
| AI-81 | AI-64, AI-75 Done |
| AI-18 | AI-32, AI-61, AI-83 Done |
| AI-10 | AI-1, AI-11 Done (AI-35 closed Won't Do) |
| AI-19 | AI-57 Done (already closed), verify all GA criteria met |
| AI-62 | Self-contained epic — close after PDF-to-HTML indexing pipeline is delivered |
| AI-99 | Self-contained — no children |

---

## Priority Summary Table

| Priority | Issue(s) | Why First |
|----------|----------|-----------|
| P1 | GitHub #18 | Branch exists, just needs PR; AI-85 already Done in Jira |
| P1 | AI-95 | Memory leak in idempotent-finalize |
| P1 | AI-94 | Citations broken for all users |
| P1 | AI-50 / #16 | In Progress, security validation |
| P2 | AI-92, AI-104 | In-progress work, unblock team |
| P2 | AI-111 | Simplify away Azure AI Foundry — aligns codebase to Sonar-first architecture |
| P3 | AI-108, AI-109 | Robert's assigned, near-term |
| P3 | AI-55, AI-61, AI-64 | Stephen's assigned |
| P4 | AI-99, AI-87/88, AI-71, AI-83, AI-32 | Infrastructure hardening |
| P5 | AI-112, AI-75, AI-110, AI-65, AI-30, AI-70 | Product features |
| P5 | AI-22, AI-24 | Question bank — model regression testing |
| P6 | AI-1, AI-11, AI-62 | Docs website layer — valid future work, not yet started |
| **Close Won't Do** | **AI-35** | Closed 2026-04-29 — HTTP load testing approach superseded by Socket Mode architecture |
| **Deferred** | **AI-98** | Removed from plan pending further investigation — do not action |
| P4 | AI-113 | New — performance testing strategy for Socket Mode + Azure API gateway (replaces AI-35, parented under AI-77) |
