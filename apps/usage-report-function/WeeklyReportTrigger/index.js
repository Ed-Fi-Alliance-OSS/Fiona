// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { app } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import axios from 'axios';
import {
  getAvgInteractionsPerUser,
  getDistinctUsers,
  getErrorCount,
  getFeedbackBreakdown,
  getFeedbackResponseRate,
  getNewUsersCount,
  getRateLimitedCount,
  getRepresentativeFeedback,
  getSessionCount,
  getTotalInteractions,
} from '../lib/cosmos-queries.js';
import { getSlackWebhookUrl } from '../lib/key-vault-client.js';
import { formatWeeklyReport } from '../lib/slack-formatter.js';

// Configure axios instance with timeout and retry policy
const axiosInstance = axios.create({
  timeout: 10000, // 10 second timeout
  maxRedirects: 0,
});

// Add retry interceptor for transient failures
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, code } = error;
    const maxRetries = 3;
    config.retryCount = config.retryCount || 0;

    // Retry on network errors or 5xx status codes
    const isRetryable =
      !error.response ||
      (error.response.status >= 500 && error.response.status < 600) ||
      code === 'ECONNABORTED' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT';

    if (isRetryable && config.retryCount < maxRetries) {
      config.retryCount += 1;
      const delayMs = 2 ** (config.retryCount - 1) * 500; // Exponential backoff: 500ms, 1s, 2s
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return axiosInstance(config);
    }

    return Promise.reject(error);
  },
);

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'chatbot';
const COSMOS_INTERACTIONS_CONTAINER = process.env.COSMOS_INTERACTIONS_CONTAINER || 'interactions';
const COSMOS_FEEDBACK_CONTAINER = process.env.COSMOS_FEEDBACK_CONTAINER || 'feedback';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'production';
const SLACK_WEBHOOK_SECRET_NAME = process.env.SLACK_WEBHOOK_KEYVAULT_SECRET_NAME || 'slack-fiona-weekly-report-webhook';

// Validate required configuration
if (!COSMOS_ENDPOINT) {
  throw new Error('Required environment variable COSMOS_ENDPOINT is not set');
}
if (typeof COSMOS_ENDPOINT !== 'string' || COSMOS_ENDPOINT.trim() === '') {
  throw new Error('COSMOS_ENDPOINT must be a non-empty string');
}
const isConnectionString = COSMOS_ENDPOINT.includes('AccountKey=');
const isValidUrl = COSMOS_ENDPOINT.startsWith('https://');
if (!isConnectionString && !isValidUrl) {
  throw new Error('COSMOS_ENDPOINT must be either a connection string (containing AccountKey=) or a valid HTTPS URL');
}

const cosmosClient = COSMOS_ENDPOINT.includes('AccountKey=')
  ? new CosmosClient(COSMOS_ENDPOINT)
  : new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential() });
const database = cosmosClient.database(COSMOS_DATABASE);
const interactionsContainer = database.container(COSMOS_INTERACTIONS_CONTAINER);
const feedbackContainer = database.container(COSMOS_FEEDBACK_CONTAINER);

app.timer('WeeklyReportTrigger', {
  schedule: '%REPORT_SCHEDULE%',
  handler: async (_myTimer, context) => {
    const logger = context.log.bind(context);
    logger('Weekly report function triggered');

    try {
      // Calculate lookback window (past 7 days)
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneWeekAgoISO = oneWeekAgo.toISOString();

      // Query all KPIs in parallel
      logger('Querying KPIs from Cosmos DB...');
      const [
        distinctUsers,
        sessionCount,
        totalInteractions,
        errorCount,
        rateLimitedCount,
        feedbackBreakdown,
        avgInteractionsPerUser,
        feedbackResponseRate,
        newUsersCount,
        representativeFeedback,
      ] = await Promise.all([
        getDistinctUsers(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getSessionCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getTotalInteractions(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getErrorCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getRateLimitedCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getFeedbackBreakdown(feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getAvgInteractionsPerUser(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getFeedbackResponseRate(interactionsContainer, feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getNewUsersCount(interactionsContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
        getRepresentativeFeedback(feedbackContainer, DEPLOYMENT_TYPE, oneWeekAgoISO),
      ]);

      logger(
        `Session Count: ${sessionCount}, Total Interactions: ${totalInteractions}, Distinct Users: ${distinctUsers}`,
      );
      logger(`Error Count: ${errorCount}, Rate Limited Count: ${rateLimitedCount}`);

      // Parse feedback counts
      const goodFeedback = feedbackBreakdown.find((f) => f.feedbackValue === 'good-feedback')?.count ?? 0;
      const badFeedback = feedbackBreakdown.find((f) => f.feedbackValue === 'bad-feedback')?.count ?? 0;
      const feedbackRatio = goodFeedback + badFeedback > 0 ? (goodFeedback / (goodFeedback + badFeedback)) * 100 : 0;
      const errorRate = totalInteractions > 0 ? (errorCount / totalInteractions) * 100 : 0;
      const newUserPercentage = distinctUsers > 0 ? (newUsersCount / distinctUsers) * 100 : 0;
      const returningUsersCount = distinctUsers - newUsersCount;
      const repeatRate = distinctUsers > 0 ? 100 - newUserPercentage : 0;

      // Build week label dates
      const endOfReport = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const kpis = {
        distinctUsers,
        sessionCount,
        totalInteractions,
        errorCount,
        errorRate,
        rateLimitedCount,
        goodFeedback,
        badFeedback,
        feedbackRatio,
        avgInteractionsPerUser,
        feedbackResponseRate,
        newUsersCount,
        newUserPercentage,
        returningUsersCount,
        repeatRate,
        environment: DEPLOYMENT_TYPE,
        startDate: oneWeekAgo.toISOString().split('T')[0],
        endDate: endOfReport.toISOString().split('T')[0],
        representativeFeedback,
      };

      const message = formatWeeklyReport(kpis);
      logger(`Report formatted: ${message.substring(0, 100)}...`);

      if (process.env.SLACK_DRY_RUN === 'true') {
        logger(`Dry-run mode — skipping Slack post. Full report:\n${message}`);
        return;
      }

      // Post to Slack via webhook
      const webhookUrl = await getSlackWebhookUrl(SLACK_WEBHOOK_SECRET_NAME, {
        error: logger,
      });
      logger('Retrieved webhook URL from Key Vault, posting to Slack...');

      await axiosInstance.post(webhookUrl, { text: message });

      logger('Weekly report posted successfully');
    } catch (error) {
      context.error(`Error generating weekly report: ${error.message}`);
      context.error(error.stack);
    }
  },
});
