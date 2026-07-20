// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import axios from 'axios';

const REQUIRED_VARS = ['GITHUB_REPO', 'GITHUB_TOKEN'];
const REQUEST_TIMEOUT_MS = 15000;
const API_VERSION = '2022-11-28';

/** True when the required GitHub env vars are present. */
export function isGithubConfigured() {
  return REQUIRED_VARS.every((name) => Boolean(process.env[name]));
}

function apiBaseUrl() {
  return (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
}

/**
 * Create a GitHub issue in the configured repo. Throws an Error with `.type` on failure.
 *
 * @param {{ title: string, bodyText: string, labels?: string[] }} input
 * @param {import("@slack/logger").Logger} [logger]
 * @returns {Promise<{ number: number, url: string }>}
 */
export async function createIssue({ title, bodyText, labels = [] }, logger) {
  const payload = { title, body: bodyText };
  if (labels.length) payload.labels = labels;

  try {
    const res = await axios.post(`${apiBaseUrl()}/repos/${process.env.GITHUB_REPO}/issues`, payload, {
      headers: headers(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    return { number: res.data?.number, url: res.data?.html_url };
  } catch (err) {
    const status = err.response?.status;
    const type = status === 401 || status === 403 ? 'github_auth_failed' : 'github_create_failed';
    // Never log the token/auth header; only status + message.
    logger?.error?.(`GitHub createIssue failed (status=${status ?? 'none'}): ${err.message}`);
    const wrapped = new Error(`GitHub issue creation failed: ${type}`);
    wrapped.type = type;
    throw wrapped;
  }
}
