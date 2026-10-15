// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

delete process.env.COSMOS_ENDPOINT;
delete process.env.DEPLOYMENT_TYPE;

// Importing must not require Cosmos configuration; only the CLI entry point does.
const { main } = await import('../../scripts/generate-executive-report-artifact.js');

const NOW = new Date('2026-10-09T15:00:00.000Z');
const EXPECTED_PDF = 'executive-report-production-2026-10-02-to-2026-10-08.pdf';

describe('generate-executive-report-artifact main', () => {
  let outputDir;
  let containers;
  let buildReportData;
  let renderPdf;

  const run = () => main({ now: NOW, outputDir, createContainers: () => containers, buildReportData, renderPdf });

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-report-'));
    containers = { interactionsContainer: { id: 'i' }, feedbackContainer: { id: 'f' }, usersContainer: { id: 'u' } };
    buildReportData = jest.fn(async () => ({ marker: 'report-data' }));
    renderPdf = jest.fn(async () => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('builds report data for the 7 whole UTC days before the run date, with the users container', async () => {
    await run();
    expect(buildReportData).toHaveBeenCalledWith({
      ...containers,
      deploymentType: 'production',
      startISO: '2026-10-02T00:00:00.000Z',
      endISO: '2026-10-09T00:00:00.000Z',
    });
  });

  it('renders the PDF to a file named for the first and last included day', async () => {
    const { pdfPath } = await run();
    expect(path.basename(pdfPath)).toBe(EXPECTED_PDF);
    expect(path.dirname(pdfPath)).toBe(outputDir);
    expect(renderPdf).toHaveBeenCalledWith({ marker: 'report-data' }, pdfPath);
  });

  it('writes report-meta.json describing the PDF for getLatestReportLink', async () => {
    const { metaPath } = await run();
    expect(metaPath).toBe(path.join(outputDir, 'report-meta.json'));
    expect(JSON.parse(fs.readFileSync(metaPath, 'utf-8'))).toEqual({
      deploymentType: 'production',
      weekStart: '2026-10-02',
      weekEnd: '2026-10-08',
      pdfFileName: EXPECTED_PDF,
    });
  });

  it('rejects, without rendering or writing metadata, when building report data fails', async () => {
    buildReportData.mockRejectedValue(new Error("User directory 'slack-users' unavailable (status 403)"));

    await expect(run()).rejects.toThrow('unavailable (status 403)');
    expect(renderPdf).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(outputDir, 'report-meta.json'))).toBe(false);
  });

  it('rejects when rendering fails, without writing metadata', async () => {
    renderPdf.mockRejectedValue(new Error('chrome missing'));

    await expect(run()).rejects.toThrow('chrome missing');
    expect(fs.existsSync(path.join(outputDir, 'report-meta.json'))).toBe(false);
  });
});
