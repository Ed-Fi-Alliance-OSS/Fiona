// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REWORK_PATTERNS = [/\brework\b/i, /refactor/i, /\bredo\b/i, /\binstead\b/i, /\bapproach\b/i, /rewrite/i];
const CORRECTNESS_PATTERNS = [/\bbug\b/i, /incorrect/i, /\bwrong\b/i, /\bfix\b/i, /\bfails?\b/i, /\berror\b/i, /should (be|not)/i];
const NIT_PATTERNS = [/\bnit\b/i, /typo/i, /formatting/i, /\bstyle\b/i, /whitespace/i];

export function classifyComment(body) {
  const text = String(body || "");
  if (REWORK_PATTERNS.some((r) => r.test(text))) return "rework";
  if (CORRECTNESS_PATTERNS.some((r) => r.test(text))) return "correctness";
  if (NIT_PATTERNS.some((r) => r.test(text))) return "nit";
  return "nit";
}

export function classifyFollowupCommit(message) {
  const m = String(message || "");
  if (/^feat(\(|:|\/)/i.test(m) || /\bfeature\b/i.test(m)) return "feature";
  if (/\bfix\b/i.test(m) || /\blint\b/i.test(m)) return "fix";
  return null;
}

export function parseJiraKey(title, branch) {
  const src = `${title || ""} ${branch || ""}`;
  const match = src.match(/\b([A-Z]{2,}-\d+)\b/);
  return match ? match[1] : null;
}

const DEPENDABOT_LOGIN = /^(app\/)?dependabot(\[bot\])?$/i;

// Cohort of the account that opened the PR. Kept separate from "is it a bot"
// because the analysis question is "was this the coding agent's work", and
// Dependabot volume would otherwise swamp the agent signal.
export function classifyAuthorKind(login) {
  const l = String(login ?? "").trim();
  if (!l) return "human";
  if (DEPENDABOT_LOGIN.test(l)) return "dependabot";
  if (/^copilot$/i.test(l) || /\bswe-agent\b/i.test(l)) return "agent";
  if (/\[bot\]$/i.test(l) || /^app\//i.test(l) || /copilot/i.test(l)) return "other-bot";
  return "human";
}

export function classifyParticipantKind(login) {
  return classifyAuthorKind(login);
}

// Runner scaffolding and reporting steps carry no signal about the change.
// "Report test results" in particular fails whenever junit.xml is absent —
// which happens precisely when tests were skipped — so counting it as a test
// failure would invent failures that never occurred.
const IGNORED_STEP = /^(set up job$|complete job$|post\s|report\s|checkout)/i;

export function classifyCiStep(name) {
  const n = String(name ?? "").trim();
  if (!n || IGNORED_STEP.test(n)) return null;
  if (/\blint\b/i.test(n)) return "lint";
  if (/\btests?\b/i.test(n)) return "test";
  if (/\bbuild\b/i.test(n)) return "build";
  return "other";
}

function inScopeCiRuns(runs, prCreatedAt) {
  const since = prCreatedAt ? new Date(prCreatedAt).getTime() : null;
  return (runs || [])
    .filter((r) => r.event === "pull_request")
    .filter((r) => {
      if (since === null) return true;
      // Branches are reused and pushed to before a PR exists; runs that predate
      // the PR are not evidence about this PR.
      const created = new Date(r.created_at).getTime();
      return !Number.isNaN(created) && created >= since;
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

// CI outcomes come from workflow-run + job-step history, not from `gh pr checks`.
// `gh pr checks` reports only the current state of the head SHA, which on a
// merged PR is green by definition, and this repo's check names ("Setup -
// apps/fiona-slack") carry no lint/test/build granularity anyway.
export function deriveCiOutcomes(runs, jobsByRunId = {}, prCreatedAt = null) {
  const ciFailures = { lint: 0, test: 0, build: 0, other: 0 };
  const ciSkipped = { lint: 0, test: 0, build: 0 };
  const ciRuns = { total: 0, failed: 0, cancelled: 0 };

  for (const run of inScopeCiRuns(runs, prCreatedAt)) {
    ciRuns.total += 1;
    // A run cancelled by the cancel-in-progress concurrency group is superseded
    // work, not a failure, and its partial steps are not evidence.
    if (run.conclusion === "cancelled") {
      ciRuns.cancelled += 1;
      continue;
    }
    if (run.conclusion === "failure") ciRuns.failed += 1;

    for (const job of jobsByRunId[run.id] || jobsByRunId[String(run.id)] || []) {
      for (const step of job.steps || []) {
        const kind = classifyCiStep(step.name);
        if (!kind) continue;
        if (step.conclusion === "failure") ciFailures[kind] += 1;
        else if (step.conclusion === "skipped" && kind in ciSkipped) ciSkipped[kind] += 1;
      }
    }
  }
  return { ciFailures, ciSkipped, ciRuns };
}

// A review "cycle" is a decision. GitHub emits one review object per inline
// comment in a batched review, so counting objects overstates cycles several
// fold (PR-85: 8 objects, 2 decisions).
const DECISION_STATES = new Set(["CHANGES_REQUESTED", "APPROVED"]);

export function deriveReviewCycles(reviews) {
  return (reviews || []).filter(
    (r) =>
      classifyAuthorKind(r.author?.login) === "human" &&
      DECISION_STATES.has(String(r.state || "").toUpperCase()),
  ).length;
}

export function deriveMinutesBetween(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 60000);
}

// Time from PR open to the FIRST green CI run. The previous implementation took
// min(completedAt) over currently-successful checks, which on a merged PR is the
// final suite — it reported 22863 minutes for PR-62 against a 30316-minute
// time-to-merge, i.e. a proxy for merge time rather than a CI-speed signal.
export function deriveTimeToFirstGreen(runs, prCreatedAt) {
  if (!prCreatedAt) return null;
  const firstGreen = inScopeCiRuns(runs, prCreatedAt).find((r) => r.conclusion === "success");
  if (!firstGreen?.updated_at) return null;
  return deriveMinutesBetween(prCreatedAt, firstGreen.updated_at);
}

const TEST_PATH = /(\.test\.|\.spec\.|__tests__\/|\/tests?\/)/i;
const DOC_PATH = /(\.md$|^docs\/)/i;
const DEP_PATH = /((^|\/)package\.json$|package-lock\.json$|yarn\.lock$)/i;
const SOURCE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|cs|go|rb|java|sh)$/i;

export function deriveChangeShape(files) {
  const list = files || [];
  const languages = {};
  let testFiles = 0;
  let sourceFiles = 0;
  let docsTouched = false;
  let depsManifestTouched = false;
  for (const f of list) {
    const p = String(f.path || "");
    if (p.includes(".")) {
      const ext = p.split(".").pop().toLowerCase();
      languages[ext] = (languages[ext] || 0) + 1;
    }
    if (DOC_PATH.test(p)) docsTouched = true;
    if (DEP_PATH.test(p)) depsManifestTouched = true;
    if (TEST_PATH.test(p)) testFiles += 1;
    else if (SOURCE_EXT.test(p) && !DOC_PATH.test(p)) sourceFiles += 1;
  }
  const testToSourceRatio =
    sourceFiles === 0 ? null : Math.round((testFiles / sourceFiles) * 100) / 100;
  return { languages, testToSourceRatio, docsTouched, depsManifestTouched };
}

export function deriveReworkAfterReview(commits, reviews) {
  const humanReviewTimes = (reviews || [])
    .filter((r) => classifyParticipantKind(r.author?.login) === "human" && r.submittedAt)
    .map((r) => new Date(r.submittedAt).getTime())
    .filter((t) => !Number.isNaN(t));
  if (!humanReviewTimes.length) return false;
  const firstReview = Math.min(...humanReviewTimes);
  for (const c of commits || []) {
    if (classifyFollowupCommit(c.messageHeadline || c.message) !== "fix") continue;
    const t = new Date(c.committedDate || c.authoredDate || 0).getTime();
    if (!Number.isNaN(t) && t > firstReview) return true;
  }
  return false;
}

export function buildParticipants(prAuthorLogin, reviews) {
  const participants = [
    { role: "author", kind: classifyParticipantKind(prAuthorLogin), association: "AUTHOR" },
  ];
  const seen = new Set();
  for (const review of reviews || []) {
    const kind = classifyParticipantKind(review.author?.login);
    const association = review.authorAssociation || "NONE";
    const key = `${kind}:${association}`;
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push({
      role: kind === "human" ? "human-reviewer" : "bot-reviewer",
      kind,
      association,
    });
  }
  return participants;
}

export function buildPostmortemRecord(raw, now = new Date()) {
  const { pr, reviews = [], comments = [], commits = [], files = [], runs = [], jobsByRunId = {} } = raw;
  const reviewCycles = deriveReviewCycles(reviews);
  const { ciFailures, ciSkipped, ciRuns } = deriveCiOutcomes(runs, jobsByRunId, pr.createdAt);
  const commentClasses = { nit: 0, correctness: 0, rework: 0 };
  for (const c of comments) commentClasses[classifyComment(c.body)] += 1;
  const followupCommits = { fix: 0, feature: 0 };
  for (const c of commits) {
    const kind = classifyFollowupCommit(c.messageHeadline || c.message);
    if (kind) followupCommits[kind] += 1;
  }
  return {
    schemaVersion: 2,
    prNumber: pr.number,
    title: pr.title,
    state: pr.mergedAt ? "merged" : "closed",
    jiraKey: parseJiraKey(pr.title, pr.headRefName),
    authorKind: classifyAuthorKind(pr.author?.login),
    stats: {
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changedFiles ?? 0,
      commits: commits.length,
      reviewCycles,
      reviewComments: comments.length,
      timeToFirstGreenCiMinutes: deriveTimeToFirstGreen(runs, pr.createdAt),
      timeToMergeMinutes: deriveMinutesBetween(pr.createdAt, pr.mergedAt),
      ciRuns,
      ciFailures,
      ciSkipped,
    },
    changeShape: deriveChangeShape(files),
    signal: {
      commentClasses,
      followupCommits,
      reworkAfterReview: deriveReworkAfterReview(commits, reviews),
    },
    participants: buildParticipants(pr.author?.login, reviews),
    capturedAt: now.toISOString(),
  };
}

export function writeRecord(record, dir = "docs/postmortems") {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `PR-${record.prNumber}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function fetchPrData(prNumber, deps = {}) {
  const run = deps.run || ((args) => execFileSync("gh", args, { encoding: "utf8" }));
  const bundle = JSON.parse(
    run([
      "pr", "view", String(prNumber),
      "--json",
      "number,title,state,headRefName,additions,deletions,changedFiles,createdAt,mergedAt,closedAt,author,reviews,comments,commits,files",
    ]),
  );
  const runs = fetchWorkflowRuns(bundle, run);
  return {
    pr: bundle,
    reviews: bundle.reviews || [],
    comments: bundle.comments || [],
    commits: bundle.commits || [],
    files: bundle.files || [],
    runs,
    // Step detail only explains failures, so only failed runs are worth an API
    // call. PR-63 has 54 in-scope runs and 9 failures.
    jobsByRunId: fetchJobs(
      inScopeCiRuns(runs, bundle.createdAt).filter((r) => r.conclusion === "failure"),
      run,
    ),
  };
}

const RUNS_PER_PAGE = 100;
// A branch's run list can exceed one page (PR-63 has 61), and a truncated page
// would silently under-report CI failures. Bounded so a pathological branch
// cannot make capture run away.
const MAX_RUN_PAGES = 10;

// Retrieval is by branch; SCOPING is by head SHA, because a branch can outlive,
// predate, or be reused by another PR, and also carries deploy
// (workflow_dispatch) and code-review (dynamic) runs.
function fetchWorkflowRuns(bundle, run) {
  const oids = new Set((bundle.commits || []).map((c) => c.oid));
  const collected = [];
  try {
    for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
      const payload = JSON.parse(
        run([
          "api", "-X", "GET", "repos/{owner}/{repo}/actions/runs",
          "-f", `branch=${bundle.headRefName}`,
          "-f", `per_page=${RUNS_PER_PAGE}`,
          "-f", `page=${page}`,
        ]),
      );
      const batch = payload.workflow_runs || [];
      collected.push(...batch);
      if (batch.length < RUNS_PER_PAGE) break;
    }
  } catch {
    // Keep whatever pages already arrived rather than discarding the record.
  }
  return collected.filter((r) => oids.has(r.head_sha));
}

// Requires the `actions: read` permission. Degrade per-run rather than aborting
// the capture, so a permission or retention gap costs one run, not the record.
function fetchJobs(runs, run) {
  const jobsByRunId = {};
  for (const r of runs) {
    try {
      const payload = JSON.parse(
        run(["api", "-X", "GET", `repos/{owner}/{repo}/actions/runs/${r.id}/jobs`, "-f", "per_page=100"]),
      );
      jobsByRunId[r.id] = payload.jobs || [];
    } catch {
      // No jobs for this run; deriveCiOutcomes treats it as run-level only.
    }
  }
  return jobsByRunId;
}

async function main() {
  const prNumber = process.argv[2];
  if (!prNumber) {
    console.error("usage: node capture.js <prNumber>");
    process.exit(1);
  }
  const raw = fetchPrData(prNumber);
  const record = buildPostmortemRecord(raw);
  const file = writeRecord(record);
  console.log(`wrote ${file}`);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main();
}
