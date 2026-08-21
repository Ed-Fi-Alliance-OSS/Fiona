import { describe, expect, it } from '@jest/globals';
import { formatFeedbackSection, formatLongitudinalReport, formatWeeklyReport } from '../../lib/slack-formatter.js';

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

  it('appends the report link line when reportUrl is present', () => {
    const message = formatWeeklyReport({
      ...baseKpis,
      reportUrl: 'https://fionastorage.blob.core.windows.net/usage-reports/executive-report-production.pdf?sas=abc',
    });
    expect(message).toContain(
      '📎 *Full executive report:* https://fionastorage.blob.core.windows.net/usage-reports/executive-report-production.pdf?sas=abc',
    );
  });

  it('omits the report link line when reportUrl is null', () => {
    const message = formatWeeklyReport({ ...baseKpis, reportUrl: null });
    expect(message).not.toContain('Full executive report');
  });

  it('omits the report link line when reportUrl is absent', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).not.toContain('Full executive report');
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

describe('formatLongitudinalReport', () => {
  const weekA = {
    weekStart: '2026-04-13',
    weekEnd: '2026-04-19',
    uniqueUsers: 1,
    sessions: 1,
    totalInteractions: 3,
    errors: 1,
    errorRate: 33.333,
    rateLimited: 0,
    goodFeedback: 1,
    badFeedback: 0,
    feedbackRatio: 100,
    avgInteractionsPerUser: 2,
    feedbackResponseRate: 50,
    newUsers: 1,
    returningUsers: 0,
    repeatRate: 0,
    usersWowPct: null,
    interactionsWowPct: null,
    errorRateWowPp: null,
  };

  const weekB = {
    weekStart: '2026-04-20',
    weekEnd: '2026-04-26',
    uniqueUsers: 3,
    sessions: 3,
    totalInteractions: 3,
    errors: 0,
    errorRate: 0,
    rateLimited: 0,
    goodFeedback: 0,
    badFeedback: 1,
    feedbackRatio: 0,
    avgInteractionsPerUser: 1,
    feedbackResponseRate: 33.333,
    newUsers: 1,
    returningUsers: 2,
    repeatRate: 66.667,
    usersWowPct: 200,
    interactionsWowPct: 0,
    errorRateWowPp: -33.333,
  };

  const weekC = {
    weekStart: '2026-04-27',
    weekEnd: '2026-05-03',
    uniqueUsers: 5,
    sessions: 5,
    totalInteractions: 5,
    errors: 0,
    errorRate: 0,
    rateLimited: 0,
    goodFeedback: 0,
    badFeedback: 0,
    feedbackRatio: 0,
    avgInteractionsPerUser: 1,
    feedbackResponseRate: 0,
    newUsers: 5,
    returningUsers: 0,
    repeatRate: 0,
    usersWowPct: null, // previous week (weekB variant with 0 uniqueUsers) had no users to compare against
    interactionsWowPct: 66.667,
    errorRateWowPp: -10,
  };

  const options = { deploymentType: 'production', startDate: '2026-04-13', endDate: '2026-04-26' };

  it('includes a header with the date range and environment', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    expect(message).toContain('Longitudinal Usage Trends');
    expect(message).toContain('Apr 13–26, 2026');
    expect(message).toContain('production');
  });

  it('renders one block per week with its own week label', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    expect(message).toContain('Week of Apr 13–19, 2026');
    expect(message).toContain('Week of Apr 20–26, 2026');
  });

  it('includes new/returning users and repeat rate on the unique users line', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    expect(message).toContain('Unique users: 1 (🆕 1 new, 🔁 0 returning, 0.0% repeat rate)');
    expect(message).toContain('Unique users: 3 (🆕 1 new, 🔁 2 returning, 66.7% repeat rate)');
  });

  it('omits the WoW line for the first week and includes it for subsequent weeks', () => {
    const message = formatLongitudinalReport([weekA, weekB], options);
    const weekABlockEnd = message.indexOf('Week of Apr 20');
    const weekABlock = message.slice(0, weekABlockEnd);
    expect(weekABlock).not.toContain('WoW:');
    expect(message).toContain('WoW: +200.0% users, +0.0% interactions, -33.3pp error rate');
  });

  it('still renders the WoW line when only some WoW fields are null for a non-first week', () => {
    const message = formatLongitudinalReport([weekA, weekB, weekC], options);
    const weekCBlockStart = message.indexOf('Week of Apr 27');
    const weekCBlock = message.slice(weekCBlockStart);
    expect(weekCBlock).toContain('WoW:');
    expect(weekCBlock).toContain('N/A% users');
    expect(weekCBlock).toContain('+66.7% interactions');
    expect(weekCBlock).toContain('-10.0pp error rate');
  });

  it('shows a no-data message when the series is empty', () => {
    const message = formatLongitudinalReport([], options);
    expect(message).toContain('No interaction data recorded for this period.');
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
