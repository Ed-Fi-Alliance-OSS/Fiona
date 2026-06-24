// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { createSign } from 'node:crypto';

/**
 * Encodes a string or Buffer as base64url (no padding, URL-safe characters).
 * @param {string|Buffer} input
 * @returns {string}
 */
function base64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generates a GitHub App JWT signed with RS256.
 * Claims: iat (now - 60s), exp (now + 10 min), iss = App ID.
 *
 * @returns {string} Signed JWT string
 * @throws {Error} If the private key is malformed or signing fails
 */
function generateAppJwt() {
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const appId = process.env.GITHUB_APP_ID;

  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: nowSec - 60,
      exp: nowSec + 600,
      iss: appId,
    }),
  );

  const signingInput = `${header}.${payload}`;

  try {
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = base64url(signer.sign(privateKey));
    return `${signingInput}.${signature}`;
  } catch (err) {
    throw new Error(
      `Failed to sign GitHub App JWT — check that GITHUB_APP_PRIVATE_KEY is a valid RSA private key. Original error: ${err.message}`,
    );
  }
}

/**
 * Common headers for all GitHub API requests.
 * @param {string} jwt
 * @returns {Record<string, string>}
 */
function githubHeaders(jwt) {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * In-memory cache: key is `${owner}/${repo}`, value is `{ token, expiresAt }`.
 * @type {Map<string, { token: string, expiresAt: number }>}
 */
const tokenCache = new Map();

/**
 * Returns true if the cached entry is still valid (more than 60s before expiry).
 * @param {{ token: string, expiresAt: number }} entry
 * @returns {boolean}
 */
function isCacheValid(entry) {
  const bufferMs = 60 * 1000;
  return Date.now() < entry.expiresAt - bufferMs;
}

/**
 * Resolves the GitHub App installation ID for a given repo.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} jwt
 * @returns {Promise<number>} Installation ID
 * @throws {Error} If the installation is not found (404) or the request fails
 */
async function getInstallationId(owner, repo, jwt) {
  const url = `https://api.github.com/repos/${owner}/${repo}/installation`;
  const response = await fetch(url, { headers: githubHeaders(jwt) });

  if (!response.ok) {
    throw new Error(
      `GitHub App installation not found for ${owner}/${repo} — status ${response.status}. ` +
        'Ensure the app is installed on this repository.',
    );
  }

  const data = await response.json();
  return data.id;
}

/**
 * Exchanges the app JWT for a short-lived installation access token.
 *
 * @param {number} installationId
 * @param {string} jwt
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
async function exchangeForInstallationToken(installationId, jwt) {
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
  const response = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(jwt),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to exchange installation access token for installation ${installationId} — status ${response.status}.`,
    );
  }

  const data = await response.json();
  return {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  };
}

/**
 * Returns a short-lived GitHub installation access token for the given repo.
 * Tokens are cached in memory and refreshed automatically when within 60s of expiry.
 *
 * Requires environment variables:
 *   - GITHUB_APP_PRIVATE_KEY: RSA private key (PEM) for the GitHub App
 *   - GITHUB_APP_ID: GitHub App ID (numeric string)
 *
 * @param {string} owner  GitHub org or user owning the repo
 * @param {string} repo   Repository name (without owner prefix)
 * @returns {Promise<string>} Short-lived installation access token
 */
export async function getInstallationToken(owner, repo) {
  const cacheKey = `${owner}/${repo}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && isCacheValid(cached)) {
    return cached.token;
  }

  // generateAppJwt throws if the key is malformed — let the error propagate
  const jwt = generateAppJwt();

  const installationId = await getInstallationId(owner, repo, jwt);
  const entry = await exchangeForInstallationToken(installationId, jwt);

  tokenCache.set(cacheKey, entry);
  return entry.token;
}
