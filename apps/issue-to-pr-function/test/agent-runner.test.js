// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock the internal model-call wrapper (which wraps the Foundry SDK).
jest.unstable_mockModule('../src/lib/foundry-client.js', () => ({ createMessage: jest.fn() }));

// Mock the tool dispatch.
jest.unstable_mockModule('../src/lib/agent-tools.js', () => ({
  toolDefinitions: [{ name: 'read_issue' }, { name: 'run_validation' }, { name: 'create_draft_pr' }],
  dispatchTool: jest.fn(),
}));

// Mock the run store.
jest.unstable_mockModule('../src/lib/run-store.js', () => ({
  createRunRecord: jest.fn(),
  updateRunRecord: jest.fn(),
}));

const { createMessage } = await import('../src/lib/foundry-client.js');
const { dispatchTool } = await import('../src/lib/agent-tools.js');
const { createRunRecord, updateRunRecord } = await import('../src/lib/run-store.js');
const { startAgentEdits, agentReactToResult } = await import('../src/lib/agent-runner.js');

/** Helper: an assistant message that calls a single tool. */
function toolUseMessage(id, name, input = {}) {
  return {
    role: 'assistant',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name, input }],
  };
}

/** Helper: an assistant message that ends the turn with text only. */
function textMessage(text) {
  return { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

const startInput = {
  repoFullName: 'org/repo',
  issueNumber: 42,
  issueTitle: 'Bug',
  issueBody: 'It breaks',
  baseBranch: 'main',
  branchName: 'agent/ai-98',
  instanceId: 'inst-1',
};

describe('startAgentEdits', () => {
  beforeEach(() => {
    createMessage.mockReset();
    dispatchTool.mockReset();
    createRunRecord.mockReset();
    updateRunRecord.mockReset();
  });

  it('yields a dispatched result when the agent calls run_validation', async () => {
    // Turn 1: read_issue. Turn 2: run_validation (yield point).
    createMessage
      .mockResolvedValueOnce(toolUseMessage('tu-1', 'read_issue', {}))
      .mockResolvedValueOnce(toolUseMessage('tu-2', 'run_validation', {}));

    dispatchTool
      .mockResolvedValueOnce({ number: 42, title: 'Bug' }) // read_issue
      .mockResolvedValueOnce({ dispatchedAt: '2026-06-24T01:00:00.000Z' }); // run_validation

    const result = await startAgentEdits(startInput);

    expect(createRunRecord).toHaveBeenCalledWith({
      instanceId: 'inst-1',
      repoFullName: 'org/repo',
      issueNumber: 42,
    });

    expect(result.status).toBe('dispatched');
    expect(result.dispatchedAt).toBe('2026-06-24T01:00:00.000Z');
    expect(result.pendingToolUseId).toBe('tu-2');
    expect(result.context).toMatchObject({ owner: 'org', repo: 'repo', branch: 'agent/ai-98' });
    expect(Array.isArray(result.messages)).toBe(true);

    // The run_validation tool_use must be in the transcript (so agentReactToResult
    // can attach the deferred tool_result), but NO tool_result for it yet.
    const allBlocks = result.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const hasPendingToolUse = allBlocks.some((b) => b.type === 'tool_use' && b.id === 'tu-2');
    const hasPendingToolResult = allBlocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'tu-2');
    expect(hasPendingToolUse).toBe(true);
    expect(hasPendingToolResult).toBe(false);
    // The read_issue tool_result should be present.
    const hasReadIssueResult = allBlocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'tu-1');
    expect(hasReadIssueResult).toBe(true);
  });

  it('completes when the agent goes straight to create_draft_pr', async () => {
    createMessage
      .mockResolvedValueOnce(toolUseMessage('tu-1', 'create_draft_pr', { title: 't', body: 'b' }))
      .mockResolvedValueOnce(textMessage('Done. Opened the PR.'));

    dispatchTool.mockResolvedValueOnce({ prNumber: 7, prUrl: 'https://github.com/org/repo/pull/7' });

    const result = await startAgentEdits(startInput);

    expect(result.status).toBe('completed');
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/7');
    expect(updateRunRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'inst-1',
        status: 'completed',
        prUrl: 'https://github.com/org/repo/pull/7',
      }),
    );
  });

  it('returns failed and records failure when the model call throws', async () => {
    createMessage.mockRejectedValueOnce(new Error('model exploded'));

    const result = await startAgentEdits(startInput);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/model exploded/);
    expect(updateRunRecord).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'inst-1', status: 'failed' }));
  });

  it('fails when the max-turns cap is exceeded', async () => {
    // Always return a non-yielding, non-terminal tool use so the loop never ends naturally.
    createMessage.mockResolvedValue(toolUseMessage('tu-x', 'read_issue', {}));
    dispatchTool.mockResolvedValue({ ok: true });

    const result = await startAgentEdits(startInput);

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/max.*turns/i);
    expect(updateRunRecord).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'inst-1', status: 'failed' }));
  });
});

describe('agentReactToResult', () => {
  const reactBase = {
    repoFullName: 'org/repo',
    issueNumber: 42,
    instanceId: 'inst-1',
    pendingToolUseId: 'tu-2',
    runUrl: 'https://github.com/org/repo/actions/runs/99',
    context: { owner: 'org', repo: 'repo', branch: 'agent/ai-98', baseBranch: 'main', issueNumber: 42 },
    messages: [{ role: 'user', content: 'issue ...' }, toolUseMessage('tu-2', 'run_validation', {})],
  };

  beforeEach(() => {
    createMessage.mockReset();
    dispatchTool.mockReset();
    createRunRecord.mockReset();
    updateRunRecord.mockReset();
  });

  it('on success conclusion, agent opens the PR -> completed', async () => {
    createMessage
      .mockResolvedValueOnce(toolUseMessage('tu-3', 'create_draft_pr', { title: 't', body: 'b' }))
      .mockResolvedValueOnce(textMessage('All green, PR up.'));

    dispatchTool.mockResolvedValueOnce({ prNumber: 8, prUrl: 'https://github.com/org/repo/pull/8' });

    const result = await agentReactToResult({ ...reactBase, validationConclusion: 'success' });

    expect(result.status).toBe('completed');
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/8');

    // The deferred tool_result for tu-2 must have been supplied with the conclusion + runUrl.
    const firstCallMessages = createMessage.mock.calls[0][0].messages;
    const serialized = JSON.stringify(firstCallMessages);
    expect(serialized).toContain('tu-2');
    expect(serialized).toContain('success');
    expect(serialized).toContain('actions/runs/99');
  });

  it('on failure conclusion, agent re-validates -> re-dispatched', async () => {
    createMessage.mockResolvedValueOnce(toolUseMessage('tu-4', 'run_validation', {}));
    dispatchTool.mockResolvedValueOnce({ dispatchedAt: '2026-06-24T02:00:00.000Z' });

    const result = await agentReactToResult({ ...reactBase, validationConclusion: 'failure' });

    expect(result.status).toBe('re-dispatched');
    expect(result.dispatchedAt).toBe('2026-06-24T02:00:00.000Z');
    expect(result.pendingToolUseId).toBe('tu-4');
  });
});
