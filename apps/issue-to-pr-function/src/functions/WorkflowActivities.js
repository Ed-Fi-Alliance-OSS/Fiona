// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import * as df from 'durable-functions';
import { agentReactToResult, startAgentEdits } from '../lib/agent-runner.js';
import { addIssueComment } from '../lib/mcp-handlers/add-issue-comment.js';
import { getValidationStatus } from '../lib/mcp-handlers/get-validation-status.js';

/**
 * PostSlackNotification — fire-and-forget Slack notification.
 * Never throws: a Slack failure must not abort the orchestration.
 */
df.app.activity('PostSlackNotification', {
  handler: async (input, context) => {
    const { repoFullName, issueNumber, issueTitle } = input;
    const url = process.env.SLACK_WEBHOOK_URL;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:robot_face: Starting agent run for issue #${issueNumber} in ${repoFullName}: "${issueTitle}"`,
        }),
      });
    } catch (err) {
      context.log(`PostSlackNotification failed (non-fatal): ${err?.message ?? err}`);
    }
  },
});

/**
 * StartAgentEdits — starts a fresh agent run.
 * Input: orchestration input + instanceId.
 */
df.app.activity('StartAgentEdits', {
  handler: async (input, _context) => {
    return await startAgentEdits(input);
  },
});

/**
 * GetValidationStatus — polls for the GitHub Actions validation run status.
 * Input: { repoFullName, branchName, dispatchedAt }.
 */
df.app.activity('GetValidationStatus', {
  handler: async (input, _context) => {
    const { repoFullName, branchName, dispatchedAt } = input;
    const [owner, repo] = repoFullName.split('/');
    return await getValidationStatus({ owner, repo, branch: branchName, dispatchedAt });
  },
});

/**
 * AgentReactToResult — resumes the agent after a validation result.
 * Input: the full react payload.
 */
df.app.activity('AgentReactToResult', {
  handler: async (input, _context) => {
    return await agentReactToResult(input);
  },
});

/**
 * PostIssueComment — posts a comment on the GitHub issue.
 * Input: { repoFullName, issueNumber, body }.
 */
df.app.activity('PostIssueComment', {
  handler: async (input, _context) => {
    const { repoFullName, issueNumber, body } = input;
    const [owner, repo] = repoFullName.split('/');
    return await addIssueComment({ owner, repo, issueNumber, body });
  },
});
