// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyComment,
  classifyFollowupCommit,
  parseJiraKey,
  classifyParticipantKind,
  deriveCiFailures,
  deriveMinutesBetween,
  deriveTimeToFirstGreen,
  deriveChangeShape,
  deriveReworkAfterReview,
  buildParticipants,
  buildPostmortemRecord,
  writeRecord,
  fetchPrData,
} from "./capture.js";

test("classifyComment: rework beats correctness beats nit", () => {
  assert.equal(classifyComment("Let's refactor this to use the SDK instead"), "rework");
  assert.equal(classifyComment("This is wrong, it fails on empty input"), "correctness");
  assert.equal(classifyComment("nit: trailing whitespace"), "nit");
  assert.equal(classifyComment("looks good"), "nit");
  assert.equal(classifyComment(""), "nit");
});

test("classifyFollowupCommit: fix vs feature vs null", () => {
  assert.equal(classifyFollowupCommit("fix: resolve biome lint errors"), "fix");
  assert.equal(classifyFollowupCommit("chore: fix flaky test"), "fix");
  assert.equal(classifyFollowupCommit("feat(AI-179): add search"), "feature");
  assert.equal(classifyFollowupCommit("docs: update readme"), null);
});

test("parseJiraKey: extracts first ticket key from title or branch", () => {
  assert.equal(parseJiraKey("feat(AI-179): implement search", ""), "AI-179");
  assert.equal(parseJiraKey("implement search", "ai-98-hitl-bug"), null);
  assert.equal(parseJiraKey("", "feature/AI-42-thing"), "AI-42");
  assert.equal(parseJiraKey("no ticket here", "plain-branch"), null);
});

test("classifyParticipantKind: detects Copilot bot vs human", () => {
  assert.equal(classifyParticipantKind("copilot-swe-agent"), "copilot-bot");
  assert.equal(classifyParticipantKind("some-bot[bot]"), "copilot-bot");
  assert.equal(classifyParticipantKind("roberthunterjr"), "human");
});

test("deriveCiFailures: buckets failed check runs by name", () => {
  const runs = [
    { name: "Biome lint", conclusion: "failure" },
    { name: "Unit tests", conclusion: "failure" },
    { name: "Unit tests", conclusion: "success" },
    { name: "Docker build", conclusion: "failure" },
  ];
  assert.deepEqual(deriveCiFailures(runs), { lint: 1, test: 1, build: 1 });
  assert.deepEqual(deriveCiFailures([]), { lint: 0, test: 0, build: 0 });
});

test("deriveMinutesBetween: rounds minutes, null on missing/invalid", () => {
  assert.equal(deriveMinutesBetween("2026-07-24T00:00:00Z", "2026-07-24T01:30:00Z"), 90);
  assert.equal(deriveMinutesBetween(null, "2026-07-24T01:00:00Z"), null);
  assert.equal(deriveMinutesBetween("bad", "2026-07-24T01:00:00Z"), null);
});

test("deriveTimeToFirstGreen: minutes from PR creation to earliest success", () => {
  const runs = [
    { conclusion: "success", completedAt: "2026-07-24T02:00:00Z" },
    { conclusion: "success", completedAt: "2026-07-24T00:30:00Z" },
    { conclusion: "failure", completedAt: "2026-07-24T00:10:00Z" },
  ];
  assert.equal(deriveTimeToFirstGreen(runs, "2026-07-24T00:00:00Z"), 30);
  assert.equal(deriveTimeToFirstGreen([], "2026-07-24T00:00:00Z"), null);
});

test("deriveTimeToFirstGreen: ignores sentinel zero-time green (e.g. license/cla)", () => {
  const runs = [
    { conclusion: "success", completedAt: "0001-01-01T00:00:00Z" },
    { conclusion: "success", completedAt: "2026-07-24T00:30:00Z" },
  ];
  // The sentinel must not be treated as the earliest green.
  assert.equal(deriveTimeToFirstGreen(runs, "2026-07-24T00:00:00Z"), 30);
  // A green with only a sentinel timestamp yields no real green => null.
  assert.equal(
    deriveTimeToFirstGreen(
      [{ conclusion: "success", completedAt: "0001-01-01T00:00:00Z" }],
      "2026-07-24T00:00:00Z",
    ),
    null,
  );
});

test("deriveChangeShape: languages, test/source ratio, docs & deps flags", () => {
  const files = [
    { path: "apps/fiona-slack/src/search.js", additions: 40, deletions: 2 },
    { path: "apps/fiona-slack/src/search.test.js", additions: 30, deletions: 0 },
    { path: "apps/fiona-slack/src/index.js", additions: 5, deletions: 0 },
    { path: "docs/README.md", additions: 5, deletions: 0 },
    { path: "apps/fiona-slack/package.json", additions: 1, deletions: 1 },
  ];
  const shape = deriveChangeShape(files);
  assert.deepEqual(shape.languages, { js: 3, md: 1, json: 1 });
  assert.equal(shape.testToSourceRatio, 0.5); // 1 test file / 2 source files
  assert.equal(shape.docsTouched, true);
  assert.equal(shape.depsManifestTouched, true);
  const none = deriveChangeShape([{ path: "docs/only.md", additions: 1, deletions: 0 }]);
  assert.equal(none.testToSourceRatio, null); // no source files
  assert.equal(none.docsTouched, true);
  assert.deepEqual(deriveChangeShape([]), {
    languages: {}, testToSourceRatio: null, docsTouched: false, depsManifestTouched: false,
  });
});

