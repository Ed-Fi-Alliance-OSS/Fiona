// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { buildReadoutBullets, buildReliabilityTakeaways, buildUsageObservations } from './narrative.js';
import { renderExecutiveReportHtml } from './report-template.js';

const require = createRequire(import.meta.url);

// chart.js's package.json "exports" map does not expose "./dist/chart.umd.js"
// as a resolvable subpath, so require.resolve('chart.js/dist/chart.umd.js')
// throws ERR_PACKAGE_PATH_NOT_EXPORTED. The main entry ("chart.js") IS
// exported and resolves to dist/chart.js, so its directory is used to reach
// the sibling UMD file directly via fs (which isn't subject to the exports map).
function readChartJsSource() {
  const mainEntryPath = require.resolve('chart.js');
  const chartJsPath = path.join(path.dirname(mainEntryPath), 'chart.umd.js');
  return fs.readFileSync(chartJsPath, 'utf-8');
}

/**
 * Assembles the narrative-style executive PDF report from a
 * `buildExecutiveReportData` bundle and writes it to `outputPath`.
 * Renders via Puppeteer (headless Chromium) rather than pdfkit — see
 * docs/usage-report/2026-07-10-usage-report-narrative-pdf-redesign-design.md
 * for why. This path only ever runs ad hoc via the agent, never inside the
 * deployed Azure Function.
 */
export async function generateExecutiveReportPdf(reportData, outputPath) {
  const narrative = {
    readoutBullets: buildReadoutBullets(reportData.kpiSummary, reportData.weeklyTrend),
    usageObservations: buildUsageObservations(reportData.weeklyTrend),
    reliabilityTakeaways: buildReliabilityTakeaways(reportData.kpiSummary, reportData.weeklyTrend),
  };

  const chartJsSource = readChartJsSource();
  const html = renderExecutiveReportHtml(reportData, narrative, chartJsSource);

  // Bare `puppeteer.launch()` times out waiting for the browser's WS endpoint
  // in this environment (Chrome sandboxing/permissions on this machine) --
  // confirmed via Task 6's verification step. These flags are required here.
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction('window.__chartsReady === true', { timeout: 10000 });

    const period = `${reportData.period.startISO.split('T')[0]} to ${reportData.period.endISO.split('T')[0]}`;
    const footerTemplate = `
      <div style="font-size:8px; width:100%; padding:0 40px; display:flex; justify-content:space-between; color:#666;">
        <span>Fiona Usage Analytics | ${reportData.period.deploymentType} | ${period}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`;

    await page.pdf({
      path: outputPath,
      format: 'Letter',
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate,
      margin: { top: '20px', bottom: '40px', left: '20px', right: '20px' },
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}
