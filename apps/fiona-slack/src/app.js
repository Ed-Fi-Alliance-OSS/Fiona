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

const LEVEL_ORDER = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];

/**
 * Creates a Bolt-compatible logger that writes each log call as a single line.
 * Azure's log stream displays each stdout line as a separate log entry, so
 * multi-line Error stacks cause interleaved, unreadable output when multiple
 * async operations log concurrently. This logger replaces literal newlines with
 * the two-character sequence "\n" so every entry stays on one line.
 *
 * @param {import('@slack/bolt').LogLevel} initialLevel
 * @returns {import('@slack/logger').Logger}
 */
function createSingleLineLogger(initialLevel) {
  let currentLevel = initialLevel;
  let name = '';

  function shouldLog(level) {
    return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(currentLevel);
  }

  function flatten(arg) {
    if (arg instanceof Error) {
      return (arg.stack ?? String(arg)).replace(/\n/g, '\\n');
    }
    if (typeof arg === 'string') {
      return arg.replace(/\n/g, '\\n');
    }
    return arg;
  }

  function write(level, consoleFn, args) {
    if (!shouldLog(level)) return;
    const prefix = `[${level.toUpperCase()}]${name ? ` ${name}` : ''}`;
    consoleFn(prefix, ...args.map(flatten));
  }

  return {
    debug: (...args) => write(LogLevel.DEBUG, console.debug, args),
    info: (...args) => write(LogLevel.INFO, console.info, args),
    warn: (...args) => write(LogLevel.WARN, console.warn, args),
    error: (...args) => write(LogLevel.ERROR, console.error, args),
    setLevel: (level) => { currentLevel = level; },
    getLevel: () => currentLevel,
    setName: (n) => { name = n; },
  };
}

const logLevel = LOG_LEVEL_MAP[process.env.LOG_LEVEL?.toLowerCase()] ?? LogLevel.INFO;

// Initialize the Bolt app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logger: createSingleLineLogger(logLevel),
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

async function shutdown(signal) {
  app.logger.info(`Received ${signal}, shutting down...`);
  const forceExit = setTimeout(() => {
    app.logger.warn('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 5000);
  forceExit.unref();
  try {
    await app.stop();
  } catch (error) {
    app.logger.error('Error during shutdown', error);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
