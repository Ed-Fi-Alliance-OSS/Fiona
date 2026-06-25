// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { addIssueComment } from './mcp-handlers/add-issue-comment.js';
import { createBranch } from './mcp-handlers/create-branch.js';
import { createDraftPr } from './mcp-handlers/create-draft-pr.js';
import { getValidationStatus } from './mcp-handlers/get-validation-status.js';
import { listDirectory } from './mcp-handlers/list-directory.js';
import { readFile } from './mcp-handlers/read-file.js';
import { readIssue } from './mcp-handlers/read-issue.js';
import { runValidation } from './mcp-handlers/run-validation.js';
import { writeFile } from './mcp-handlers/write-file.js';

/**
 * Anthropic tool definitions for the nine GitHub tools the agent may call.
 *
 * Context (owner/repo/working branch/base branch/issue number) is fixed for the
 * run and injected by {@link dispatchTool}; it is intentionally NOT part of any
 * input_schema so the agent only decides the semantic parameters.
 *
 * @type {Array<{ name: string, description: string, input_schema: object }>}
 */
export const toolDefinitions = [
  {
    name: 'read_issue',
    description:
      'Read the GitHub issue this run is fixing. Returns number, title, body, labels, and state. ' +
      'The issue is fixed for the run, so no parameters are required.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_directory',
    description: 'List the contents (files and subdirectories) of a directory in the repository on the working branch.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Repository-relative directory path, e.g. "src/lib". Use "" for the root.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the repository on the working branch. Returns its content and sha.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository-relative file path, e.g. "src/lib/foo.js".' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or update a file on the working branch with a commit. Provide the full new file content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository-relative file path to write.' },
        content: { type: 'string', description: 'Full UTF-8 content of the file after the change.' },
        message: { type: 'string', description: 'Commit message describing the change.' },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'create_branch',
    description:
      'Create the working branch for this run from the base branch (or reset it if it already exists). ' +
      'The branch name and base branch are fixed for the run, so no parameters are required.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'run_validation',
    description:
      'Dispatch the validation workflow (lint + tests) for the working branch via GitHub Actions. ' +
      'Returns once dispatched; the conclusion is delivered back to you asynchronously.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_validation_status',
    description: 'Get the status and conclusion of the most recent validation workflow run for the working branch.',
    input_schema: {
      type: 'object',
      properties: {
        dispatchedAt: {
          type: 'string',
          description: 'ISO timestamp returned by run_validation, used to match the correct run.',
        },
      },
      required: ['dispatchedAt'],
    },
  },
  {
    name: 'create_draft_pr',
    description:
      'Open a draft pull request from the working branch into the base branch. This must be your final action. ' +
      'In the body, flag any public-API or user-facing behavior changes that need documentation.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Pull request title.' },
        body: { type: 'string', description: 'Pull request body (Markdown).' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'add_issue_comment',
    description: 'Post a comment on the issue, e.g. to report progress or ask for clarification.',
    input_schema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Comment body (Markdown).' },
      },
      required: ['body'],
    },
  },
];

/**
 * @typedef {object} ToolContext
 * @property {string} owner
 * @property {string} repo
 * @property {string} branch       Working branch the agent edits.
 * @property {string} baseBranch   Base branch PRs target / branches fork from.
 * @property {number} issueNumber
 */

/**
 * Merges run context with the agent-supplied params and invokes the matching handler.
 * The agent never supplies owner/repo/branch — those come from `context`.
 *
 * @param {string} name        Tool name (one of {@link toolDefinitions}).
 * @param {object} agentParams Parameters the model supplied for the tool.
 * @param {ToolContext} context
 * @returns {Promise<unknown>} The handler's return value.
 * @throws {Error} If the tool name is not recognised.
 */
export async function dispatchTool(name, agentParams, context) {
  const { owner, repo, branch, baseBranch, issueNumber } = context;
  const params = agentParams ?? {};

  switch (name) {
    case 'read_issue':
      return readIssue({ owner, repo, issueNumber });
    case 'list_directory':
      return listDirectory({ owner, repo, branch, path: params.path });
    case 'read_file':
      return readFile({ owner, repo, branch, path: params.path });
    case 'write_file':
      return writeFile({ owner, repo, branch, path: params.path, content: params.content, message: params.message });
    case 'create_branch':
      return createBranch({ owner, repo, branch, fromBranch: baseBranch });
    case 'run_validation':
      return runValidation({ owner, repo, branch });
    case 'get_validation_status':
      return getValidationStatus({ owner, repo, branch, dispatchedAt: params.dispatchedAt });
    case 'create_draft_pr':
      return createDraftPr({ owner, repo, branch, baseBranch, issueNumber, title: params.title, body: params.body });
    case 'add_issue_comment':
      return addIssueComment({ owner, repo, issueNumber, body: params.body });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
