// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyComment,
  classifyFollowupCommit,
  parseJiraKey,
  classifyParticipantKind,
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

import {
  deriveCiFailures,
  deriveMinutesBetween,
  deriveTimeToFirstGreen,
  buildParticipants,
} from "./capture.js";

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
