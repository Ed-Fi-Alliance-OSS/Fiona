// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Validates required environment variables at startup.
 * Throws an Error with a descriptive message if any required variable is missing.
 */
export function validateStartupConfig() {
  if (process.env.LLM_PROVIDER === 'foundry' && !process.env.AZURE_AGENT_ID) {
    throw new Error('AZURE_AGENT_ID environment variable is required when LLM_PROVIDER=foundry');
  }
}
