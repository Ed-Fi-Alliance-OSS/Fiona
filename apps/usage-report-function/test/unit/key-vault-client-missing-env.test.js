// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';

describe('getSlackWebhookUrl when KEY_VAULT_URL is not set', () => {
  it('throws an error and logs it', async () => {
    delete process.env.KEY_VAULT_URL;
    const { getSlackWebhookUrl } = await import('../../lib/key-vault-client.js');

    const logger = { error: jest.fn() };
    await expect(getSlackWebhookUrl('my-secret', logger)).rejects.toThrow(
      'KEY_VAULT_URL environment variable is not set',
    );
    expect(logger.error).toHaveBeenCalledWith('KEY_VAULT_URL environment variable is not set');
  });
});
