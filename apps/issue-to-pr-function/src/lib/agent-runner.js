// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { dispatchTool, toolDefinitions } from './agent-tools.js';
import { createMessage } from './foundry-client.js';
import { createRunRecord, updateRunRecord } from './run-store.js';

/** Maximum number of model turns before we abort to avoid runaway loops. */
const MAX_TURNS = 40;

/** System prompt: drives a TDD bug-fix workflow that ends in a draft PR. */
const SYSTEM_PROMPT = `You are a TDD coding agent. Given a GitHub issue:
1. Read the issue and understand the bug.
2. Locate the relevant code and existing tests.
3. Write or modify a failing test that captures the expected behavior.
4. Write the minimal code change to make the test pass.
5. Run validation (lint + tests) and iterate until passing.
6. Create a draft PR. In the PR body, flag any changes to public APIs or
   user-facing behavior that need documentation.

Constraints:
- Do NOT refactor unrelated code.
- Follow existing patterns and conventions in the file you are modifying.
- Stick to the smallest change that fixes the bug.
- Always call create_draft_pr as your final action.`;

/**
 * Splits an assistant message's content into the tool_use blocks it requested.
 *
 * @param {object} message Assistant message ({ content: Array<block> }).
 * @returns {Array<{ id: string, name: string, input: object }>}
 */
function toolUseBlocks(message) {
  return (message.content ?? []).filter((block) => block.type === 'tool_use');
}

/**
 * Builds a `tool_result` content block.
 *
 * @param {string} toolUseId Matching tool_use id.
 * @param {unknown} result    Handler return value (or error description).
 * @param {boolean} [isError]
 * @returns {object}
 */
function toolResultBlock(toolUseId, result, isError = false) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: typeof result === 'string' ? result : JSON.stringify(result),
    ...(isError ? { is_error: true } : {}),
  };
}

/**
 * Extracts a PR URL from a captured create_draft_pr result, falling back to
 * scanning assistant text for a pulls URL.
 *
 * @param {object|null} draftPrResult Captured result of create_draft_pr.
 * @param {object} lastMessage        The final assistant message.
 * @returns {string|undefined}
 */
