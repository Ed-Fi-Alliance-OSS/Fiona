// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CosmosClient } from '@azure/cosmos';
import { app } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import axios from 'axios';
import { resolveWeeklyReportWindow } from '../lib/activity-records.js';
import { getRepresentativeFeedbackInRange } from '../lib/cosmos-queries.js';
import { getSlackWebhookUrl } from '../lib/key-vault-client.js';
import { getKpiSummary } from '../lib/kpi-summary.js';
import { getLatestReportLink } from '../lib/report-link.js';
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
const COSMOS_USERS_CONTAINER = process.env.COSMOS_USERS_CONTAINER || 'slack-users';
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
const usersContainer = database.container(COSMOS_USERS_CONTAINER);

app.timer('WeeklyReportTrigger', {
  schedule: '%REPORT_SCHEDULE%',
  handler: async (_myTimer, context) => {
    const logger = context.log.bind(context);
    logger('Weekly report function triggered');

    try {
      // Every figure below covers the same 7 whole UTC days shown in the report label
      const { startISO, endISO, startDate, endDate } = resolveWeeklyReportWindow(new Date());

      logger(`Querying KPIs from Cosmos DB for [${startISO}, ${endISO})...`);
      const [kpiSummary, representativeFeedback] = await Promise.all([
        getKpiSummary(interactionsContainer, feedbackContainer, DEPLOYMENT_TYPE, startISO, endISO, {
          usersContainer,
          warn: context.warn.bind(context),
        }),
        getRepresentativeFeedbackInRange(feedbackContainer, DEPLOYMENT_TYPE, startISO, endISO),
      ]);

      logger(
        `Sessions: ${kpiSummary.sessions}, Total Interactions: ${kpiSummary.totalInteractions}, Unique Users: ${kpiSummary.uniqueUsers}`,
      );
      logger(`Errors: ${kpiSummary.errors}, Rate Limited: ${kpiSummary.rateLimited}`);

      const reportUrl = await getLatestReportLink(
        { deploymentType: DEPLOYMENT_TYPE, weekEnd: endDate },
        { warn: logger },
      );

      const kpis = {
        ...kpiSummary,
        environment: DEPLOYMENT_TYPE,
        startDate,
        endDate,
        representativeFeedback,
        reportUrl,
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
