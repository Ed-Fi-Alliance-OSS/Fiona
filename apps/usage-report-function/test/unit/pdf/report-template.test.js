// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { renderCoverPage } from '../../../lib/pdf/report-template.js';

const kpiSummary = {
  totalInteractions: 437,
  uniqueUsers: 32,
  totalSessions: 110,
  avgInteractionsPerUser: 13.3,
  errorRate: 2.7,
  rateLimitedEvents: 0,
  goodFeedback: 30,
  badFeedback: 7,
  positiveFeedbackPct: 82.2,
};
const readoutBullets = ['Engagement bullet.', 'Reliability bullet.', 'Feedback bullet.'];
const period = {
  deploymentType: 'production',
  startISO: '2026-03-18T00:00:00.000Z',
  endISO: '2026-07-10T00:00:00.000Z',
};

describe('renderCoverPage', () => {
  it('renders all 6 KPI card values', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    expect(html).toContain('437');
    expect(html).toContain('32');
    expect(html).toContain('110');
    expect(html).toContain('13.3');
    expect(html).toContain('2.7%');
    expect(html).toContain('82.2%');
  });

  it('renders every readout bullet', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    for (const bullet of readoutBullets) {
      expect(html).toContain(bullet);
    }
  });

  it('renders the period and environment', () => {
    const html = renderCoverPage(kpiSummary, readoutBullets, period);
    expect(html).toContain('2026-03-18');
    expect(html).toContain('2026-07-10');
    expect(html).toContain('production');
  });
});