function extractPrUrl(draftPrResult, lastMessage) {
  if (draftPrResult?.prUrl) {
    return draftPrResult.prUrl;
  }
  const text = (lastMessage?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const match = text.match(/https?:\/\/\S*\/pull\/\d+/);
  return match ? match[0] : undefined;
}

/**
 * Joins assistant text blocks of a message into a single summary string.
 *
 * @param {object} message
 * @returns {string}
 */
function assistantText(message) {
  return (message?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Runs the shared tool-use loop until it yields (run_validation), completes
 * (PR created / no more tools), errors, or hits the turn cap.
 *
 * The loop mutates `messages` in place (appending assistant + tool_result
 * turns). On a `run_validation` call it STOPS WITHOUT appending the tool_result
 * — the caller serializes state and resumes later via {@link agentReactToResult},
 * which supplies the deferred validation conclusion.
 *
 * @param {object} params
 * @param {Array<object>} params.messages       Conversation so far (mutated).
 * @param {import('./agent-tools.js').ToolContext} params.context
 * @param {string} params.dispatchedStatus      Terminal-yield status: 'dispatched' | 're-dispatched'.
 * @param {object|null} [params.draftPrResult]  Carried-over create_draft_pr result, if any.
 * @returns {Promise<object>} A structured result (does not write the run record).
 */
async function runLoop({ messages, context, dispatchedStatus, draftPrResult = null }) {
  let capturedDraftPr = draftPrResult;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const assistant = await createMessage({ messages, system: SYSTEM_PROMPT, tools: toolDefinitions });
    messages.push({ role: assistant.role ?? 'assistant', content: assistant.content });

    const toolUses = toolUseBlocks(assistant);

    if (toolUses.length === 0) {
      // No tools requested — the agent is done talking.
      const prUrl = extractPrUrl(capturedDraftPr, assistant);
      return { status: 'completed', prUrl, summary: assistantText(assistant) };
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      if (toolUse.name === 'run_validation') {
        // Yield point: dispatch GHA, then STOP without appending the tool_result.
        const { dispatchedAt } = await dispatchTool('run_validation', toolUse.input, context);
        return {
          status: dispatchedStatus,
          dispatchedAt,
          messages,
          pendingToolUseId: toolUse.id,
          context,
        };
      }

      const result = await dispatchTool(toolUse.name, toolUse.input, context);
      if (toolUse.name === 'create_draft_pr') {
        capturedDraftPr = result;
      }
      toolResults.push(toolResultBlock(toolUse.id, result));
    }

    messages.push({ role: 'user', content: toolResults });
  }

  const err = new Error(`Agent exceeded the max of ${MAX_TURNS} turns without completing`);
  err.code = 'MAX_TURNS_EXCEEDED';
  throw err;
}

/**
 * Starts a fresh agent run: creates the run record, seeds the conversation with
 * the issue + the exact branch to use, and runs the loop.
 *
 * @param {{ repoFullName: string, issueNumber: number, issueTitle: string,
 *   issueBody: string, baseBranch: string, branchName: string, instanceId: string }} input
 * @returns {Promise<object>} A structured result (dispatched | completed | failed).
 */
export async function startAgentEdits(input) {
  const { repoFullName, issueNumber, issueTitle, issueBody, baseBranch, branchName, instanceId } = input;
  const [owner, repo] = repoFullName.split('/');
  const context = { owner, repo, branch: branchName, baseBranch, issueNumber };

  await createRunRecord({ instanceId, repoFullName, issueNumber });

  const messages = [
    {
      role: 'user',
      content:
        `Fix GitHub issue #${issueNumber} in ${repoFullName}.\n\n` +
        `Title: ${issueTitle}\n\n` +
        `Body:\n${issueBody}\n\n` +
        `Base branch: ${baseBranch}\n` +
        `You MUST do all your work on the branch named "${branchName}" — create it with create_branch ` +
        `and do not invent a different branch name. Open the draft PR from "${branchName}" into "${baseBranch}".`,
    },
  ];

  try {
    const result = await runLoop({ messages, context, dispatchedStatus: 'dispatched' });
    await finalizeIfTerminal(result, { instanceId, repoFullName });
    return result;
  } catch (err) {
    return failRun(err, { instanceId, repoFullName });
  }
}

/**
 * Resumes a run after a validation dispatch completed: supplies the deferred
 * tool_result for the pending run_validation, then continues the loop.
 *
 * @param {{ repoFullName: string, issueNumber: number, instanceId: string,
 *   messages: Array<object>, pendingToolUseId: string, validationConclusion: string,
 *   runUrl: string, context: import('./agent-tools.js').ToolContext }} input
 * @returns {Promise<object>} A structured result (re-dispatched | completed | failed).
 */
export async function agentReactToResult(input) {
  const { repoFullName, instanceId, messages, pendingToolUseId, validationConclusion, runUrl, context } = input;

  const conclusionResult = {
    conclusion: validationConclusion,
    runUrl,
    note:
      validationConclusion === 'success'
        ? 'Validation passed (lint + tests green).'
        : `Validation did not pass (conclusion: ${validationConclusion}). Inspect the run, fix the code, and validate again.`,
  };

  // Supply the deferred tool_result for the pending run_validation call.
  messages.push({ role: 'user', content: [toolResultBlock(pendingToolUseId, conclusionResult)] });

  try {
    const result = await runLoop({ messages, context, dispatchedStatus: 're-dispatched' });
    await finalizeIfTerminal(result, { instanceId, repoFullName });
    return result;
  } catch (err) {
    return failRun(err, { instanceId, repoFullName });
  }
}

/**
 * Updates the run record for terminal results. Yield results (dispatched /
 * re-dispatched) are not terminal and leave the record untouched.
 *
 * @param {object} result
 * @param {{ instanceId: string, repoFullName: string }} ids
 * @returns {Promise<void>}
 */
async function finalizeIfTerminal(result, { instanceId, repoFullName }) {
  if (result.status === 'completed') {
    await updateRunRecord({ instanceId, repoFullName, status: 'completed', prUrl: result.prUrl });
  }
}

/**
 * Records a failed run and returns the failed structured result.
 *
 * @param {Error} err
 * @param {{ instanceId: string, repoFullName: string }} ids
 * @returns {Promise<object>}
 */
async function failRun(err, { instanceId, repoFullName }) {
  const error = String(err?.message ?? err);
  await updateRunRecord({ instanceId, repoFullName, status: 'failed', error });
  return { status: 'failed', summary: 'Agent run failed.', error };
}
