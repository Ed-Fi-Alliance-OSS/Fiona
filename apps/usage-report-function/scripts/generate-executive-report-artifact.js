// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Generates the executive report PDF for the same 7 whole UTC days
// WeeklyReportTrigger reports on (resolveWeeklyReportWindow), and writes it plus a small metadata
// file describing it. Run by the generate-usage-report-pdf GitHub Actions
// workflow shortly before REPORT_SCHEDULE fires on the same UTC day, so the
// two windows are identical.
// The workflow's remaining steps (blob upload, SAS generation, pointer
// write) are plain `az` CLI calls, not part of this script.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { resolveWeeklyReportWindow } from '../lib/activity-records.js';
import { generateExecutiveReportPdf } from '../lib/pdf/generate-executive-report-pdf.js';
import { buildExecutiveReportData } from '../lib/report-data.js';

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'chatbot';
const COSMOS_INTERACTIONS_CONTAINER = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';
const COSMOS_FEEDBACK_CONTAINER = process.env.COSMOS_FEEDBACK_CONTAINER || 'feedback';
const COSMOS_USERS_CONTAINER = process.env.COSMOS_USERS_CONTAINER || 'slack-users';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'production';
const OUTPUT_DIR = process.env.REPORT_OUTPUT_DIR || path.join(process.cwd(), 'reports');

/**
 * Builds and renders the report for the window ending at `now`'s UTC
 * midnight. Exported so tests can drive it with fakes; the CLI entry point
 * at the bottom only runs when this file is executed directly.
 */
export async function main({
  now = new Date(),
  outputDir = OUTPUT_DIR,
  createContainers = createCosmosContainers,
  buildReportData = buildExecutiveReportData,
  renderPdf = generateExecutiveReportPdf,
} = {}) {
  // Same window as WeeklyReportTrigger/index.js, so the PDF and that
  // week's Slack KPI text describe exactly the same records.
  const { startISO, endISO, startDate, endDate } = resolveWeeklyReportWindow(now);
  const { interactionsContainer, feedbackContainer, usersContainer } = createContainers();

  console.log(`Building executive report data for ${DEPLOYMENT_TYPE} ${startDate} to ${endDate}...`);
  const reportData = await buildReportData({
    interactionsContainer,
    feedbackContainer,
    usersContainer,
    deploymentType: DEPLOYMENT_TYPE,
    startISO,
    endISO,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const pdfFileName = `executive-report-${DEPLOYMENT_TYPE}-${startDate}-to-${endDate}.pdf`;
  const pdfPath = path.join(outputDir, pdfFileName);

  console.log(`Rendering PDF to ${pdfPath}...`);
  await renderPdf(reportData, pdfPath);

  const metaPath = path.join(outputDir, 'report-meta.json');
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ deploymentType: DEPLOYMENT_TYPE, weekStart: startDate, weekEnd: endDate, pdfFileName }, null, 2),
  );

  console.log(`Done. PDF: ${pdfPath}`);
  console.log(`Metadata: ${metaPath}`);
  return { pdfPath, metaPath };
}

function createCosmosContainers() {
  if (!COSMOS_ENDPOINT) {
    throw new Error('Required environment variable COSMOS_ENDPOINT is not set');
  }
  const cosmosClient = COSMOS_ENDPOINT.includes('AccountKey=')
    ? new CosmosClient(COSMOS_ENDPOINT)
    : new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential() });
  const database = cosmosClient.database(COSMOS_DATABASE);
  return {
    interactionsContainer: database.container(COSMOS_INTERACTIONS_CONTAINER),
    feedbackContainer: database.container(COSMOS_FEEDBACK_CONTAINER),
    usersContainer: database.container(COSMOS_USERS_CONTAINER),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Failed to generate executive report artifact:', error);
    process.exit(1);
  });
}
