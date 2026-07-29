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

export function classifyParticipantKind(login) {
  const l = String(login || "").toLowerCase();
  if (l.includes("copilot") || l.includes("swe-agent") || l.endsWith("[bot]")) {
    return "copilot-bot";
  }
  return "human";
}

export function deriveCiFailures(checkRuns) {
  const failures = { lint: 0, test: 0, build: 0 };
  for (const run of checkRuns || []) {
    if (run.conclusion !== "failure") continue;
    const name = String(run.name || "").toLowerCase();
    if (name.includes("lint")) failures.lint += 1;
    else if (name.includes("test")) failures.test += 1;
    else if (name.includes("build")) failures.build += 1;
  }
  return failures;
}

export function deriveMinutesBetween(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 60000);
}

export function deriveTimeToFirstGreen(checkRuns, prCreatedAt) {
  const greens = (checkRuns || [])
    .filter((r) => r.conclusion === "success" && r.completedAt)
    .map((r) => new Date(r.completedAt).getTime())
    // Drop the epoch-negative sentinel GitHub returns for status contexts
    // with no real completion time (e.g. "0001-01-01T00:00:00Z" for license/cla).
    .filter((t) => !Number.isNaN(t) && t > 0);
  if (!greens.length || !prCreatedAt) return null;
  const firstGreenISO = new Date(Math.min(...greens)).toISOString();
  return deriveMinutesBetween(prCreatedAt, firstGreenISO);
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
      role: kind === "copilot-bot" ? "copilot-bot" : "human-reviewer",
      kind,
      association,
    });
  }
  return participants;
}

export function buildPostmortemRecord(raw, now = new Date()) {
  const { pr, reviews = [], comments = [], commits = [], checkRuns = [], files = [] } = raw;
  const reviewCycles = (reviews || [])
    .filter((r) => classifyParticipantKind(r.author?.login) === "human").length;
  const commentClasses = { nit: 0, correctness: 0, rework: 0 };
  for (const c of comments) commentClasses[classifyComment(c.body)] += 1;
  const followupCommits = { fix: 0, feature: 0 };
  for (const c of commits) {
    const kind = classifyFollowupCommit(c.messageHeadline || c.message);
    if (kind) followupCommits[kind] += 1;
  }
  return {
    prNumber: pr.number,
    title: pr.title,
    state: pr.mergedAt ? "merged" : "closed",
    jiraKey: parseJiraKey(pr.title, pr.headRefName),
    stats: {
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changedFiles ?? 0,
      commits: commits.length,
      reviewCycles,
      reviewComments: comments.length,
      timeToFirstGreenCiMinutes: deriveTimeToFirstGreen(checkRuns, pr.createdAt),
      timeToMergeMinutes: deriveMinutesBetween(pr.createdAt, pr.mergedAt),
      ciFailures: deriveCiFailures(checkRuns),
    },
    changeShape: deriveChangeShape(files),
    signal: {
      commentClasses,
      followupCommits,
      reworkAfterReview: deriveReworkAfterReview(commits, reviews),
      changeRequestThemes: [],
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
  const runChecks = deps.runChecks || (() => fetchCheckRuns(prNumber, run));
  const bundle = JSON.parse(
    run([
      "pr", "view", String(prNumber),
      "--json",
      "number,title,state,headRefName,additions,deletions,changedFiles,createdAt,mergedAt,closedAt,author,reviews,comments,commits,files",
    ]),
  );
  return {
    pr: bundle,
    reviews: bundle.reviews || [],
    comments: bundle.comments || [],
    commits: bundle.commits || [],
    files: bundle.files || [],
    checkRuns: runChecks(),
  };
}

function fetchCheckRuns(prNumber, run) {
  try {
    const rows = JSON.parse(
      run(["pr", "checks", String(prNumber), "--json", "name,state,completedAt"]),
    );
    return rows.map((r) => ({
      name: r.name,
      conclusion: r.state === "SUCCESS" ? "success" : r.state === "FAILURE" ? "failure" : "other",
      completedAt: r.completedAt || null,
    }));
  } catch {
    return [];
  }
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
