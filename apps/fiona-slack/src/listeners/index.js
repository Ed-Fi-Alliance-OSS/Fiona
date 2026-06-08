// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import * as actions from './actions/index.js';
import * as assistant from './assistant/index.js';
import * as commands from './commands/index.js';
import * as events from './events/index.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const registerListeners = (app) => {
  actions.register(app);
  events.register(app);
  assistant.register(app);
  commands.register(app);
};
