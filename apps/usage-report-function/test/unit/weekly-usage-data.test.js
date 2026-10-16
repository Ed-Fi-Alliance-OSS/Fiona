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
const { main } = await import('../../scripts/weekly-usage-data.js');

const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('weekly-usage-data main', () => {
  let outputDir;
  let containers;
  let buildReportData;

  const run = () => main({ now: NOW, outputDir, createContainers: () => containers, buildReportData });

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-usage-'));
    containers = { interactionsContainer: { id: 'i' }, feedbackContainer: { id: 'f' }, usersContainer: { id: 'u' } };
    buildReportData = jest.fn(async ({ startISO }) => ({
      kpiSummary: { marker: startISO },
      userSegments: { internal: {}, external: {} },
      feedbackDetails: [{ startISO }],
    }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('builds this week and the week before, with the users container', async () => {
    await run();
    expect(buildReportData).toHaveBeenCalledWith({
      ...containers,
      deploymentType: 'production',
      startISO: '2026-10-09T00:00:00.000Z',
      endISO: '2026-10-16T00:00:00.000Z',
    });
    expect(buildReportData).toHaveBeenCalledWith({
      ...containers,
      deploymentType: 'production',
      startISO: '2026-10-02T00:00:00.000Z',
      endISO: '2026-10-09T00:00:00.000Z',
    });
  });

  it('writes both weeks and only the current week feedback to a file named for the window', async () => {
    const { outPath } = await run();
    expect(path.basename(outPath)).toBe('weekly-usage-production-2026-10-09-to-2026-10-15.json');
    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.current).toMatchObject({ startDate: '2026-10-09', endDate: '2026-10-15' });
    expect(written.current.kpiSummary.marker).toBe('2026-10-09T00:00:00.000Z');
    expect(written.previous).toMatchObject({ startDate: '2026-10-02', endDate: '2026-10-08' });
    expect(written.feedbackDetails).toEqual([{ startISO: '2026-10-09T00:00:00.000Z' }]);
  });

  it('rejects without writing when building data fails', async () => {
    buildReportData.mockRejectedValue(new Error('status 403'));
    await expect(run()).rejects.toThrow('status 403');
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });
});
