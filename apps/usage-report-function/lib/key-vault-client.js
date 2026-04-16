// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

const KEY_VAULT_URL = process.env.KEY_VAULT_URL;

/**
 * Retrieves the Slack webhook URL from Azure Key Vault.
 *
 * @param {string} secretName - Name of the Key Vault secret holding the webhook URL.
 * @param {Object} logger - Logger object with an `error` method.
 * @returns {Promise<string>} The Slack webhook URL.
 */
export async function getSlackWebhookUrl(secretName, logger) {
  if (!KEY_VAULT_URL) {
    const msg = 'KEY_VAULT_URL environment variable is not set';
    logger.error(msg);
    throw new Error(msg);
  }

  const credential = new DefaultAzureCredential();
  const client = new SecretClient(KEY_VAULT_URL, credential);
  const secret = await client.getSecret(secretName);
  return secret.value;
}
