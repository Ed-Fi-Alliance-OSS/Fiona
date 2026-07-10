// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  formatCompactTimestamp,
  formatWeekLabel,
  generateExecutiveReportPdf,
} from '../../../lib/pdf/executive-report-pdf.js';

describe('formatWeekLabel', () => {
  it('formats a week within the same month as "Mon D-D, YYYY"', () => {
    expect(formatWeekLabel('2026-04-13', '2026-04-19')).toBe('Apr 13-19, 2026');
  });

  it('formats a week spanning two months as "Mon D-Mon D, YYYY"', () => {
    expect(formatWeekLabel('2026-04-27', '2026-05-03')).toBe('Apr 27-May 3, 2026');
  });
});

describe('formatCompactTimestamp', () => {
  it('formats an ISO timestamp as "YYYY-MM-DD HH:MM" in UTC', () => {
    expect(formatCompactTimestamp('2026-06-11T13:47:32.000Z')).toBe('2026-06-11 13:47');
  });
});

describe('generateExecutiveReportPdf', () => {
  let tmpFile;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it('writes a non-empty PDF file for a full report data bundle', async () => {
    tmpFile = path.join(os.tmpdir(), `executive-report-test-${Date.now()}.pdf`);

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
          feedbackResponseRate: 75,
          usersWowPct: null,
          interactionsWowPct: null,
          errorRateWowPp: null,
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
        },
      ],
      feedbackDetails: [
        {
          timestamp: '2026-06-11T13:47:00.000Z',
          userId: 'UA0CMFN9G',
          value: 'good-feedback',
          userMessage: 'What are the required fields for the Student resource?',
          botResponse: 'For the Student resource...',
        },
      ],
      topUsersByFeedback: [
        {
          userId: 'UA0CMFN9G',
          feedbackCount: 11,
          goodFeedback: 9,
          badFeedback: 2,
          lastFeedback: '2026-06-11T13:47:00.000Z',
          positiveRatioPct: 81.8,
        },
      ],
      topUsersByInteractions: [
        {
          userId: 'U8MP4NTLG',
          interactions: 103,
          sessions: 14,
          errors: 2,
          errorRate: 1.9,
          avgPerSession: 7.4,
          firstSeen: '2026-04-17T08:17:00.000Z',
          lastSeen: '2026-05-20T14:17:00.000Z',
        },
      ],
    };

    await generateExecutiveReportPdf(reportData, tmpFile);

    expect(fs.existsSync(tmpFile)).toBe(true);
    const stats = fs.statSync(tmpFile);
    expect(stats.size).toBeGreaterThan(1000);

    const header = fs.readFileSync(tmpFile, { encoding: 'latin1', flag: 'r' }).slice(0, 5);
    expect(header).toBe('%PDF-');
  });

  it('does not throw when every data slice is empty', async () => {
    tmpFile = path.join(os.tmpdir(), `executive-report-empty-test-${Date.now()}.pdf`);

    const emptyReportData = {
      period: {
        deploymentType: 'production',
        startISO: '2026-04-13T00:00:00.000Z',
        endISO: '2026-04-20T00:00:00.000Z',
      },
      kpiSummary: {
        totalInteractions: 0,
        uniqueUsers: 0,
        totalSessions: 0,
        avgInteractionsPerUser: 0,
        errorRate: 0,
        rateLimitedEvents: 0,
        positiveFeedbackPct: 0,
      },
      weeklyTrend: [],
      dailySummary: [],
      feedbackDetails: [],
      topUsersByFeedback: [],
      topUsersByInteractions: [],
    };

    await expect(generateExecutiveReportPdf(emptyReportData, tmpFile)).resolves.toBe(tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(true);
  });
});
