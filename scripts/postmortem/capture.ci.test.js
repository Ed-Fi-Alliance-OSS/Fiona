// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Regression suite for capture fidelity. Every expected value here is derived
// from a de-identified fixture captured from a real merged PR, so each test
// pins behavior against evidence rather than against an assumed API shape.
//
// The fixtures exist because the original implementation read `gh pr checks`,
// which reports only the CURRENT state of checks on the head SHA. On a merged
// PR every required check is green, so CI-failure history was structurally
// unobservable and `ciFailures` was always {0,0,0}.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyAuthorKind,
  classifyCiStep,
  deriveCiOutcomes,
  deriveTimeToFirstGreen,
  deriveReviewCycles,
  buildPostmortemRecord,
  fetchPrData,
} from "./capture.js";

function fixture(prNumber) {
  return JSON.parse(readFileSync(new URL(`./fixtures/pr-${prNumber}.json`, import.meta.url), "utf8"));
}

function rawFromFixture(prNumber) {
  const f = fixture(prNumber);
  return {
    pr: f.view,
    reviews: f.view.reviews,
    comments: f.view.comments,
    commits: f.view.commits,
    files: f.view.files,
    runs: f.runs.workflow_runs,
    jobsByRunId: Object.fromEntries(Object.entries(f.jobs).map(([id, v]) => [id, v.jobs])),
  };
}

// --- author kind -----------------------------------------------------------
// The original classifyParticipantKind returned "copilot-bot" for anything
// ending in [bot] and "human" for everything else. `app/dependabot` matches
// neither branch, so 3 of the 10 seeded records labeled Dependabot as human.

test("classifyAuthorKind: dependabot is its own cohort, in both login forms", () => {
  assert.equal(classifyAuthorKind("app/dependabot"), "dependabot");
  assert.equal(classifyAuthorKind("dependabot[bot]"), "dependabot");
});

test("classifyAuthorKind: the coding agent is 'agent'", () => {
  assert.equal(classifyAuthorKind("copilot-swe-agent"), "agent");
  assert.equal(classifyAuthorKind("Copilot"), "agent");
});

test("classifyAuthorKind: the Copilot review bot is not the coding agent", () => {
  // Conflating these would let a human-authored PR reviewed by the Copilot
  // reviewer contaminate the agent cohort.
  assert.equal(classifyAuthorKind("copilot-pull-request-reviewer"), "other-bot");
});

test("classifyAuthorKind: other bots and humans", () => {
  assert.equal(classifyAuthorKind("renovate[bot]"), "other-bot");
  assert.equal(classifyAuthorKind("app/some-integration"), "other-bot");
  assert.equal(classifyAuthorKind("some-person"), "human");
  assert.equal(classifyAuthorKind(""), "human");
  assert.equal(classifyAuthorKind(null), "human");
});

// --- CI step classification ------------------------------------------------
// Lint/test granularity does not exist at check-run level in this repo: the
// check is named "Setup - apps/fiona-slack" and contains no lint/test/build
// substring. It exists only at step level.

test("classifyCiStep: maps this repo's real step names", () => {
  assert.equal(classifyCiStep("Lint code"), "lint");
  assert.equal(classifyCiStep("Run tests"), "test");
  assert.equal(classifyCiStep("Perform CodeQL Analysis"), "other");
});

test("classifyCiStep: reporting steps are not test failures", () => {
  // "Report test results" failed in run 28116254447 only because junit.xml was
  // absent (tests were skipped). Counting it as a test failure would invent a
  // failure that never happened.
  assert.equal(classifyCiStep("Report test results"), null);
  assert.equal(classifyCiStep("Report code coverage"), null);
});

test("classifyCiStep: runner scaffolding steps are ignored", () => {
  assert.equal(classifyCiStep("Set up job"), null);
  assert.equal(classifyCiStep("Complete job"), null);
  assert.equal(classifyCiStep("Post Setup Node (from .nvmrc)"), null);
  assert.equal(classifyCiStep("Checkout"), null);
});

// --- CI outcomes -----------------------------------------------------------

test("deriveCiOutcomes: recovers the real lint failure on PR-62", () => {
  const { runs, jobsByRunId, pr } = rawFromFixture(62);
  const out = deriveCiOutcomes(runs, jobsByRunId, pr.createdAt);

  // Run 28116254447: Lint code=failure, Run tests=skipped.
  assert.deepEqual(out.ciFailures, { lint: 1, test: 0, build: 0, other: 0 });
  assert.equal(out.ciRuns.failed, 1);
  assert.equal(out.ciRuns.total, 9);
});

test("deriveCiOutcomes: a skipped test step is recorded, not silently dropped", () => {
  // "Tests never ran" is the signal that a pre-PR gate was bypassed. Folding it
  // into either failures or successes loses that.
  const { runs, jobsByRunId, pr } = rawFromFixture(62);
  const out = deriveCiOutcomes(runs, jobsByRunId, pr.createdAt);
  assert.deepEqual(out.ciSkipped, { lint: 0, test: 1, build: 0 });
});

