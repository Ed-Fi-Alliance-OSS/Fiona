// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock durable-functions (side-effect registration only)
jest.unstable_mockModule('durable-functions', () => ({
  app: { orchestration: jest.fn() },
}));

const df = await import('durable-functions');

// Import the orchestrator — triggers df.app.orchestration registration
await import('../src/functions/WorkflowOrchestrator.js');

// Extract the registered generator function
const [[, orchestratorFn]] = df.app.orchestration.mock.calls;

/**
 * Builds a mock durable context.
 *
 * callActivity and createTimer both return sentinel strings so the driver can
 * distinguish them. The driver (driveOrchestrator) feeds back the appropriate
 * value from `activityReturns` for each callActivity yield, and undefined for
 * each createTimer yield.
 */
function makeDfContext({ input, instanceId = 'inst-abc', currentUtcDateTime = new Date('2026-06-24T00:00:00Z') } = {}) {
  const activityCalls = [];
  const timerCalls = [];

  const dfContext = {
    getInput: jest.fn(() => input),
    instanceId,
    currentUtcDateTime,
    callActivity: jest.fn((name, actInput) => {
      activityCalls.push({ name, input: actInput });
      return `__activity__${name}`;
    }),
    createTimer: jest.fn((date) => {
      timerCalls.push(date);
      return '__timer__';
    }),
  };

  return { df: dfContext, activityCalls, timerCalls };
}

/**
 * Drives the orchestrator generator to completion.
 *
 * The generator yields sentinel strings produced by callActivity/createTimer.
 * We detect what was yielded and feed back the appropriate real value:
 * - '__timer__'           → feed back undefined (timer just resolves)
 * - '__activity__<Name>' → pop the next value from activityReturns
 *
 * This correctly interleaves timer steps and activity steps in the exact order
 * the orchestrator yields them.
 *
 * @param {Generator} gen
 * @param {Array} activityReturns  Values to return for each callActivity, in order.
 * @returns The generator's final return value.
 */
function driveOrchestrator(gen, activityReturns) {
  const queue = [...activityReturns];
  let step = gen.next(); // start

  while (!step.done) {
    const yielded = step.value;
    if (typeof yielded === 'string' && yielded.startsWith('__activity__')) {
      step = gen.next(queue.shift());
    } else {
      // Timer or unknown — feed back undefined
      step = gen.next(undefined);
    }
  }

  return step.value;
}

const BASE_INPUT = {
  repoFullName: 'org/repo',
  issueNumber: 42,
  issueTitle: 'Fix the bug',
  issueBody: 'It crashes',
  baseBranch: 'main',
  branchName: 'agent/issue-42',
};

