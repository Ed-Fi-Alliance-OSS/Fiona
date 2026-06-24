// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Generate a real RSA keypair once for the entire test suite
const { privateKey, publicKey: _publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const APP_ID = '12345';
const OWNER = 'test-owner';
const REPO = 'test-repo';
const INSTALLATION_ID = 99;
const FAKE_TOKEN = 'ghs_faketoken123';

/**
 * Returns an expires_at string that is `secondsFromNow` seconds in the future.
 */
function expiresAt(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

/**
 * Builds a fresh module instance with its cache cleared by using resetModules + dynamic import.
 */
async function freshModule() {
  jest.resetModules();
  const mod = await import('../src/lib/github-client.js');
  return mod;
}

describe('getInstallationToken', () => {
  let originalFetch;
  let originalPrivKey;
  let originalAppId;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalPrivKey = process.env.GITHUB_APP_PRIVATE_KEY;
    originalAppId = process.env.GITHUB_APP_ID;

    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_APP_ID = APP_ID;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalPrivKey === undefined) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = originalPrivKey;
    }
    if (originalAppId === undefined) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = originalAppId;
    }
  });

  it('returns a token string when /installation and /access_tokens calls succeed', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: INSTALLATION_ID }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ token: FAKE_TOKEN, expires_at: expiresAt(3600) }),
      });

    const { getInstallationToken } = await freshModule();
    const token = await getInstallationToken(OWNER, REPO);

    expect(token).toBe(FAKE_TOKEN);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const [installationUrl] = globalThis.fetch.mock.calls[0];
    expect(installationUrl).toBe(`https://api.github.com/repos/${OWNER}/${REPO}/installation`);

    const [accessTokenUrl] = globalThis.fetch.mock.calls[1];
    expect(accessTokenUrl).toBe(`https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`);
  });

  it('caches the token: two calls within the validity window trigger fetch only once', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: INSTALLATION_ID }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ token: FAKE_TOKEN, expires_at: expiresAt(3600) }),
      });

    const { getInstallationToken } = await freshModule();

    const token1 = await getInstallationToken(OWNER, REPO);
    const token2 = await getInstallationToken(OWNER, REPO);

    expect(token1).toBe(FAKE_TOKEN);
    expect(token2).toBe(FAKE_TOKEN);
    // Both the /installation and /access_tokens calls happen only once
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes when the cached token is within 60s of expires_at', async () => {
    const nearlyExpiredAt = expiresAt(30); // expires in 30s, within the 60s buffer
    const freshToken = 'ghs_freshtoken456';
    const freshExpiry = expiresAt(3600);

    globalThis.fetch = jest
      .fn()
      // First call pair: installation lookup + token exchange (returns nearly-expired token)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: INSTALLATION_ID }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ token: FAKE_TOKEN, expires_at: nearlyExpiredAt }),
      })
      // Second call pair: token has expired within buffer, so a new exchange is made
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: INSTALLATION_ID }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ token: freshToken, expires_at: freshExpiry }),
      });

    const { getInstallationToken } = await freshModule();

    const token1 = await getInstallationToken(OWNER, REPO);
    expect(token1).toBe(FAKE_TOKEN);

    // Second call should detect the near-expiry and refresh
    const token2 = await getInstallationToken(OWNER, REPO);
    expect(token2).toBe(freshToken);

    // 4 fetch calls total: 2 for first token, 2 for refresh
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it('throws a descriptive error when the private key is malformed', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'not-a-valid-pem-key';

    // fetch should not be called at all
    globalThis.fetch = jest.fn();

    const { getInstallationToken } = await freshModule();

    await expect(getInstallationToken(OWNER, REPO)).rejects.toThrow(/private key|sign|key/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when the installation is not found (404)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not Found' }),
    });

    const { getInstallationToken } = await freshModule();

    await expect(getInstallationToken(OWNER, REPO)).rejects.toThrow(
      new RegExp(`${OWNER}/${REPO}|installation.*not found|404`, 'i'),
    );
  });
});
