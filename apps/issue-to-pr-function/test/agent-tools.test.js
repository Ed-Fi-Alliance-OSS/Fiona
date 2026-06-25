// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../src/lib/mcp-handlers/read-issue.js', () => ({ readIssue: jest.fn() }));
jest.unstable_mockModule('../src/lib/mcp-handlers/list-directory.js', () => ({ listDirectory: jest.fn() }));
jest.unstable_mockModule('../src/lib/mcp-handlers/read-file.js', () => ({ readFile: jest.fn() }));
jest.unstable_mockModule('../src/lib/mcp-handlers/write-file.js', () => ({ writeFile: jest.fn() }));
jest.unstable_mockModule('../src/lib/mcp-handlers/create-branch.js', () => ({ createBranch: jest.fn() }));
jest.unstable_mockModule('../src/lib/mcp-handlers/run-validation.js', () => ({ runValidation: jest.fn() }));
jest.unstable_mockModule('../src/lib/mcp-handlers/get-validation-status.js', () => ({
  getValidationStatus: jest.fn(),
}));
jest.unstable_mockModule('../src/lib/mcp-handlers/create-draft-pr.js', () => ({ createDraftPr: jest.fn() }));
jest.unstable_mockModule('../src/lib/mcp-handlers/add-issue-comment.js', () => ({ addIssueComment: jest.fn() }));

const { readIssue } = await import('../src/lib/mcp-handlers/read-issue.js');
const { listDirectory } = await import('../src/lib/mcp-handlers/list-directory.js');
const { readFile } = await import('../src/lib/mcp-handlers/read-file.js');
const { writeFile } = await import('../src/lib/mcp-handlers/write-file.js');
const { createBranch } = await import('../src/lib/mcp-handlers/create-branch.js');
const { runValidation } = await import('../src/lib/mcp-handlers/run-validation.js');
const { getValidationStatus } = await import('../src/lib/mcp-handlers/get-validation-status.js');
const { createDraftPr } = await import('../src/lib/mcp-handlers/create-draft-pr.js');
const { addIssueComment } = await import('../src/lib/mcp-handlers/add-issue-comment.js');

const { toolDefinitions, dispatchTool } = await import('../src/lib/agent-tools.js');

const EXPECTED_NAMES = [
  'read_issue',
  'list_directory',
  'read_file',
  'write_file',
  'create_branch',
  'run_validation',
  'get_validation_status',
  'create_draft_pr',
  'add_issue_comment',
];

const context = {
  owner: 'org',
  repo: 'repo',
  branch: 'agent/ai-98',
  baseBranch: 'main',
  issueNumber: 42,
};

describe('toolDefinitions', () => {
  it('defines exactly the nine expected tools', () => {
    expect(toolDefinitions.map((t) => t.name).sort()).toEqual([...EXPECTED_NAMES].sort());
  });

  it('every tool has a name, non-empty description, and an object input_schema', () => {
    for (const def of toolDefinitions) {
      expect(typeof def.name).toBe('string');
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.input_schema).toBeDefined();
      expect(def.input_schema.type).toBe('object');
      expect(def.input_schema.properties).toBeDefined();
    }
  });

  it('does not expose owner/repo/branch in any input_schema (context is injected)', () => {
    for (const def of toolDefinitions) {
      const props = Object.keys(def.input_schema.properties ?? {});
      expect(props).not.toContain('owner');
      expect(props).not.toContain('repo');
      expect(props).not.toContain('branch');
    }
  });
});

describe('dispatchTool', () => {
  beforeEach(() => {
    for (const fn of [
      readIssue,
      listDirectory,
      readFile,
      writeFile,
      createBranch,
      runValidation,
      getValidationStatus,
      createDraftPr,
      addIssueComment,
    ]) {
      fn.mockReset();
    }
  });

  it('routes read_issue and injects owner/repo/issueNumber from context', async () => {
    readIssue.mockResolvedValueOnce({ number: 42 });
    await dispatchTool('read_issue', {}, context);
    expect(readIssue).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', issueNumber: 42 });
  });

  it('routes read_file and defaults branch to context.branch', async () => {
    readFile.mockResolvedValueOnce({ content: 'x' });
    await dispatchTool('read_file', { path: 'src/a.js' }, context);
    expect(readFile).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', branch: 'agent/ai-98', path: 'src/a.js' });
  });

  it('routes write_file merging agent params with context', async () => {
    writeFile.mockResolvedValueOnce({ sha: 's' });
    await dispatchTool('write_file', { path: 'src/a.js', content: 'c', message: 'm' }, context);
    expect(writeFile).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-98',
      path: 'src/a.js',
      content: 'c',
      message: 'm',
    });
  });

  it('routes create_branch using context.branch and context.baseBranch as fromBranch', async () => {
    createBranch.mockResolvedValueOnce({ branch: 'agent/ai-98' });
    await dispatchTool('create_branch', {}, context);
    expect(createBranch).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-98',
      fromBranch: 'main',
    });
  });

  it('routes create_draft_pr injecting branch, baseBranch, issueNumber', async () => {
    createDraftPr.mockResolvedValueOnce({ prUrl: 'u' });
    await dispatchTool('create_draft_pr', { title: 't', body: 'b' }, context);
    expect(createDraftPr).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      branch: 'agent/ai-98',
      baseBranch: 'main',
      issueNumber: 42,
      title: 't',
      body: 'b',
    });
  });

  it('routes add_issue_comment injecting issueNumber', async () => {
    addIssueComment.mockResolvedValueOnce({ commentId: 1 });
    await dispatchTool('add_issue_comment', { body: 'hi' }, context);
    expect(addIssueComment).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', issueNumber: 42, body: 'hi' });
  });

  it('throws a descriptive error for an unknown tool', async () => {
    await expect(dispatchTool('nope', {}, context)).rejects.toThrow(/unknown tool.*nope/i);
  });
});
