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
