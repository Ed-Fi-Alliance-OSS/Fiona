// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import axios from 'axios';

const REQUIRED_VARS = ['GH_ISSUE_REPO', 'GH_ISSUE_TOKEN'];
const REQUEST_TIMEOUT_MS = 15000;

// Org-level text issue field that records who filed the ticket. Configured by NAME,
// not node ID: IDs are opaque and change if the field is deleted and recreated, and
// the name is resolved for free from the repository lookup we already make.
const DEFAULT_SLACK_USER_FIELD_NAME = 'Slack User';

// Org-level single-select issue field holding the reporter's chosen priority. The
// modal's priorityOptionNames() must match this field's option names exactly.
const DEFAULT_PRIORITY_FIELD_NAME = 'Priority';

// GraphQL error types that mean "the token is not allowed to do this" rather than
// "the request was malformed". These arrive inside an HTTP 200, not as a 4xx.
const AUTH_ERROR_TYPES = ['FORBIDDEN', 'UNAUTHORIZED', 'INSUFFICIENT_SCOPES'];

const REPO_LOOKUP = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    issueTypes(first: 20) { nodes { id name } }
    issueFields(first: 50) {
      nodes {
        ... on IssueFieldText { id name }
        ... on IssueFieldSingleSelect { id name options { id name } }
      }
    }
  }
}`;

const CREATE_ISSUE = `
mutation($input: CreateIssueInput!) {
  createIssue(input: $input) { issue { number url } }
}`;

/** True when the required GitHub env vars are present. */
export function isGithubConfigured() {
  return REQUIRED_VARS.every((name) => Boolean(process.env[name]));
}

/**
 * The GitHub GraphQL endpoint. Fixed: Ed-Fi uses github.com, not Enterprise Server,
 * so there is no host to configure.
 */
const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

function slackUserFieldName() {
  return process.env.GH_ISSUE_SLACK_USER_FIELD_NAME || DEFAULT_SLACK_USER_FIELD_NAME;
}

function priorityFieldName() {
  return process.env.GH_ISSUE_PRIORITY_FIELD_NAME || DEFAULT_PRIORITY_FIELD_NAME;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.GH_ISSUE_TOKEN}`,
    Accept: 'application/vnd.github+json',
  };
}

/** Build, log and return a typed error. Never logs the token/auth header. */
function failure(type, detail, logger) {
  logger?.error?.(`GitHub createIssue failed (${type}): ${detail}`);
  const err = new Error(`GitHub issue creation failed: ${type}`);
  err.type = type;
  return err;
}

/**
 * Run one GraphQL request. GitHub returns HTTP 200 with an `errors` array for most
 * failures, so a non-throwing response is not necessarily a success.
 */
async function graphql(query, variables, logger) {
  let res;
  try {
    res = await axios.post(
      GITHUB_GRAPHQL_URL,
      { query, variables },
      { headers: headers(), timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (err) {
    const status = err.response?.status;
    const type = status === 401 || status === 403 ? 'github_auth_failed' : 'github_create_failed';
    throw failure(type, `status=${status ?? 'none'} ${err.message}`, logger);
  }

  const errors = res.data?.errors;
  if (errors?.length) {
    const isAuth = errors.some((e) => AUTH_ERROR_TYPES.includes(e.type));
    const detail = errors.map((e) => e.message).join('; ');
    throw failure(isAuth ? 'github_auth_failed' : 'github_create_failed', detail, logger);
  }
  return res.data?.data;
}

/**
 * Create a GitHub issue in the configured repo. Throws an Error with `.type` on failure.
 *
 * `slackUser` populates the org-level `Slack User` issue field, which is visible to
 * organization members only — reporter identity deliberately stays out of `bodyText`,
 * which is world-readable on a public repo.
 *
 * @param {{ title: string, bodyText: string, issueTypeName?: string, priorityName?: string, slackUser?: string }} input
 * @param {import("@slack/logger").Logger} [logger]
 * @returns {Promise<{ number: number, url: string }>}
 */
export async function createIssue({ title, bodyText, issueTypeName, priorityName, slackUser }, logger) {
  const [owner, name] = (process.env.GH_ISSUE_REPO || '').split('/');

  const lookup = await graphql(REPO_LOOKUP, { owner, name }, logger);
  const repository = lookup?.repository;
  if (!repository?.id) {
    throw failure('github_create_failed', `repository ${owner}/${name} not found`, logger);
  }

  const input = { repositoryId: repository.id, title, body: bodyText };

  // Issue fields are defined at org level; `repository.issueFields` lists only the
  // ones this token can see, so a field that exists but is invisible to the PAT simply
  // won't appear here — hence the explicit, named failures below rather than GitHub's
  // opaque "could not resolve to a node with the global id".
  const findField = (fieldName) => (repository.issueFields?.nodes ?? []).find((node) => node?.name === fieldName);
  const issueFields = [];

  if (issueTypeName) {
    const type = (repository.issueTypes?.nodes ?? []).find((node) => node?.name === issueTypeName);
    if (!type?.id) {
      throw failure('github_create_failed', `issue type "${issueTypeName}" does not exist in ${owner}/${name}`, logger);
    }
    input.issueTypeId = type.id;
  }

  if (slackUser) {
    const fieldName = slackUserFieldName();
    const field = findField(fieldName);
    if (!field?.id) {
      throw failure(
        'github_create_failed',
        `text issue field "${fieldName}" is not available on ${owner}/${name} (check the field name and that the token can read it)`,
        logger,
      );
    }
    issueFields.push({ fieldId: field.id, textValue: slackUser });
  }

  if (priorityName) {
    const fieldName = priorityFieldName();
    const field = findField(fieldName);
    const option = (field?.options ?? []).find((opt) => opt?.name === priorityName);
    if (!option?.id) {
      throw failure(
        'github_create_failed',
        `single-select field "${fieldName}" has no option "${priorityName}" on ${owner}/${name}`,
        logger,
      );
    }
    issueFields.push({ fieldId: field.id, singleSelectOptionId: option.id });
  }

  if (issueFields.length) input.issueFields = issueFields;

  const created = await graphql(CREATE_ISSUE, { input }, logger);
  const issue = created?.createIssue?.issue;
  if (!issue?.number) {
    throw failure('github_create_failed', 'mutation returned no issue', logger);
  }
  return { number: issue.number, url: issue.url };
}
