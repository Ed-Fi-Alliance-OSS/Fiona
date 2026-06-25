// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import * as df from 'durable-functions';

/**
 * Returns a new Date that is `seconds` seconds after `date`.
 * Pure function — safe to call inside the orchestrator body.
 *
 * @param {Date} date
 * @param {number} seconds
 * @returns {Date}
 */
function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

df.app.orchestration('WorkflowOrchestrator', function* (context) {
  const input = context.df.getInput();
  const { repoFullName, issueNumber, issueTitle, issueBody, baseBranch, branchName } = input;

  const MAX_ROUNDS = 5;
  const MAX_POLLS = 120; // ~1 h at 30 s

  // Fire-and-forget Slack notification
  yield context.df.callActivity('PostSlackNotification', { repoFullName, issueNumber, issueTitle });

  // Start the agent
  let agent = yield context.df.callActivity('StartAgentEdits', {
    repoFullName,
    issueNumber,
    issueTitle,
    issueBody,
    baseBranch,
    branchName,
    instanceId: context.df.instanceId,
  });

  let result = agent;
  let rounds = 0;

  while (agent.status === 'dispatched' || agent.status === 're-dispatched') {
    if (++rounds > MAX_ROUNDS) {
      result = { status: 'failed', summary: 'Exceeded max validation rounds', error: 'MAX_ROUNDS_EXCEEDED' };
      break;
    }

    // Poll until the validation run completes
    let v = { status: 'queued', conclusion: null };
    let polls = 0;

    while (v.status !== 'completed') {
      if (++polls > MAX_POLLS) {
        // Give up waiting — treat as failed validation
        v = { status: 'completed', conclusion: 'failure', runUrl: null };
        break;
      }
      yield context.df.createTimer(addSeconds(context.df.currentUtcDateTime, 30));
      v = yield context.df.callActivity('GetValidationStatus', {
        repoFullName,
        branchName,
        dispatchedAt: agent.dispatchedAt,
      });
    }

    result = yield context.df.callActivity('AgentReactToResult', {
      repoFullName,
      issueNumber,
      instanceId: context.df.instanceId,
      messages: agent.messages,
      pendingToolUseId: agent.pendingToolUseId,
      validationConclusion: v.conclusion,
      runUrl: v.runUrl,
      context: agent.context,
    });

    agent = result;
  }

  if (result && result.status === 'failed') {
    yield context.df.callActivity('PostIssueComment', {
      repoFullName,
      issueNumber,
      body: `### Fiona agent run failed\n\n${result.summary}\n\n**Error:** ${result.error}`,
    });
  }

  return result;
});
