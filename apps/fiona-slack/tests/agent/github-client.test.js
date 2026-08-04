// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post: mockPost } }));

const { isGithubConfigured, createIssue } = await import('../../src/agent/github-client.js');

const logger = { error: jest.fn(), warn: jest.fn() };

/** First round trip: repository node id, its issue types, and its issue fields. */
const repoLookup = () => ({
  data: {
    data: {
      repository: {
        id: 'R_repo',
        issueTypes: {
          nodes: [
            { id: 'IT_task', name: 'Task' },
            { id: 'IT_bug', name: 'Bug' },
            { id: 'IT_feature', name: 'Feature' },
          ],
        },
        issueFields: {
          nodes: [
            { id: 'IFT_slack', name: 'Slack User' },
            { id: 'IFT_jira', name: 'Jira Key' },
            {
              id: 'IFSS_priority',
              name: 'Priority',
              options: [
                { id: 'IFSSO_urgent', name: 'Urgent' },
                { id: 'IFSSO_high', name: 'High' },
                { id: 'IFSSO_medium', name: 'Medium' },
                { id: 'IFSSO_low', name: 'Low' },
              ],
            },
          ],
        },
      },
    },
  },
});

/** Second round trip: the createIssue mutation. */
const createResult = () => ({
  data: { data: { createIssue: { issue: { number: 42, url: 'https://github.com/o/r/issues/42' } } } },
});

const mutationInput = () => mockPost.mock.calls[1][1].variables.input;

beforeEach(() => {
  jest.clearAllMocks();
  // mockClear leaves queued mockResolvedValueOnce values in place; a test that throws
  // before consuming both would leak its leftover response into the next test.
  mockPost.mockReset();
  process.env.SLACK_GITHUB_ISSUE_REPO = 'Ed-Fi-Alliance-OSS/Fiona';
  process.env.SLACK_GITHUB_ISSUE_TOKEN = 'ghp-secret-token';
  delete process.env.GITHUB_API_URL;
  delete process.env.SLACK_GITHUB_ISSUE_SLACK_USER_FIELD_NAME;
  delete process.env.SLACK_GITHUB_ISSUE_PRIORITY_FIELD_NAME;
  mockPost.mockResolvedValueOnce(repoLookup()).mockResolvedValueOnce(createResult());
});

describe('isGithubConfigured', () => {
  it('is true when repo and token are set', () => {
    expect(isGithubConfigured()).toBe(true);
  });
  it('is false when the token is missing', () => {
    delete process.env.SLACK_GITHUB_ISSUE_TOKEN;
    expect(isGithubConfigured()).toBe(false);
  });
});

