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