test("deriveCiOutcomes: cancelled runs are not failures", () => {
  // PR-92 has two runs cancelled by the workflow's cancel-in-progress
  // concurrency group. Counting those as failures would fabricate CI trouble.
  const { runs, jobsByRunId, pr } = rawFromFixture(92);
  const out = deriveCiOutcomes(runs, jobsByRunId, pr.createdAt);
  assert.deepEqual(out.ciFailures, { lint: 0, test: 0, build: 0, other: 0 });
  assert.equal(out.ciRuns.failed, 0);
  assert.equal(out.ciRuns.cancelled, 2);
});

test("deriveCiOutcomes: ignores runs that predate the pull request", () => {
  // Branch pr-89 had a run at 18:16:40, before PR-92 opened at 18:24:42.
  const { runs, jobsByRunId, pr } = rawFromFixture(92);
  const out = deriveCiOutcomes(runs, jobsByRunId, pr.createdAt);
  assert.equal(out.ciRuns.total, 4);
});

test("deriveCiOutcomes: ignores non-pull_request events", () => {
  // PR-62's branch also carries workflow_dispatch deploys and a 'dynamic'
  // Copilot review run on the same commits.
  const { runs, jobsByRunId, pr } = rawFromFixture(62);
  const events = new Set(runs.map((r) => r.event));
  assert.ok(events.has("workflow_dispatch"), "fixture should contain a deploy run");
  assert.equal(deriveCiOutcomes(runs, jobsByRunId, pr.createdAt).ciRuns.total, 9);
});

test("deriveCiOutcomes: no runs yields zeroed counters, not null", () => {
  const out = deriveCiOutcomes([], {}, "2026-01-01T00:00:00Z");
  assert.deepEqual(out.ciFailures, { lint: 0, test: 0, build: 0, other: 0 });
  assert.deepEqual(out.ciRuns, { total: 0, failed: 0, cancelled: 0 });
});

// --- time to first green ---------------------------------------------------

test("deriveTimeToFirstGreen: PR-62 is 89 minutes, not the whole PR lifetime", () => {
  // The old implementation took min(completedAt) over currently-successful
  // checks, which on a merged PR is the FINAL suite. It reported 22863 minutes
  // against a 30316-minute time-to-merge — a proxy for merge time.
  const { runs, pr } = rawFromFixture(62);
  assert.equal(deriveTimeToFirstGreen(runs, pr.createdAt), 89);
});

test("deriveTimeToFirstGreen: never negative when the branch had pre-PR runs", () => {
  const { runs, pr } = rawFromFixture(92);
  assert.equal(deriveTimeToFirstGreen(runs, pr.createdAt), 4);
});

test("deriveTimeToFirstGreen: null when CI never went green", () => {
  const runs = [
    { id: 1, event: "pull_request", conclusion: "failure", created_at: "2026-01-01T01:00:00Z", updated_at: "2026-01-01T01:05:00Z" },
  ];
  assert.equal(deriveTimeToFirstGreen(runs, "2026-01-01T00:00:00Z"), null);
});

// --- review cycles ---------------------------------------------------------

test("deriveReviewCycles: counts decisions, not review objects", () => {
  // PR-85 recorded 8 "cycles" for a 2-file docs PR: one CHANGES_REQUESTED, five
  // COMMENTED review objects submitted within 4 seconds (one batched review,
  // one object per inline comment), then one APPROVED. That is 2 decisions.
  const { reviews } = rawFromFixture(85);
  assert.equal(reviews.length, 8, "fixture should retain all 8 review objects");
  assert.equal(deriveReviewCycles(reviews), 2);
});

test("deriveReviewCycles: PR-62 had one decision across nine review objects", () => {
  const { reviews } = rawFromFixture(62);
  assert.equal(deriveReviewCycles(reviews), 1);
});

test("deriveReviewCycles: bot reviews do not count", () => {
  const reviews = [
    { author: { login: "copilot-pull-request-reviewer" }, state: "APPROVED", submittedAt: "2026-01-01T00:00:00Z" },
    { author: { login: "some-person" }, state: "APPROVED", submittedAt: "2026-01-01T01:00:00Z" },
  ];
  assert.equal(deriveReviewCycles(reviews), 1);
});

// --- full record -----------------------------------------------------------

test("buildPostmortemRecord: PR-62 record reflects every fidelity fix", () => {
  const record = buildPostmortemRecord(rawFromFixture(62));

  assert.equal(record.schemaVersion, 2);
  assert.equal(record.authorKind, "human");
  assert.equal(record.stats.ciFailures.lint, 1);
  assert.equal(record.stats.ciSkipped.test, 1);
  assert.equal(record.stats.timeToFirstGreenCiMinutes, 89);
  assert.equal(record.stats.reviewCycles, 1);
});

test("buildPostmortemRecord: Dependabot PRs are tagged, not disguised as human", () => {
  const record = buildPostmortemRecord(rawFromFixture(65));
  assert.equal(record.authorKind, "dependabot");
  assert.equal(record.participants[0].kind, "dependabot");
});

