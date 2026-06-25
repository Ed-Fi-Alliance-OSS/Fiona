// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { app } from '@azure/functions';
import * as df from 'durable-functions';
import { validateWebhookSignature } from '../lib/webhook-validator.js';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? '';

/** Non-terminal runtime statuses — an existing instance in these states is still active. */
const NON_TERMINAL_STATUSES = new Set(['Running', 'Pending', 'ContinuedAsNew', 'Suspended']);

/**
 * Sanitize a string for use as a Durable Functions instance ID.
 * Replaces any character that is not [A-Za-z0-9_-] with '-'.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeInstanceId(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * Convert a string to a URL-safe slug: lowercase, replace runs of
 * non-alphanumeric chars with a single '-', trim leading/trailing '-',
 * then truncate to 30 chars and trim any trailing '-' again.
 * @param {string} title
 * @returns {string}
 */
export function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

app.http('GitHubWebhookReceiver', {
  methods: ['POST'],
  route: 'github-webhook',
  authLevel: 'anonymous',
  extraInputs: [df.input.durableClient()],
  handler: async (request, context) => {
    const body = await request.text();
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');

    if (!validateWebhookSignature(body, signature, WEBHOOK_SECRET)) {
      return { status: 400, body: 'Invalid signature' };
    }

    if (event !== 'issues') {
      return { status: 200, body: 'Ignored' };
    }

    const payload = JSON.parse(body);
    if (payload.action !== 'labeled' || payload.label?.name !== 'agent-ready') {
      return { status: 200, body: 'Ignored' };
    }

    const repoFullName = payload.repository.full_name;

    // Defense-in-depth repo allowlist. AGENT_ALLOWED_REPOS is a comma-separated
    // list of `owner/repo` values. When set, only those repos may drive the agent;
    // when unset, all repos are accepted (the GitHub App install scope is the
    // boundary). Read per-request so it can be configured without a redeploy.
    const allowedRepos = (process.env.AGENT_ALLOWED_REPOS ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (allowedRepos.length > 0 && !allowedRepos.includes(repoFullName)) {
      context.log(`Repository ${repoFullName} is not in AGENT_ALLOWED_REPOS — ignoring`);
      return { status: 200, body: 'Ignored' };
    }
    if (allowedRepos.length === 0) {
      context.log('AGENT_ALLOWED_REPOS is not set — accepting all installed repositories');
    }

    const issueNumber = payload.issue.number;
    const issueTitle = payload.issue.title;

    const instanceId = sanitizeInstanceId(`${repoFullName}#${issueNumber}`);
    const branchName = `agent/issue-${issueNumber}-${slug(issueTitle)}`;

    const input = {
      repoFullName,
      issueNumber,
      issueTitle,
      issueBody: payload.issue.body,
      baseBranch: payload.repository.default_branch,
      branchName,
    };

    const client = df.getClient(context);

    const existing = await client.getStatus(instanceId);
    if (existing != null) {
      if (NON_TERMINAL_STATUSES.has(existing.runtimeStatus)) {
        context.log(`Orchestration ${instanceId} is already ${existing.runtimeStatus} — skipping`);
        return { status: 202, body: 'Already running' };
      }
      // Terminal instance — purge so we can start fresh
      await client.purgeInstanceHistory(instanceId);
    }

    await client.startNew('WorkflowOrchestrator', { instanceId, input });

    context.log(`Started orchestration ${instanceId} for issue #${issueNumber}`);
    return { status: 202, body: JSON.stringify({ instanceId }) };
  },
});
