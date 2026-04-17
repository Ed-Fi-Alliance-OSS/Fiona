// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Validates required environment variables at startup.
 * Throws an Error with a descriptive message if any required variable is missing.
 */
export function validateAzureAgentId(id) {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!value) {
    throw new Error('AZURE_AGENT_ID environment variable is required when using the Foundry provider.');
  }

  const [name, version, ...extra] = value.split(':');
  if (extra.length > 0) {
    throw new Error('AZURE_AGENT_ID must be in the form "name" or "name:version" where version is numeric or semver.');
  }

  const namePattern = /^[A-Za-z0-9_-]+$/;
  if (!name || !namePattern.test(name)) {
    throw new Error('AZURE_AGENT_ID name must contain only letters, numbers, hyphens, or underscores.');
  }

  if (version !== undefined) {
    const versionPattern = /^(?:\d+|\d+\.\d+|\d+\.\d+\.\d+)$/;
    if (!versionPattern.test(version)) {
      throw new Error('AZURE_AGENT_ID version must be numeric or semver-like (for example: 1, 1.0, 1.0.0).');
    }
  }

  return value;
}

export function validateStartupConfig() {
  const providerFromEnv = process.env.LLM_PROVIDER;
  const isFoundryProvider = providerFromEnv === 'foundry' || (!providerFromEnv && !!process.env.AZURE_PROJECT_ENDPOINT);

  if (isFoundryProvider) {
    validateAzureAgentId(process.env.AZURE_AGENT_ID);
  }
}
