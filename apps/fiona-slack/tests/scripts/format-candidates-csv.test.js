// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect } from '@jest/globals';
import { formatCsv } from '../../scripts/format-candidates-csv.js';

const base = {
  id: 'U1_ts1_ts2',
  userMessage: 'How do descriptors work?',
  botResponse: 'Descriptors are controlled vocabularies.',
  slackUrl: 'https://ed-fi-alliance.slack.com/archives/C123/p17830000000000',
  sources: [{ url: 'https://docs.ed-fi.org/desc', title: 'Descriptors', hostname: 'docs.ed-fi.org' }],
  topic: 'Descriptors',
  hasBadFeedback: false,
  selected: true,
};

const HEADER = 'User question,Fiona response,Thread link,Sources,Topic,Bad feedback,Assigned SME,Accuracy score,Helpfulness score,Correction needed,Corrected response,Gap category,Notes,Status';

describe('formatCsv', () => {
  it('returns only header row for empty input', () => {
    expect(formatCsv([])).toBe(HEADER);
  });

  it('omits records where selected is false', () => {
    const lines = formatCsv([{ ...base, selected: false }]).split('\n');
    expect(lines).toHaveLength(1);
  });

  it('writes one data row per selected record', () => {
    const lines = formatCsv([base]).split('\n');
    expect(lines).toHaveLength(2);
  });

  it('places Status=Pending and empty SME/score columns', () => {
    const row = formatCsv([base]).split('\n')[1];
    expect(row).toContain('Pending');
    // 8 empty fields: Assigned SME, Accuracy, Helpfulness, Correction needed,
    // Corrected response, Gap category, Notes (all empty before Status)
    const fields = row.match(/,/g)?.length ?? 0;
    expect(fields).toBe(13); // 14 columns = 13 commas (unquoted row)
  });

  it('sets Bad feedback to Yes for hasBadFeedback true', () => {
    const row = formatCsv([{ ...base, hasBadFeedback: true }]).split('\n')[1];
    expect(row).toContain(',Yes,');
  });

  it('joins multiple sources with newline inside quoted field', () => {
    const candidate = {
      ...base,
      sources: [
        { url: 'https://docs.ed-fi.org/a', title: 'A', hostname: 'docs.ed-fi.org' },
        { url: 'https://docs.ed-fi.org/b', title: 'B', hostname: 'docs.ed-fi.org' },
      ],
    };
    const csv = formatCsv([candidate]);
    expect(csv).toContain('"https://docs.ed-fi.org/a\nhttps://docs.ed-fi.org/b"');
  });

  it('escapes double quotes in field values', () => {
    const csv = formatCsv([{ ...base, userMessage: 'What is "LEA"?' }]);
    expect(csv).toContain('"What is ""LEA""?"');
  });

  it('wraps fields containing commas in quotes', () => {
    const csv = formatCsv([{ ...base, topic: 'Student, Assessment' }]);
    expect(csv).toContain('"Student, Assessment"');
  });

  it('handles null/undefined sources gracefully', () => {
    expect(() => formatCsv([{ ...base, sources: null }])).not.toThrow();
    expect(() => formatCsv([{ ...base, sources: undefined }])).not.toThrow();
  });
});
