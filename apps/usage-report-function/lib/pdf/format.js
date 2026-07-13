// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const MONTH_ABBR = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** Formats a Monday-Sunday week range as e.g. "Apr 13-19, 2026" or "Apr 27-May 3, 2026". */
export function formatWeekLabel(weekStartISO, weekEndISO) {
  const start = new Date(`${weekStartISO}T00:00:00.000Z`);
  const end = new Date(`${weekEndISO}T00:00:00.000Z`);
  const startMonth = MONTH_ABBR.format(start);
  const endMonth = MONTH_ABBR.format(end);
  const year = end.getUTCFullYear();

  return startMonth === endMonth
    ? `${startMonth} ${start.getUTCDate()}-${end.getUTCDate()}, ${year}`
    : `${startMonth} ${start.getUTCDate()}-${endMonth} ${end.getUTCDate()}, ${year}`;
}

/** Formats an ISO timestamp as "YYYY-MM-DD HH:MM" in UTC. */
export function formatCompactTimestamp(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
