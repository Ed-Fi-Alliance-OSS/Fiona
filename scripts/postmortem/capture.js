// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

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
    .filter((t) => !Number.isNaN(t));
  if (!greens.length || !prCreatedAt) return null;
  const firstGreenISO = new Date(Math.min(...greens)).toISOString();
  return deriveMinutesBetween(prCreatedAt, firstGreenISO);
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
