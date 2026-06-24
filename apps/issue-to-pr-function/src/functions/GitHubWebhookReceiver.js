// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { app } from '@azure/functions';
import * as df from 'durable-functions';
import { validateWebhookSignature } from '../lib/webhook-validator.js';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? '';

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

    const input = {
      repoFullName: payload.repository.full_name,
      issueNumber: payload.issue.number,
      issueTitle: payload.issue.title,
      issueBody: payload.issue.body,
      baseBranch: payload.repository.default_branch,
    };

    const client = df.getClient(context);
    const instanceId = await client.startNew('WorkflowOrchestrator', { input });

    context.log(`Started orchestration ${instanceId} for issue #${input.issueNumber}`);
    return { status: 202, body: JSON.stringify({ instanceId }) };
  },
});
