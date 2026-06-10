// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Detect if the target Cosmos endpoint is a local emulator.
 * @param {string} [connectionString]
 * @param {string} [endpoint]
 * @returns {boolean}
 */
export function isEmulatorTarget(connectionString, endpoint) {
  const target = `${connectionString ?? ''} ${endpoint ?? ''}`.toLowerCase();
  return target.includes('localhost') || target.includes('127.0.0.1');
}
