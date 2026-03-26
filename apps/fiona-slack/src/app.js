// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { registerListeners } from './listeners/index.js';

const LOG_LEVEL_MAP = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

const logLevel = LOG_LEVEL_MAP[process.env.LOG_LEVEL?.toLowerCase()] ?? LogLevel.INFO;

// Initialize the Bolt app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel,
  clientOptions: {
    slackApiUrl: process.env.SLACK_API_URL || 'https://slack.com/api',
  },
});

// Register the action and event listeners
registerListeners(app);

// Start the Bolt app
(async () => {
  try {
    await app.start();
    app.logger.info('⚡️ Bolt app is running!');
  } catch (error) {
    app.logger.error('Failed to start the app', error);
    process.exit(1);
  }
})();
