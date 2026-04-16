// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('@azure/keyvault-secrets', () => ({
  SecretClient: jest.fn(),
}));
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

process.env.KEY_VAULT_URL = 'https://test.vault.azure.net';

const { getSlackWebhookUrl } = await import('../../lib/key-vault-client.js');
const { SecretClient } = await import('@azure/keyvault-secrets');

describe('getSlackWebhookUrl', () => {
  afterEach(() => {
    SecretClient.mockClear();
  });

  it('returns the secret value from Key Vault', async () => {
    const mockGetSecret = jest.fn().mockResolvedValue({ value: 'https://hooks.slack.com/test' });
    SecretClient.mockImplementation(() => ({ getSecret: mockGetSecret }));

    const logger = { error: jest.fn() };
    const result = await getSlackWebhookUrl('my-webhook-secret', logger);

    expect(result).toBe('https://hooks.slack.com/test');
  });

  it('creates SecretClient with the configured vault URL', async () => {
    const mockGetSecret = jest.fn().mockResolvedValue({ value: 'webhook-url' });
    SecretClient.mockImplementation(() => ({ getSecret: mockGetSecret }));

    const logger = { error: jest.fn() };
    await getSlackWebhookUrl('my-webhook-secret', logger);

    expect(SecretClient).toHaveBeenCalledWith('https://test.vault.azure.net', expect.any(Object));
  });

  it('fetches the secret by the provided secret name', async () => {
    const mockGetSecret = jest.fn().mockResolvedValue({ value: 'webhook-url' });
    SecretClient.mockImplementation(() => ({ getSecret: mockGetSecret }));

    const logger = { error: jest.fn() };
    await getSlackWebhookUrl('slack-webhook-prod', logger);

    expect(mockGetSecret).toHaveBeenCalledWith('slack-webhook-prod');
  });

  it('propagates errors thrown by Key Vault', async () => {
    const mockGetSecret = jest.fn().mockRejectedValue(new Error('Access denied'));
    SecretClient.mockImplementation(() => ({ getSecret: mockGetSecret }));

    const logger = { error: jest.fn() };
    await expect(getSlackWebhookUrl('my-webhook-secret', logger)).rejects.toThrow('Access denied');
  });
});