describe('WorkflowOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('happy path: dispatched → poll (queued then completed/success) → completed', () => {
    it('completes with a PR URL, schedules a timer before each poll, no PostIssueComment', () => {
      const dispatchedAgent = {
        status: 'dispatched',
        dispatchedAt: '2026-06-24T00:00:00.000Z',
        messages: [{ role: 'user', content: 'issue' }],
        pendingToolUseId: 'tu-1',
        context: { owner: 'org', repo: 'repo' },
      };
      const completedResult = { status: 'completed', prUrl: 'https://github.com/org/repo/pull/5', summary: 'Done' };

      // Activity return order (timers are handled automatically by driveOrchestrator):
      // 1. PostSlackNotification → undefined
      // 2. StartAgentEdits → dispatched
      // 3. GetValidationStatus (first poll, after timer) → queued
      // 4. GetValidationStatus (second poll, after timer) → completed/success
      // 5. AgentReactToResult → completed
      const activityReturns = [
        undefined, // PostSlackNotification
        dispatchedAgent, // StartAgentEdits
        { status: 'queued', conclusion: null, runId: null, runUrl: null }, // GetValidationStatus poll 1
        { status: 'completed', conclusion: 'success', runId: 99, runUrl: 'https://runs/99' }, // GetValidationStatus poll 2
        completedResult, // AgentReactToResult
      ];

      const { df: dfCtx, activityCalls, timerCalls } = makeDfContext({ input: BASE_INPUT });
      const gen = orchestratorFn({ df: dfCtx });

      const finalResult = driveOrchestrator(gen, activityReturns);

      // Verify call sequence
      expect(activityCalls[0].name).toBe('PostSlackNotification');
      expect(activityCalls[1].name).toBe('StartAgentEdits');
      expect(activityCalls[2].name).toBe('GetValidationStatus');
      expect(activityCalls[3].name).toBe('GetValidationStatus');
      expect(activityCalls[4].name).toBe('AgentReactToResult');
      expect(activityCalls.length).toBe(5);

      // No PostIssueComment for success
      expect(activityCalls.every((c) => c.name !== 'PostIssueComment')).toBe(true);

      // A timer was scheduled before each poll (2 polls → 2 timers)
      expect(timerCalls.length).toBe(2);

      // Final result is the completed result
      expect(finalResult).toEqual(completedResult);
    });

    it('passes instanceId and full agent state to StartAgentEdits and AgentReactToResult', () => {
      const dispatchedAgent = {
        status: 'dispatched',
        dispatchedAt: '2026-06-24T00:00:00.000Z',
        messages: [{ role: 'user', content: 'msg' }],
        pendingToolUseId: 'tu-x',
        context: { owner: 'org' },
      };
      const completedResult = { status: 'completed', prUrl: 'https://github.com/org/repo/pull/1', summary: 'ok' };

      const activityReturns = [
        undefined,
        dispatchedAgent,
        { status: 'completed', conclusion: 'success', runId: 1, runUrl: 'https://runs/1' },
        completedResult,
      ];

      const { df: dfCtx, activityCalls } = makeDfContext({ input: BASE_INPUT, instanceId: 'my-inst' });
      const gen = orchestratorFn({ df: dfCtx });
      driveOrchestrator(gen, activityReturns);

      // StartAgentEdits gets instanceId
      expect(activityCalls[1].input).toMatchObject({ ...BASE_INPUT, instanceId: 'my-inst' });

      // GetValidationStatus gets repoFullName, branchName, dispatchedAt
      expect(activityCalls[2].input).toMatchObject({
        repoFullName: 'org/repo',
        branchName: 'agent/issue-42',
        dispatchedAt: '2026-06-24T00:00:00.000Z',
      });

      // AgentReactToResult gets the threaded state
      expect(activityCalls[3].input).toMatchObject({
        repoFullName: 'org/repo',
        issueNumber: 42,
        instanceId: 'my-inst',
        messages: dispatchedAgent.messages,
        pendingToolUseId: dispatchedAgent.pendingToolUseId,
        context: dispatchedAgent.context,
      });
    });
  });

  describe('failure path: AgentReactToResult → failed → PostIssueComment', () => {
    it('calls PostIssueComment with error body when AgentReactToResult fails', () => {
      const dispatchedAgent = {
        status: 'dispatched',
        dispatchedAt: '2026-06-24T00:00:00.000Z',
        messages: [],
        pendingToolUseId: 'tu-1',
        context: {},
      };
      const failedResult = { status: 'failed', summary: 'Agent run failed.', error: 'something went wrong' };

      const activityReturns = [
        undefined, // PostSlackNotification
        dispatchedAgent, // StartAgentEdits
        { status: 'completed', conclusion: 'failure', runId: 1, runUrl: 'https://runs/1' }, // GetValidationStatus
        failedResult, // AgentReactToResult
        undefined, // PostIssueComment
      ];

      const { df: dfCtx, activityCalls } = makeDfContext({ input: BASE_INPUT });
      const gen = orchestratorFn({ df: dfCtx });
      driveOrchestrator(gen, activityReturns);

      const issueCommentCall = activityCalls.find((c) => c.name === 'PostIssueComment');
      expect(issueCommentCall).toBeDefined();
      expect(issueCommentCall.input.repoFullName).toBe('org/repo');
      expect(issueCommentCall.input.issueNumber).toBe(42);
      expect(issueCommentCall.input.body).toContain('something went wrong');
      expect(issueCommentCall.input.body).toContain('Agent run failed');
    });
  });

  describe('re-dispatch path: AgentReactToResult → re-dispatched → second round → completed', () => {
    it('polls again in the second round and returns completed', () => {
      const dispatchedAgent = {
        status: 'dispatched',
        dispatchedAt: '2026-06-24T00:00:00.000Z',
        messages: [],
        pendingToolUseId: 'tu-1',
        context: {},
      };
      const reDispatchedAgent = {
        status: 're-dispatched',
        dispatchedAt: '2026-06-24T00:30:00.000Z',
        messages: [],
        pendingToolUseId: 'tu-2',
        context: {},
      };
      const completedResult = { status: 'completed', prUrl: 'https://github.com/org/repo/pull/2', summary: 'Done' };

      const activityReturns = [
        undefined, // PostSlackNotification
        dispatchedAgent, // StartAgentEdits (round 1)
        { status: 'completed', conclusion: 'failure', runId: 1, runUrl: 'https://runs/1' }, // GetValidationStatus (round 1)
        reDispatchedAgent, // AgentReactToResult (round 1) → re-dispatch
        { status: 'completed', conclusion: 'success', runId: 2, runUrl: 'https://runs/2' }, // GetValidationStatus (round 2)
        completedResult, // AgentReactToResult (round 2) → completed
      ];

      const { df: dfCtx, activityCalls, timerCalls } = makeDfContext({ input: BASE_INPUT });
      const gen = orchestratorFn({ df: dfCtx });
      const finalResult = driveOrchestrator(gen, activityReturns);

      // Second round polling happened
      const getValidationCalls = activityCalls.filter((c) => c.name === 'GetValidationStatus');
      expect(getValidationCalls.length).toBe(2);

      // Two AgentReactToResult calls
      const reactCalls = activityCalls.filter((c) => c.name === 'AgentReactToResult');
      expect(reactCalls.length).toBe(2);

      // Second react call uses re-dispatched agent state
      expect(reactCalls[1].input.pendingToolUseId).toBe('tu-2');

      // Two timers (one per poll)
      expect(timerCalls.length).toBe(2);

      // No PostIssueComment
      expect(activityCalls.every((c) => c.name !== 'PostIssueComment')).toBe(true);

      expect(finalResult).toEqual(completedResult);
    });
  });

  describe('MAX_ROUNDS guard', () => {
    it('terminates and posts a failure comment after exceeding MAX_ROUNDS', () => {
      // Each round: dispatch → 1 validation poll (completed/failure) → AgentReactToResult → re-dispatched
      // After MAX_ROUNDS (5), it should break and post a failure comment.

      const makeDispatchedAgent = (n) => ({
        status: n === 0 ? 'dispatched' : 're-dispatched',
        dispatchedAt: `2026-06-24T0${n}:00:00.000Z`,
        messages: [],
        pendingToolUseId: `tu-${n}`,
        context: {},
      });
      const makeValidation = () => ({ status: 'completed', conclusion: 'failure', runId: 1, runUrl: null });

      // Build the activity return queue:
      // StartAgentEdits returns dispatched (round 0)
      // Then 5 rounds where AgentReactToResult returns re-dispatched
      // On round 6 the MAX_ROUNDS guard fires before AgentReactToResult is called
      const activityReturns = [
        undefined, // PostSlackNotification
        makeDispatchedAgent(0), // StartAgentEdits
      ];

      // 5 full rounds (rounds 1-5): each has validation + re-dispatch from AgentReactToResult
      for (let i = 1; i <= 5; i++) {
        activityReturns.push(makeValidation()); // GetValidationStatus
        activityReturns.push(makeDispatchedAgent(i)); // AgentReactToResult → re-dispatched
      }
      // On 6th loop iteration rounds > MAX_ROUNDS triggers break → PostIssueComment
      activityReturns.push(undefined); // PostIssueComment

      const { df: dfCtx, activityCalls } = makeDfContext({ input: BASE_INPUT });
      const gen = orchestratorFn({ df: dfCtx });
      driveOrchestrator(gen, activityReturns);

      const issueCommentCall = activityCalls.find((c) => c.name === 'PostIssueComment');
      expect(issueCommentCall).toBeDefined();
      expect(issueCommentCall.input.body).toMatch(/max.*round/i);
    });
  });

  describe('determinism', () => {
    it('orchestrator source does not call Date.now or fetch directly', async () => {
      const { readFileSync } = await import('node:fs');
      const src = readFileSync(new URL('../src/functions/WorkflowOrchestrator.js', import.meta.url), 'utf8');
      // Must not call Date.now() in orchestrator body
      expect(src).not.toMatch(/\bDate\.now\s*\(/);
      // Must not call fetch directly
      expect(src).not.toMatch(/\bfetch\s*\(/);
    });
  });
});
