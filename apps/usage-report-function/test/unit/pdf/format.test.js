// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it } from '@jest/globals';
import { formatCompactTimestamp, formatWeekLabel } from '../../../lib/pdf/format.js';

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
