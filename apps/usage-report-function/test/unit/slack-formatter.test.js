import { describe, expect, it } from '@jest/globals';
import { SEGMENTS_UNAVAILABLE_NOTE, segmentFootnote } from '../../lib/report-presentation.js';
import {
  formatFeedbackSection,
  formatLongitudinalReport,
  formatWeeklyReport,
  slackSafeText,
} from '../../lib/slack-formatter.js';

describe('formatWeeklyReport', () => {
  const baseKpis = {
    uniqueUsers: 42,
    sessions: 118,
    totalInteractions: 347,
    errors: 8,
    errorRate: 2.3,
    rateLimited: 6,
    goodFeedback: 29,
    badFeedback: 7,
    feedbackRatio: 80.6,
    avgInteractionsPerUser: 8.3,
    feedbackResponseRate: 9.8,
    newUsers: 15,
    newUserPct: 35.7,
    returningUsers: 27,
    repeatRate: 64.3,
    environment: 'production',
    startDate: '2026-03-10',
    endDate: '2026-03-16',
  };

  it('includes the report header', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('Fiona Usage Report');
  });

  it('compares internal and external KPIs and shows unclassified activity separately', () => {
    const segment = {
      uniqueUsers: 1,
      newUsers: 1,
      newUserPct: 100,
      returningUsers: 0,
      repeatRate: 0,
      sessions: 2,
      totalInteractions: 4,
      errors: 1,
      errorRate: 25,
      rateLimited: 0,
      goodFeedback: 1,
      badFeedback: 0,
      feedbackRatio: 100,
      avgInteractionsPerUser: 3,
      feedbackResponseRate: 33.33,
    };
    const message = formatWeeklyReport({
      ...baseKpis,
      segments: { internal: segment, external: segment, unknown: segment },
    });
    expect(message).toMatch(/Metric\s+Total\s+Internal\s+External\s+Unknown/);
    expect(message).toMatch(/Unique users\s+42\s+1\s+1\s+1/);
    expect(message).toMatch(/Interactions\s+347\s+4\s+4\s+4/);
    expect(message).toMatch(/Error rate\s+2\.3%\s+25\.0%\s+25\.0%\s+25\.0%/);
    expect(message).toMatch(/Feedback response\s+9\.8%\s+33\.3%\s+33\.3%\s+33\.3%/);
    expect(message).toMatch(/Avg per user\s+8\.3\s+3\.0/);
    expect(message).toContain(`_${segmentFootnote(true)} — = no data._`);
    expect(message).not.toContain('Internal (@ed-fi.org):');
  });

  it('lays the matrix out in an 18-character label column and 9-character value columns', () => {
    const segment = { ...baseKpis, uniqueUsers: 7 };
    const message = formatWeeklyReport({
      ...baseKpis,
      segments: {
        internal: segment,
        external: segment,
        unknown: {
          ...segment,
          uniqueUsers: 0,
          totalInteractions: 0,
          goodFeedback: 0,
          badFeedback: 0,
          feedbackTotal: 0,
        },
      },
    });
    const lines = message.split('\n');
    const header = lines.find((line) => line.startsWith('Metric'));
    expect(header).toBe(`${'Metric'.padEnd(18)}${'Total'.padEnd(9)}${'Internal'.padEnd(9)}External`);
    const usersRow = lines.find((line) => line.startsWith('Unique users'));
    expect(usersRow).toBe(`${'Unique users'.padEnd(18)}${'42'.padEnd(9)}${'7'.padEnd(9)}7`);
    expect(
      Math.max(...lines.filter((l) => /^(Metric|Unique|Avg|Feedback response)/.test(l)).map((l) => l.length)),
    ).toBeLessThanOrEqual(18 + 4 * 9);
  });

  it('renders null rates as an em dash in the segment matrix', () => {
    const noRatings = {
      uniqueUsers: 2,
      newUsers: 0,
      newUserPct: 0,
      returningUsers: 2,
      repeatRate: 100,
      sessions: 2,
      totalInteractions: 3,
      avgInteractionsPerUser: 1.5,
      errors: 0,
      errorRate: 0,
      rateLimited: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackTotal: 0,
      feedbackRatio: null,
      feedbackResponseRate: 0,
    };
    const message = formatWeeklyReport({
      ...baseKpis,
      segments: {
        internal: noRatings,
        external: noRatings,
        unknown: { ...noRatings, uniqueUsers: 0, totalInteractions: 0 },
      },
    });
    expect(message).toMatch(/Positive feedback\s+80\.6%\s+—\s+—/);
    expect(message).not.toContain('null');
    expect(message).toContain(`_${segmentFootnote(false)} — = no data._`);
  });

  it('adds a visible note when segments are unavailable', () => {
    const message = formatWeeklyReport({ ...baseKpis, segments: null, segmentsUnavailable: true });
    expect(message).toContain(`⚠️ _${SEGMENTS_UNAVAILABLE_NOTE}_`);
    expect(message).toContain('Unique users:           42');
    expect(message).not.toContain('Usage by user segment');
  });

  it('omits the unavailable note when segments were not requested', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).not.toContain(SEGMENTS_UNAVAILABLE_NOTE);
  });

  it('uses just Internal, External and Total columns when no activity is unclassified', () => {
    const empty = {
      uniqueUsers: 0,
      newUsers: 0,
      newUserPct: 0,
      returningUsers: 0,
      repeatRate: 0,
      sessions: 0,
      totalInteractions: 0,
      errors: 0,
      errorRate: 0,
      rateLimited: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackRatio: 0,
      avgInteractionsPerUser: 0,
      feedbackResponseRate: 0,
    };
    const message = formatWeeklyReport({
      ...baseKpis,
      segments: { internal: empty, external: empty, unknown: empty },
    });
    expect(message).toMatch(/Metric\s+Total\s+Internal\s+External\s*$/m);
    expect(message).not.toMatch(/Metric.*Unknown/);
    expect(message).toMatch(/New users\s+15\s+0\s+0/);
  });

  it('formats the week label correctly', () => {
    const message = formatWeeklyReport(baseKpis);
    expect(message).toContain('Week of Mar 10–16, 2026 (UTC)');
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
      uniqueUsers: 0,
      sessions: 0,
      totalInteractions: 0,
      errors: 0,
      errorRate: 0,
      rateLimited: 0,
      goodFeedback: 0,
      badFeedback: 0,
      feedbackRatio: 0,
      avgInteractionsPerUser: 0,
      feedbackResponseRate: 0,
      newUsers: 0,
      newUserPct: 0,
      returningUsers: 0,
      repeatRate: 0,
      environment: 'insiders',
      startDate: '2026-03-10',
      endDate: '2026-03-16',
    };
    const message = formatWeeklyReport(zeroKpis);
    expect(message).toContain('0.0%');
    expect(message).toContain('insiders');
  });

  it('renders null rates as an em dash in the unsegmented format', () => {
    const message = formatWeeklyReport({
      ...baseKpis,
      uniqueUsers: 0,
      newUsers: 0,
      returningUsers: 0,
      newUserPct: null,
      repeatRate: null,
      totalInteractions: 0,
      errorRate: null,
      feedbackRatio: null,
      avgInteractionsPerUser: null,
      feedbackResponseRate: null,
    });
    expect(message).toContain('0 (🔁 0 returning, — repeat rate)');
    expect(message).toContain('(— of unique users)');
    expect(message).toContain('(— error rate)');
    expect(message).toContain('Feedback ratio:         — positive');
    expect(message).toContain('Avg interactions/user:  —');
    expect(message).toContain('Feedback response rate: —');
    expect(message).not.toContain('null');
  });

  it('caps the message length by dropping trailing feedback items', () => {
    const long = 'y'.repeat(400);
    const representativeFeedback = Array.from({ length: 12 }, (_, i) => ({
      userMessage: `${i}-${long}`,
      botResponse: long,
      value: 'good-feedback',
      reason: long,
      hasReason: true,
    }));
    const message = formatWeeklyReport({ ...baseKpis, representativeFeedback });
    expect(message.length).toBeLessThanOrEqual(3900);
    expect(message).toContain('1. 👍 Positive');
    expect(message).not.toContain('12. 👍 Positive');
  });

  it('keeps every feedback item when the message is short enough', () => {
    const representativeFeedback = [1, 2, 3].map((n) => ({
      userMessage: `Q${n}`,
      botResponse: `A${n}`,
      value: 'bad-feedback',
      reason: null,
      hasReason: false,
    }));
    const message = formatWeeklyReport({ ...baseKpis, representativeFeedback });
    expect(message).toContain('3. 👎 Negative');
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

  it('truncates question, response, and reason to 110 characters', () => {
    const long = 'x'.repeat(200);
    const section = formatFeedbackSection([
      { userMessage: long, botResponse: long, value: 'good-feedback', reason: long, hasReason: true },
    ]);
    const truncated = `${'x'.repeat(110)}…`;
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
    uniqueUsers: 42,
    sessions: 118,
    totalInteractions: 347,
    errors: 8,
    errorRate: 2.3,
    rateLimited: 6,
    goodFeedback: 29,
    badFeedback: 7,
    feedbackRatio: 80.6,
    avgInteractionsPerUser: 8.3,
    feedbackResponseRate: 9.8,
    newUsers: 15,
    newUserPct: 35.7,
    returningUsers: 27,
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
    expect(message).toContain('Apr 13–26, 2026 (UTC)');
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

  it('renders null rates as an em dash', () => {
    const emptyWeek = {
      ...weekA,
      uniqueUsers: 0,
      newUsers: 0,
      returningUsers: 0,
      repeatRate: null,
      errorRate: null,
      feedbackRatio: null,
      avgInteractionsPerUser: null,
      feedbackResponseRate: null,
    };
    const message = formatLongitudinalReport([emptyWeek], options);
    expect(message).toContain('— repeat rate');
    expect(message).toContain('(— error rate)');
    expect(message).toContain('(— positive)');
    expect(message).toContain('Avg interactions/user: —');
    expect(message).toContain('Feedback response rate: —');
    expect(message).not.toContain('null');
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

  it('truncates question, response, and reason to 110 characters', () => {
    const long = 'x'.repeat(200);
    const section = formatFeedbackSection([
      { userMessage: long, botResponse: long, value: 'good-feedback', reason: long, hasReason: true },
    ]);
    const truncated = `${'x'.repeat(110)}…`;
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
    uniqueUsers: 42,
    sessions: 118,
    totalInteractions: 347,
    errors: 8,
    errorRate: 2.3,
    rateLimited: 6,
    goodFeedback: 29,
    badFeedback: 7,
    feedbackRatio: 80.6,
    avgInteractionsPerUser: 8.3,
    feedbackResponseRate: 9.8,
    newUsers: 15,
    newUserPct: 35.7,
    returningUsers: 27,
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

describe('slackSafeText', () => {
  it.each([
    ['<!channel> please read', '&lt;!channel&gt; please read'],
    ['<!here>', '&lt;!here&gt;'],
    ['ask <@U123ABC>', 'ask &lt;@U123ABC&gt;'],
    ['<!subteam^S123>', '&lt;!subteam^S123&gt;'],
    ['<https://evil.example|Click here>', '&lt;https://evil.example|Click here&gt;'],
    ['Q&A', 'Q&amp;A'],
    ['already &lt; escaped', 'already &amp;lt; escaped'],
  ])('neutralizes Slack control sequences in %j', (input, expected) => {
    expect(slackSafeText(input)).toBe(expected);
  });

  it('collapses line breaks so stored text cannot fake extra report lines', () => {
    expect(slackSafeText('first\n2. 👍 Positive\r\n   Q: spoofed')).toBe('first 2. 👍 Positive Q: spoofed');
  });

  it('truncates before escaping so an entity is never cut in half', () => {
    const result = slackSafeText(`${'a'.repeat(108)}<<<<`);
    expect(result).toBe(`${'a'.repeat(108)}&lt;&lt;…`);
  });

  it('returns an empty string for missing or non-string values', () => {
    expect(slackSafeText(null)).toBe('');
    expect(slackSafeText(undefined)).toBe('');
    expect(slackSafeText(42)).toBe('');
  });
});

describe('formatWeeklyReport escapes stored feedback text', () => {
  it('never emits a raw Slack mention or link from the question, answer or reason', () => {
    const message = formatFeedbackSection([
      {
        value: 'bad-feedback',
        userMessage: '<!channel> urgent',
        botResponse: 'see <https://evil.example|docs> or ask <@U999>',
        reason: '<!here> wrong & unhelpful',
        hasReason: true,
      },
    ]);
    expect(message).not.toMatch(/<[!@#]|<https?:/);
    expect(message).toContain('Q: &lt;!channel&gt; urgent');
    expect(message).toContain('A: see &lt;https://evil.example|docs&gt; or ask &lt;@U999&gt;');
    expect(message).toContain('Reason: &lt;!here&gt; wrong &amp; unhelpful');
  });
});

describe('formatWeeklyReport length cap', () => {
  const baseKpis = {
    uniqueUsers: 1,
    newUsers: 0,
    newUserPct: 0,
    returningUsers: 1,
    repeatRate: 100,
    sessions: 1,
    totalInteractions: 1,
    errors: 0,
    errorRate: 0,
    rateLimited: 0,
    goodFeedback: 1,
    badFeedback: 0,
    feedbackRatio: 100,
    avgInteractionsPerUser: 1,
    feedbackResponseRate: 100,
    environment: 'production',
    startDate: '2026-10-02',
    endDate: '2026-10-08',
    segments: null,
  };
  const feedbackItem = {
    value: 'good-feedback',
    userMessage: 'question',
    botResponse: 'answer',
    reason: 'reason',
    hasReason: true,
  };

  it('says feedback was omitted, not that none was recorded, when every item has to be dropped', () => {
    const longItem = { ...feedbackItem, userMessage: 'q'.repeat(200), botResponse: 'a'.repeat(200) };
    const withoutUrl = formatWeeklyReport({ ...baseKpis, reportUrl: null, representativeFeedback: [] });
    // Size the URL so the head fits but the head plus even one item does not.
    const reportUrl = `https://example.com/${'x'.repeat(3750 - withoutUrl.length)}`;

    const message = formatWeeklyReport({ ...baseKpis, reportUrl, representativeFeedback: [longItem] });

    expect(message.length).toBeLessThanOrEqual(3900);
    expect(message).toContain(reportUrl);
    expect(message).toContain("Omitted to fit Slack's message limit");
    expect(message).not.toContain('No feedback recorded for this period.');
  });

  it('still reports no feedback when there genuinely was none', () => {
    const message = formatWeeklyReport({ ...baseKpis, reportUrl: null, representativeFeedback: [] });
    expect(message).toContain('No feedback recorded for this period.');
  });

  it('hard-caps the message when the head alone exceeds the limit', () => {
    const message = formatWeeklyReport({
      ...baseKpis,
      reportUrl: `https://example.com/${'x'.repeat(5000)}`,
      representativeFeedback: [],
    });

    expect(message.length).toBe(3900);
    expect(message.endsWith('…')).toBe(true);
  });
});
