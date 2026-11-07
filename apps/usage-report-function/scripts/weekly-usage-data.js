// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Writes the data behind the weekly status email as JSON: the KPI summary and
// internal/external segments for the same 7 whole UTC days WeeklyReportTrigger
// reports on, the same figures for the 7 days before (for week-over-week
// comparison), and this week's feedback details. Unlike
// generate-executive-report-artifact.js, it renders no PDF.
//
// Usage: node scripts/weekly-usage-data.js [--now <ISO date>]
// Output goes to reports/<run date>/ (one folder per weekly run) unless
// REPORT_OUTPUT_DIR is set.
// Needs COSMOS_ENDPOINT and an `az login` session (or an AccountKey connection string).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWeeklyReportWindow } from '../lib/activity-records.js';
import { buildExecutiveReportData } from '../lib/report-data.js';
import { createCosmosContainers } from './generate-executive-report-artifact.js';

const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'production';
const REPORTS_ROOT = path.join(process.cwd(), 'reports');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The run's own folder, `reports/<YYYY-MM-DD>` for the UTC day of `now`, so
 * each week's data, email and chart stay together. REPORT_OUTPUT_DIR overrides it.
 */
export function defaultOutputDir(now, env = process.env) {
  return env.REPORT_OUTPUT_DIR || path.join(REPORTS_ROOT, now.toISOString().slice(0, 10));
}

/**
 * Builds the current and previous week's data and writes it to
 * `weekly-usage-<deployment>-<start>-to-<end>.json` in `outputDir`.
 * Exported so tests can drive it with fakes.
 */
export async function main({
  now = new Date(),
  outputDir = defaultOutputDir(now),
  createContainers = createCosmosContainers,
  buildReportData = buildExecutiveReportData,
} = {}) {
  const current = resolveWeeklyReportWindow(now);
  const previous = resolveWeeklyReportWindow(new Date(now.getTime() - 7 * DAY_MS));
  const containers = createContainers();

  const build = (window) =>
    buildReportData({
      ...containers,
      deploymentType: DEPLOYMENT_TYPE,
      startISO: window.startISO,
      endISO: window.endISO,
    });

  console.log(`Building ${DEPLOYMENT_TYPE} usage data for ${current.startDate} to ${current.endDate}...`);
  const [currentData, previousData] = await Promise.all([build(current), build(previous)]);

  const result = {
    deploymentType: DEPLOYMENT_TYPE,
    current: summarize(current, currentData),
    previous: summarize(previous, previousData),
    feedbackDetails: currentData.feedbackDetails,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(
    outputDir,
    `weekly-usage-${DEPLOYMENT_TYPE}-${current.startDate}-to-${current.endDate}.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Done. Data: ${outPath}`);
  return { outPath, result };
}

function summarize(window, data) {
  return {
    startDate: window.startDate,
    endDate: window.endDate,
    kpiSummary: data.kpiSummary,
    userSegments: data.userSegments,
  };
}

function parseNow(argv) {
  const i = argv.indexOf('--now');
  if (i === -1) return new Date();
  const now = new Date(argv[i + 1]);
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now value: ${argv[i + 1]}`);
  return now;
}

// Compare real paths case-insensitively so symlinks and Windows drive-letter
// casing can't make the CLI silently skip main() and exit 0.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  const normalize = (p) => fs.realpathSync(p).toLowerCase();
  try {
    return normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main({ now: parseNow(process.argv) }).catch((error) => {
    console.error('Failed to build weekly usage data:', error);
    process.exit(1);
  });
}
