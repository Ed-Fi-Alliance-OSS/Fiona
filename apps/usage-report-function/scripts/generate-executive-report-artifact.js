// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Generates the executive report PDF for the same [oneWeekAgo, endOfReport)
// window WeeklyReportTrigger computes, and writes it plus a small metadata
// file describing it. Run by the generate-usage-report-pdf GitHub Actions
// workflow shortly before REPORT_SCHEDULE fires, so the two windows line up.
// The workflow's remaining steps (blob upload, SAS generation, pointer
// write) are plain `az` CLI calls, not part of this script.

import fs from 'node:fs';
import path from 'node:path';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { generateExecutiveReportPdf } from '../lib/pdf/generate-executive-report-pdf.js';
import { buildExecutiveReportData } from '../lib/report-data.js';

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'chatbot';
const COSMOS_INTERACTIONS_CONTAINER = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';
const COSMOS_FEEDBACK_CONTAINER = process.env.COSMOS_FEEDBACK_CONTAINER || 'feedback';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'production';
const OUTPUT_DIR = process.env.REPORT_OUTPUT_DIR || path.join(process.cwd(), 'reports');

if (!COSMOS_ENDPOINT) {
  throw new Error('Required environment variable COSMOS_ENDPOINT is not set');
}

async function main() {
  // Same lookback formula as WeeklyReportTrigger/index.js, so the PDF
  // and that week's Slack KPI text describe the same Mon-Sun window.
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endOfReport = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startDate = oneWeekAgo.toISOString().split('T')[0];
  const endDate = endOfReport.toISOString().split('T')[0];

  const cosmosClient = COSMOS_ENDPOINT.includes('AccountKey=')
    ? new CosmosClient(COSMOS_ENDPOINT)
    : new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential() });
  const database = cosmosClient.database(COSMOS_DATABASE);
  const interactionsContainer = database.container(COSMOS_INTERACTIONS_CONTAINER);
  const feedbackContainer = database.container(COSMOS_FEEDBACK_CONTAINER);

  console.log(`Building executive report data for ${DEPLOYMENT_TYPE} ${startDate} to ${endDate}...`);
  const reportData = await buildExecutiveReportData({
    interactionsContainer,
    feedbackContainer,
    deploymentType: DEPLOYMENT_TYPE,
    startISO: oneWeekAgo.toISOString(),
    endISO: endOfReport.toISOString(),
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const pdfFileName = `executive-report-${DEPLOYMENT_TYPE}-${startDate}-to-${endDate}.pdf`;
  const pdfPath = path.join(OUTPUT_DIR, pdfFileName);

  console.log(`Rendering PDF to ${pdfPath}...`);
  await generateExecutiveReportPdf(reportData, pdfPath);

  const metaPath = path.join(OUTPUT_DIR, 'report-meta.json');
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ deploymentType: DEPLOYMENT_TYPE, weekStart: startDate, weekEnd: endDate, pdfFileName }, null, 2),
  );

  console.log(`Done. PDF: ${pdfPath}`);
  console.log(`Metadata: ${metaPath}`);
}

main().catch((error) => {
  console.error('Failed to generate executive report artifact:', error);
  process.exit(1);
});
