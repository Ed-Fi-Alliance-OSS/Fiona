// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The last calendar day (YYYY-MM-DD, UTC) inside a half-open window ending at `endISO`. */
export function lastIncludedDate(endISO) {
  return new Date(Date.parse(endISO) - 1).toISOString().split('T')[0];
}
