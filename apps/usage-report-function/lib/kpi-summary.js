// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { loadActivity } from './activity-records.js';
import { summarizeActivity } from './kpi-core.js';

/**
 * Returns whole-window KPI totals for [startISO, endISO); see kpi-core.js
 * for the definitions. Pass `usersContainer` to also get internal/external
 * `segments`. If the directory can't be read, `segments` is null,
 * `segmentsUnavailable` is true, and the totals still return.
 */
export async function getKpiSummary(
  interactionsContainer,
  feedbackContainer,
  deploymentType,
  startISO,
  endISO,
  { usersContainer, warn } = {},
) {
  const { activity, directory, segmentsUnavailable } = await loadActivity(
    interactionsContainer,
    feedbackContainer,
    deploymentType,
    startISO,
    endISO,
    { usersContainer, warn },
  );
  return { ...summarizeActivity(activity, directory), segmentsUnavailable };
}
