// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

function hasVisibleConversation(feedbackItem) {
  const hasQuestion = typeof feedbackItem.userMessage === 'string' && feedbackItem.userMessage.trim() !== '';
  const hasAnswer = typeof feedbackItem.botResponse === 'string' && feedbackItem.botResponse.trim() !== '';
  return hasQuestion || hasAnswer;
}

/**
 * Returns an unfiltered, chronological (newest-first) feedback listing for
 * [startISO, endISO), capped at `limit`. Unlike
 * `getRepresentativeFeedbackInRange` (5 items, reason-prioritized, for
 * qualitative highlights), this is a plain recency-ordered listing for the PDF report's
 * Feedback Details table.
 */
export async function getFeedbackDetails(container, deploymentType, startISO, endISO, limit = 25) {
  const { resources } = await container.items
    .query({
      // `value` is a reserved word in Cosmos DB SQL; aliasing to it (`AS value`) returns 400 BadRequest.
      query: `SELECT f.timestamp, f.userId, f["value"] AS feedbackValue, f.userMessage, f.botResponse
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp >= @startISO
         AND f.timestamp < @endISO
       ORDER BY f.timestamp DESC`,
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@startISO', value: startISO },
        { name: '@endISO', value: endISO },
      ],
    })
    .fetchAll();

  return resources.slice(0, limit).map((f) => ({
    timestamp: f.timestamp,
    userId: f.userId,
    value: f.feedbackValue,
    userMessage: f.userMessage,
    botResponse: f.botResponse,
  }));
}

/**
 * Returns up to `limit` representative feedback entries for [startISO, endISO),
 * prioritizing entries that have a free-text reason (most recent first),
 * then filling remaining slots with reason-less entries (most recent first).
 * Used by both the weekly Slack report and the executive PDF report.
 */
export async function getRepresentativeFeedbackInRange(container, deploymentType, startISO, endISO, limit = 5) {
  const { resources } = await container.items
    .query({
      query: `SELECT f.userId, f.userMessage, f.botResponse, f["value"], f.reason, f.timestamp
       FROM feedback f
       WHERE f.deploymentType = @deploymentType
         AND f.timestamp >= @startISO
         AND f.timestamp < @endISO
       ORDER BY f.timestamp DESC`,
      parameters: [
        { name: '@deploymentType', value: deploymentType },
        { name: '@startISO', value: startISO },
        { name: '@endISO', value: endISO },
      ],
    })
    .fetchAll();

  const visibleConversation = resources.filter(hasVisibleConversation);
  const withReason = visibleConversation.filter((f) => f.reason);
  const withoutReason = visibleConversation.filter((f) => !f.reason);

  return [...withReason, ...withoutReason].slice(0, limit).map((f) => ({
    userId: f.userId,
    userMessage: f.userMessage,
    botResponse: f.botResponse,
    value: f.value,
    reason: f.reason ?? null,
    timestamp: f.timestamp,
    hasReason: Boolean(f.reason),
  }));
}
