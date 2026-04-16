import { describe, expect, it } from '@jest/globals';
import { formatWeeklyReport } from '../../lib/slack-formatter.js';

describe('formatWeeklyReport', () => {
  const baseKpis = {
    distinctUsers: 42,
    sessionCount: 118,
    totalInteractions: 347,
    errorCount: 8,
    errorRate: 2.3,
    rateLimitedCount: 6,
    goodFeedback: 29,
    badFeedback: 7,
    feedbackRatio: 80.6,
    avgInteractionsPerUser: 8.3,
    feedbackResponseRate: 9.8,
    environment: 'production',
    startDate: '2026-03-10',
    endDate: '2026-03-16',
  };

  it('includes the report header', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('Fiona Usage Report');
  });

  it('formats the week label correctly', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('Week of Mar 10–16, 2026');
  });

  it('includes all KPI values', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('42');
    expect(message).toContain('118');
    expect(message).toContain('347');
    expect(message).toContain('8');
    expect(message).toContain('6');
    expect(message).toContain('29');
    expect(message).toContain('7');
  });

  it('includes error rate with one decimal place', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('2.3%');
  });

  it('includes feedback ratio with one decimal place', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('80.6%');
  });

  it('includes avg interactions per user with one decimal place', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('8.3');
  });

  it('includes feedback response rate with one decimal place', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('9.8%');
  });

  it('includes the environment in the footer', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('production');
  });

  it('formats zero values without errors', () => {
    const zeroKpis = {
      distinctUsers: 0,
      sessionCount: 0,
      totalInteractions: 0,
      errorCount: 0,
      errorRate: 0,
      rateLimitedCount: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackRatio: 0,
      avgInteractionsPerUser: 0,
      feedbackResponseRate: 0,
      environment: 'insiders',
      startDate: '2026-03-10',
      endDate: '2026-03-16',
    };
    const message = formatWeeklyReport(zeroKpis);
    expect(message).toContain('0.0%');
    expect(message).toContain('insiders');
  });

  it('handles month boundary correctly when start and end months differ', () => {
    const crossMonthKpis = {
      ...baseKpis,
      startDate: '2026-03-30',
      endDate: '2026-04-05',
    };
    const message = formatWeeklyReport(crossMonthKpis);
    expect(message).toContain('Mar 30–Apr 5, 2026');
  });

  it('handles year boundary correctly when start and end years differ', () => {
    const crossYearKpis = {
      ...baseKpis,
      startDate: '2025-12-29',
      endDate: '2026-01-04',
    };
    const message = formatWeeklyReport(crossYearKpis);
    expect(message).toContain('Dec 29–Jan 4, 2026');
  });
});
