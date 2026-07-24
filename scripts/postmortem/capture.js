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