test("buildPostmortemRecord: PR-92 is the control and stays clean", () => {
  const record = buildPostmortemRecord(rawFromFixture(92));
  assert.equal(record.authorKind, "human");
  assert.deepEqual(record.stats.ciFailures, { lint: 0, test: 0, build: 0, other: 0 });
  assert.equal(record.stats.reviewCycles, 1);
});

test("buildPostmortemRecord: drops the never-populated changeRequestThemes field", () => {
  const record = buildPostmortemRecord(rawFromFixture(62));
  assert.ok(!("changeRequestThemes" in record.signal));
});

test("buildPostmortemRecord: still carries no reviewer logins", () => {
  const serialized = JSON.stringify(buildPostmortemRecord(rawFromFixture(62)));
  for (const login of ["human-a", "human-b", "human-c", "copilot-pull-request-reviewer"]) {
    assert.ok(!serialized.includes(login), `record must not contain the login ${login}`);
  }
});

// --- fetch plumbing --------------------------------------------------------

function recordingRun(prNumber, calls) {
  const f = fixture(prNumber);
  return (args) => {
    calls.push(args.join(" "));
    if (args[0] === "pr") return JSON.stringify(f.view);
    const joined = args.join(" ");
    if (joined.includes("/jobs")) {
      const id = joined.match(/runs\/(\d+)\/jobs/)[1];
      return JSON.stringify({ jobs: f.jobs[id]?.jobs ?? [] });
    }
    return JSON.stringify(f.runs);
  };
}

test("fetchPrData: scopes runs to the head branch", () => {
  const calls = [];
  fetchPrData(92, { run: recordingRun(92, calls) });
  assert.ok(
    calls.some((c) => c.includes("actions/runs") && c.includes("branch=pr-89")),
    "should query workflow runs scoped to the head branch",
  );
});

test("fetchPrData: fetches step detail only for runs that failed", () => {
  // Step detail exists to explain failures. Fetching it for every in-scope run
  // cost 54 API calls on PR-63; successful runs contribute nothing to the
  // failure or skip counters.
  const calls = [];
  const raw = fetchPrData(62, { run: recordingRun(62, calls) });
  const jobCalls = calls.filter((c) => c.includes("/jobs"));
  assert.equal(jobCalls.length, 1, "PR-62 has exactly one failed run");
  assert.ok(jobCalls[0].includes("28116254447"));
  assert.deepEqual(Object.keys(raw.jobsByRunId), ["28116254447"]);
});

test("fetchPrData: a PR with no failed runs fetches no step detail", () => {
  const calls = [];
  const raw = fetchPrData(92, { run: recordingRun(92, calls) });
  assert.equal(calls.filter((c) => c.includes("/jobs")).length, 0);
  assert.deepEqual(raw.jobsByRunId, {});
});

test("fetchPrData: pages through workflow runs past the 100-run page size", () => {
  // Runs are retrieved by branch and then filtered by head SHA. A single page
  // silently truncates: PR-63 already has 61 runs on its branch, and losing a
  // page would under-report exactly the CI-failure signal this suite exists to
  // protect.
  const view = {
    number: 1,
    headRefName: "busy-branch",
    createdAt: "2026-01-01T00:00:00Z",
    commits: [{ oid: "sha1" }],
    author: { login: "some-person" },
  };
  const page = (count, start) =>
    Array.from({ length: count }, (_, i) => ({
      id: start + i,
      event: "pull_request",
      conclusion: "success",
      head_sha: "sha1",
      created_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-02T00:10:00Z",
    }));

  const pagesRequested = [];
  const run = (args) => {
    if (args[0] === "pr") return JSON.stringify(view);
    // Match the standalone `page=N` argument, not the `per_page=N` one.
    const pageArg = args.find((a) => /^page=\d+$/.test(a));
    const p = pageArg ? Number(pageArg.slice(5)) : 1;
    pagesRequested.push(p);
    if (p === 1) return JSON.stringify({ workflow_runs: page(100, 1000) });
    if (p === 2) return JSON.stringify({ workflow_runs: page(20, 2000) });
    return JSON.stringify({ workflow_runs: [] });
  };

  const raw = fetchPrData(1, { run });

  assert.equal(raw.runs.length, 120, "both pages should be collected");
  assert.ok(pagesRequested.includes(2), "should request the second page");
  assert.ok(!pagesRequested.includes(3), "should stop once a page is short");
});

test("fetchPrData: a jobs fetch failure degrades to empty, not a crash", () => {
  // The capture workflow needs `actions: read` for this call. A missing
  // permission must cost the step detail, not the whole record.
  const f = fixture(62);
  const run = (args) => {
    if (args[0] === "pr") return JSON.stringify(f.view);
    if (args.join(" ").includes("/jobs")) throw new Error("403 missing actions:read");
    return JSON.stringify(f.runs);
  };
  const raw = fetchPrData(62, { run });
  assert.deepEqual(raw.jobsByRunId, {});
  assert.ok(raw.runs.length > 0, "run-level data still captured");
});
