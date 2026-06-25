// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock durable-functions (side-effect registration)
jest.unstable_mockModule('durable-functions', () => ({
  app: { activity: jest.fn() },
}));

// Mock agent-runner
jest.unstable_mockModule('../src/lib/agent-runner.js', () => ({
  startAgentEdits: jest.fn(),
  agentReactToResult: jest.fn(),
}));

// Mock get-validation-status
jest.unstable_mockModule('../src/lib/mcp-handlers/get-validation-status.js', () => ({
  getValidationStatus: jest.fn(),
}));

// Mock add-issue-comment
jest.unstable_mockModule('../src/lib/mcp-handlers/add-issue-comment.js', () => ({
  addIssueComment: jest.fn(),
}));

const df = await import('durable-functions');
const { startAgentEdits, agentReactToResult } = await import('../src/lib/agent-runner.js');
const { getValidationStatus } = await import('../src/lib/mcp-handlers/get-validation-status.js');
const { addIssueComment } = await import('../src/lib/mcp-handlers/add-issue-comment.js');

// Import the activities module — triggers df.app.activity registrations
await import('../src/functions/WorkflowActivities.js');

// Extract registered handlers by name
function getHandler(name) {
  const call = df.app.activity.mock.calls.find(([n]) => n === name);
  if (!call) throw new Error(`Activity '${name}' was not registered`);
  return call[1].handler;
}

const postSlackHandler = getHandler('PostSlackNotification');
const startAgentHandler = getHandler('StartAgentEdits');
const getValidationHandler = getHandler('GetValidationStatus');
const agentReactHandler = getHandler('AgentReactToResult');
const postIssueCommentHandler = getHandler('PostIssueComment');

const mockContext = { log: jest.fn() };

describe('WorkflowActivities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PostSlackNotification', () => {
    it('posts the correct JSON payload to SLACK_WEBHOOK_URL', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      const mockFetch = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      await postSlackHandler({ repoFullName: 'org/repo', issueNumber: 7, issueTitle: 'Bug fix' }, mockContext);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            text: ':robot_face: Starting agent run for issue #7 in org/repo: "Bug fix"',
          }),
        }),
      );
    });

    it('does NOT throw when fetch rejects (fire-and-forget)', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

      await expect(
        postSlackHandler({ repoFullName: 'org/repo', issueNumber: 1, issueTitle: 'title' }, mockContext),
      ).resolves.not.toThrow();
    });

    it('does NOT throw when SLACK_WEBHOOK_URL is not set', async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      global.fetch = jest.fn().mockRejectedValue(new Error('no url'));

      await expect(
        postSlackHandler({ repoFullName: 'org/repo', issueNumber: 1, issueTitle: 'title' }, mockContext),
      ).resolves.not.toThrow();
    });
  });

  describe('StartAgentEdits', () => {
    it('passes through the input and returns the agent-runner result', async () => {
      const dispatchedResult = {
        status: 'dispatched',
        dispatchedAt: '2026-06-24T01:00:00.000Z',
        messages: [],
        pendingToolUseId: 'tu-1',
        context: {},
      };
      startAgentEdits.mockResolvedValue(dispatchedResult);

      const input = {
        repoFullName: 'org/repo',
        issueNumber: 42,
        issueTitle: 'Bug',
        issueBody: 'It breaks',
        baseBranch: 'main',
        branchName: 'agent/issue-42',
        instanceId: 'inst-1',
      };

      const result = await startAgentHandler(input, mockContext);

      expect(startAgentEdits).toHaveBeenCalledWith(input);
      expect(result).toBe(dispatchedResult);
    });
  });

  describe('GetValidationStatus', () => {
    it('splits repoFullName and calls getValidationStatus with owner/repo', async () => {
      const statusResult = { status: 'completed', conclusion: 'success', runId: 99, runUrl: 'https://runs/99' };
      getValidationStatus.mockResolvedValue(statusResult);

      const result = await getValidationHandler(
        { repoFullName: 'myorg/myrepo', branchName: 'agent/fix', dispatchedAt: '2026-06-24T01:00:00.000Z' },
        mockContext,
      );

      expect(getValidationStatus).toHaveBeenCalledWith({
        owner: 'myorg',
        repo: 'myrepo',
        branch: 'agent/fix',
        dispatchedAt: '2026-06-24T01:00:00.000Z',
      });
      expect(result).toBe(statusResult);
    });
  });

  describe('AgentReactToResult', () => {
    it('passes through the payload and returns the agent-runner result', async () => {
      const reactResult = { status: 'completed', prUrl: 'https://github.com/org/repo/pull/5', summary: 'Done' };
      agentReactToResult.mockResolvedValue(reactResult);

      const payload = {
        repoFullName: 'org/repo',
        issueNumber: 42,
        instanceId: 'inst-1',
        messages: [],
        pendingToolUseId: 'tu-2',
        validationConclusion: 'success',
        runUrl: 'https://runs/1',
        context: {},
      };

      const result = await agentReactHandler(payload, mockContext);

      expect(agentReactToResult).toHaveBeenCalledWith(payload);
      expect(result).toBe(reactResult);
    });
  });

  describe('PostIssueComment', () => {
    it('splits repoFullName and calls addIssueComment with owner/repo', async () => {
      const commentResult = { commentId: 123, commentUrl: 'https://github.com/org/repo/issues/42#comment-123' };
      addIssueComment.mockResolvedValue(commentResult);

      const result = await postIssueCommentHandler(
        { repoFullName: 'org/repo', issueNumber: 42, body: 'Hello' },
        mockContext,
      );

      expect(addIssueComment).toHaveBeenCalledWith({
        owner: 'org',
        repo: 'repo',
        issueNumber: 42,
        body: 'Hello',
      });
      expect(result).toBe(commentResult);
    });
  });
});
