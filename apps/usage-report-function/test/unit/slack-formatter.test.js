import { describe, expect, it } from '@jest/globals';
import { formatFeedbackSection, formatWeeklyReport } from '../../lib/slack-formatter.js';

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
    newUsersCount: 15,
    newUserPercentage: 35.7,
    returningUsersCount: 27,
    repeatRate: 64.3,
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

  it('includes new users count and percentage with one decimal place', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('New users:              15 (35.7% of unique users)');
  });

  it('includes returning users count and repeat rate combined with unique users', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('Unique users:           42 (🔁 27 returning, 64.3% repeat rate)');
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
      newUsersCount: 0,
      newUserPercentage: 0,
      returningUsersCount: 0,
      repeatRate: 0,
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

describe('formatFeedbackSection', () => {
  it('shows a fallback message when there is no feedback', () => {
    const section = formatFeedbackSection([]);
    expect(section).toContain('No feedback recorded for this period.');
  });

  it('renders positive sentiment for good-feedback', () => {
    const section = formatFeedbackSection([
      {
        userMessage: 'How do I reset my password?',
        botResponse: 'Go to settings.',
        value: 'good-feedback',
        reason: 'Clear and fast',
        hasReason: true,
      },
    ]);
    expect(section).toContain('👍 Positive');
    expect(section).toContain('Q: How do I reset my password?');
    expect(section).toContain('A: Go to settings.');
    expect(section).toContain('Reason: Clear and fast');
  });

  it('renders negative sentiment for bad-feedback', () => {
    const section = formatFeedbackSection([
      {
        userMessage: 'Why did this fail?',
        botResponse: 'Unclear error.',
        value: 'bad-feedback',
        reason: null,
        hasReason: false,
      },
    ]);
    expect(section).toContain('👎 Negative');
  });

  it('flags fallback items with no reason provided', () => {
    const section = formatFeedbackSection([
      { userMessage: 'q', botResponse: 'a', value: 'good-feedback', reason: null, hasReason: false },
    ]);
    expect(section).toContain('Reason: (no reason provided)');
  });

  it('truncates question, response, and reason to 150 characters', () => {
    const long = 'x'.repeat(200);
    const section = formatFeedbackSection([
      { userMessage: long, botResponse: long, value: 'good-feedback', reason: long, hasReason: true },
    ]);
    const truncated = `${'x'.repeat(150)}…`;
    expect(section).toContain(`Q: ${truncated}`);
    expect(section).toContain(`A: ${truncated}`);
    expect(section).toContain(`Reason: ${truncated}`);
  });

  it('numbers multiple items in order', () => {
    const section = formatFeedbackSection([
      { userMessage: 'first', botResponse: 'r1', value: 'good-feedback', reason: 'r', hasReason: true },
      { userMessage: 'second', botResponse: 'r2', value: 'bad-feedback', reason: null, hasReason: false },
    ]);
    expect(section).toContain('1. 👍 Positive');
    expect(section).toContain('2. 👎 Negative');
  });
});

describe('formatWeeklyReport with representativeFeedback', () => {
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
    newUsersCount: 15,
    newUserPercentage: 35.7,
    returningUsersCount: 27,
    repeatRate: 64.3,
    environment: 'production',
    startDate: '2026-03-10',
    endDate: '2026-03-16',
  };

  it('appends the representative feedback section', () => {
    const message = formatWeeklyReport({
      ...baseKpis,
      representativeFeedback: [
        {
          userMessage: 'How do I do X?',
          botResponse: 'Here is how.',
          value: 'good-feedback',
          reason: 'Helpful',
          hasReason: true,
        },
      ],
    });
    expect(message).toContain('Representative Feedback');
    expect(message).toContain('How do I do X?');
  });

  it('shows the no-feedback message when representativeFeedback is empty', () => {
    const message = formatWeeklyReport({ ...baseKpis, representativeFeedback: [] });
    expect(message).toContain('No feedback recorded for this period.');
  });
});
