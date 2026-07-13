// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { generateExecutiveReportPdf } from '../../../lib/pdf/generate-executive-report-pdf.js';

describe('generateExecutiveReportPdf', () => {
  let tmpFile;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it('writes a non-empty multi-page PDF file for a full report data bundle', async () => {
    tmpFile = path.join(os.tmpdir(), `executive-report-narrative-test-${Date.now()}.pdf`);

    const reportData = {
      period: {
        deploymentType: 'production',
        startISO: '2026-04-13T00:00:00.000Z',
        endISO: '2026-04-20T00:00:00.000Z',
      },
      kpiSummary: {
        totalInteractions: 296,
        uniqueUsers: 30,
        totalSessions: 72,
        avgInteractionsPerUser: 9.9,
        errorRate: 2.4,
        rateLimitedEvents: 0,
        goodFeedback: 33,
        badFeedback: 7,
        positiveFeedbackPct: 82.5,
      },
      weeklyTrend: [
        {
          weekStart: '2026-04-13',
          weekEnd: '2026-04-19',
          uniqueUsers: 4,
          sessions: 4,
          totalInteractions: 6,
          errors: 0,
          errorRate: 0,
          goodFeedback: 1,
          badFeedback: 2,
          feedbackRatio: 33.3,
          avgInteractionsPerUser: 1.5,
          newUsers: 4,
          returningUsers: 0,
          repeatRate: 0,
        },
      ],
      dailySummary: [
        {
          date: '2026-04-16',
          uniqueUsers: 2,
          sessions: 2,
          totalInteractions: 3,
          errors: 0,
          rateLimited: 0,
          errorRate: 0,
          newUsers: 2,
          returningUsers: 0,
        },
      ],
      representativeFeedback: [
        {
          userMessage: 'What are the required fields?',
          botResponse: 'The required fields are studentUniqueId, firstName, lastSurname.',
          value: 'good-feedback',
          reason: null,
          timestamp: '2026-04-16T13:47:00.000Z',
          hasReason: false,
        },
      ],
      topUsersByFeedback: [
        {
          userId: 'U1',
          feedbackCount: 3,
          goodFeedback: 3,
          badFeedback: 0,
          lastFeedback: '2026-04-16T13:47:00.000Z',
          positiveRatioPct: 100,
        },
      ],
      topUsersByInteractions: [
        {
          userId: 'U1',
          interactions: 20,
          sessions: 4,
          errors: 0,
          errorRate: 0,
          avgPerSession: 5,
          firstSeen: '2026-04-16T00:00:00.000Z',
          lastSeen: '2026-04-19T00:00:00.000Z',
        },
      ],
    };

    const result = await generateExecutiveReportPdf(reportData, tmpFile);

    expect(result).toBe(tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(true);
    const stats = fs.statSync(tmpFile);
    expect(stats.size).toBeGreaterThan(1000);

    const header = fs.readFileSync(tmpFile, { encoding: 'latin1', flag: 'r' }).slice(0, 5);
    expect(header).toBe('%PDF-');
  }, 30000);
});