describe('createIssue', () => {
  it('resolves node ids then creates the issue, returning number + url', async () => {
    const result = await createIssue({ title: 'It broke', bodyText: 'Details here' }, logger);

    expect(result).toEqual({ number: 42, url: 'https://github.com/o/r/issues/42' });
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[0][0]).toBe('https://api.github.com/graphql');
    expect(mockPost.mock.calls[0][1].variables).toEqual({ owner: 'Ed-Fi-Alliance-OSS', name: 'Fiona' });
    expect(mutationInput()).toEqual({ repositoryId: 'R_repo', title: 'It broke', body: 'Details here' });
    const opts = mockPost.mock.calls[0][2];
    expect(opts.headers.Authorization).toBe('Bearer ghp-secret-token');
  });

  it('sets the native issue type, resolved by name', async () => {
    await createIssue({ title: 't', bodyText: 'b', issueTypeName: 'Bug' }, logger);

    expect(mutationInput().issueTypeId).toBe('IT_bug');
  });

  it('never sends labels — the native issue type replaced them', async () => {
    await createIssue({ title: 't', bodyText: 'b', issueTypeName: 'Feature' }, logger);

    expect(mutationInput()).not.toHaveProperty('labelIds');
  });

  it('throws github_create_failed naming the issue type when it does not exist', async () => {
    await expect(createIssue({ title: 't', bodyText: 'b', issueTypeName: 'Epic' }, logger)).rejects.toMatchObject({
      type: 'github_create_failed',
    });
    expect(logger.error.mock.calls.flat().join(' ')).toContain('Epic');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('sets Priority as a single-select option id, resolved by name', async () => {
    await createIssue({ title: 't', bodyText: 'b', priorityName: 'Urgent' }, logger);

    expect(mutationInput().issueFields).toEqual([
      { fieldId: 'IFSS_priority', singleSelectOptionId: 'IFSSO_urgent' },
    ]);
  });

  it('sends the Slack User text value and the Priority option together', async () => {
    await createIssue({ title: 't', bodyText: 'b', slackUser: 'Ada [U1]', priorityName: 'Low' }, logger);

    expect(mutationInput().issueFields).toEqual([
      { fieldId: 'IFT_slack', textValue: 'Ada [U1]' },
      { fieldId: 'IFSS_priority', singleSelectOptionId: 'IFSSO_low' },
    ]);
  });

  it('throws github_create_failed naming the priority when the option does not exist', async () => {
    await expect(createIssue({ title: 't', bodyText: 'b', priorityName: 'Lowest' }, logger)).rejects.toMatchObject({
      type: 'github_create_failed',
    });
    expect(logger.error.mock.calls.flat().join(' ')).toContain('Lowest');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('honors SLACK_GITHUB_ISSUE_PRIORITY_FIELD_NAME', async () => {
    process.env.SLACK_GITHUB_ISSUE_PRIORITY_FIELD_NAME = 'Effort';
    await expect(createIssue({ title: 't', bodyText: 'b', priorityName: 'High' }, logger)).rejects.toMatchObject({
      type: 'github_create_failed',
    });
    // Looked up "Effort", which has no "High" option — proves the name was honored.
    expect(logger.error.mock.calls.flat().join(' ')).toContain('Effort');
  });

  it('resolves the Slack User field by name to its node id', async () => {
    await createIssue({ title: 't', bodyText: 'b', slackUser: 'Ada Lovelace [U1]' }, logger);

    expect(mutationInput().issueFields).toEqual([{ fieldId: 'IFT_slack', textValue: 'Ada Lovelace [U1]' }]);
  });

  it('honors SLACK_GITHUB_ISSUE_SLACK_USER_FIELD_NAME', async () => {
    process.env.SLACK_GITHUB_ISSUE_SLACK_USER_FIELD_NAME = 'Jira Key';
    await createIssue({ title: 't', bodyText: 'b', slackUser: 'Ada [U1]' }, logger);

    expect(mutationInput().issueFields).toEqual([{ fieldId: 'IFT_jira', textValue: 'Ada [U1]' }]);
  });

  it('throws github_create_failed naming the field when it is not visible to the token', async () => {
    process.env.SLACK_GITHUB_ISSUE_SLACK_USER_FIELD_NAME = 'Nonexistent Field';

    await expect(createIssue({ title: 't', bodyText: 'b', slackUser: 'Ada [U1]' }, logger)).rejects.toMatchObject({
      type: 'github_create_failed',
    });
    // Diagnosable: the log must name the field, not just echo an opaque id.
    expect(logger.error.mock.calls.flat().join(' ')).toContain('Nonexistent Field');
    // The mutation must not run with an unresolved field.
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('omits issueFields and issueTypeId when neither is given', async () => {
    await createIssue({ title: 't', bodyText: 'b' }, logger);

    expect(mutationInput()).toEqual({ repositoryId: 'R_repo', title: 't', body: 'b' });
  });

  it('derives the GraphQL endpoint from GITHUB_API_URL for Enterprise Server', async () => {
    process.env.GITHUB_API_URL = 'https://ghe.example.org/api/v3';
    await createIssue({ title: 't', bodyText: 'b' }, logger);

    expect(mockPost.mock.calls[0][0]).toBe('https://ghe.example.org/api/graphql');
  });

  it('throws github_auth_failed on HTTP 401', async () => {
    mockPost.mockReset();
    mockPost.mockRejectedValue({ response: { status: 401 }, message: 'Bad credentials' });

    await expect(createIssue({ title: 't', bodyText: 'b' }, logger)).rejects.toMatchObject({
      type: 'github_auth_failed',
    });
  });

  it('throws github_auth_failed when GraphQL returns FORBIDDEN inside an HTTP 200', async () => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({
      data: { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] },
    });

    await expect(createIssue({ title: 't', bodyText: 'b' }, logger)).rejects.toMatchObject({
      type: 'github_auth_failed',
    });
  });

  it('throws github_create_failed on a non-auth GraphQL error inside an HTTP 200', async () => {
    mockPost.mockReset();
    mockPost.mockResolvedValueOnce(repoLookup()).mockResolvedValueOnce({
      data: { errors: [{ message: 'Field is not valid' }] },
    });

    await expect(createIssue({ title: 't', bodyText: 'b' }, logger)).rejects.toMatchObject({
      type: 'github_create_failed',
    });
  });

  it('never writes the token into the log', async () => {
    mockPost.mockReset();
    mockPost.mockRejectedValue({ response: { status: 500 }, message: 'boom' });

    await expect(createIssue({ title: 't', bodyText: 'b' }, logger)).rejects.toThrow();
    const logged = logger.error.mock.calls.flat().join(' ');
    expect(logged).not.toContain('ghp-secret-token');
  });
});