test("deriveReworkAfterReview: fix commit after first human review => true", () => {
  const reviews = [
    { author: { login: "roberthunterjr" }, submittedAt: "2026-07-24T10:00:00Z" },
  ];
  const afterFix = [
    { messageHeadline: "feat: initial", committedDate: "2026-07-24T09:00:00Z" },
    { messageHeadline: "fix: address review", committedDate: "2026-07-24T11:00:00Z" },
  ];
  assert.equal(deriveReworkAfterReview(afterFix, reviews), true);
  // fix commit BEFORE the review does not count
  const beforeFix = [
    { messageHeadline: "fix: pre-review", committedDate: "2026-07-24T08:00:00Z" },
  ];
  assert.equal(deriveReworkAfterReview(beforeFix, reviews), false);
  // no human review => false
  assert.equal(deriveReworkAfterReview(afterFix, []), false);
  // bot-only review => false (not a human review)
  const botReview = [{ author: { login: "copilot-swe-agent" }, submittedAt: "2026-07-24T10:00:00Z" }];
  assert.equal(deriveReworkAfterReview(afterFix, botReview), false);
});

test("buildParticipants: roles only, never emits human logins", () => {
  const reviews = [
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
    { author: { login: "copilot-swe-agent" }, authorAssociation: "CONTRIBUTOR", state: "COMMENTED" },
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
  ];
  const participants = buildParticipants("copilot-swe-agent", reviews);
  assert.deepEqual(participants[0], { role: "author", kind: "copilot-bot", association: "AUTHOR" });
  const human = participants.find((p) => p.role === "human-reviewer");
  assert.deepEqual(human, { role: "human-reviewer", kind: "human", association: "MEMBER" });
  assert.ok(!JSON.stringify(participants).includes("roberthunterjr"), "no human login in output");
});

const RAW = {
  pr: {
    number: 81, title: "feat(AI-179): implement search", state: "MERGED",
    headRefName: "copilot/ai-179", additions: 1196, deletions: 99, changedFiles: 25,
    createdAt: "2026-07-23T16:00:00Z", mergedAt: "2026-07-24T16:00:00Z",
    author: { login: "copilot-swe-agent" },
  },
  reviews: [
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
    { author: { login: "roberthunterjr" }, authorAssociation: "MEMBER", state: "COMMENTED" },
  ],
  comments: [
    { body: "Let's use the SDK instead" }, { body: "nit: spacing" },
    { body: "this is wrong on empty input" },
  ],
  commits: [
    { messageHeadline: "feat: add search" }, { messageHeadline: "fix: lint errors" },
  ],
  checkRuns: [
    { name: "Biome lint", conclusion: "failure", completedAt: "2026-07-23T16:20:00Z" },
    { name: "Unit tests", conclusion: "success", completedAt: "2026-07-23T16:40:00Z" },
  ],
};

test("buildPostmortemRecord: assembles spec-shaped record, no human login", () => {
  const rec = buildPostmortemRecord(RAW, new Date("2026-07-24T17:00:00Z"));
  assert.equal(rec.prNumber, 81);
  assert.equal(rec.state, "merged");
  assert.equal(rec.jiraKey, "AI-179");
  assert.equal(rec.stats.additions, 1196);
  assert.equal(rec.stats.commits, 2);
  assert.equal(rec.stats.reviewCycles, 2); // 2 human review submissions
  assert.equal(rec.stats.reviewComments, 3);
  assert.equal(rec.stats.timeToMergeMinutes, 1440);
  assert.equal(rec.stats.timeToFirstGreenCiMinutes, 40);
  assert.deepEqual(rec.stats.ciFailures, { lint: 1, test: 0, build: 0 });
  assert.deepEqual(rec.signal.commentClasses, { nit: 1, correctness: 1, rework: 1 });
  assert.deepEqual(rec.signal.followupCommits, { fix: 1, feature: 1 });
  assert.deepEqual(rec.signal.changeRequestThemes, []);
  assert.equal(rec.capturedAt, "2026-07-24T17:00:00.000Z");
  assert.ok(!JSON.stringify(rec).includes("roberthunterjr"), "no human login in record");
});

test("writeRecord: writes PR-<n>.json and returns its path", () => {
  const dir = path.join(os.tmpdir(), `pm-test-${Date.now()}`);
  try {
    const file = writeRecord({ prNumber: 7, stats: {} }, dir);
    assert.equal(file, path.join(dir, "PR-7.json"));
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(parsed.prNumber, 7);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchPrData: shells through injected run and returns raw bundle", () => {
  const calls = [];
  const fakeRun = (args) => {
    calls.push(args);
    return JSON.stringify({
      number: 81, title: "feat(AI-179): x", headRefName: "b",
      additions: 1, deletions: 0, changedFiles: 1, createdAt: "2026-07-23T16:00:00Z",
      mergedAt: null, author: { login: "copilot-swe-agent" },
      reviews: [], comments: [], commits: [],
    });
  };
  const raw = fetchPrData(81, { run: fakeRun, runChecks: () => [] });
  assert.equal(raw.pr.number, 81);
  assert.ok(Array.isArray(raw.reviews));
  assert.ok(calls[0].includes("81"));
});
