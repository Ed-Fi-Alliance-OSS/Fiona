// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CREATE_TICKET_ACTION } from '../commands/command-handler.js';
import { createTicketActionCallback } from './create_ticket.js';
import { feedbackActionCallback } from './feedback.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  app.action('feedback', feedbackActionCallback);
  app.action(CREATE_TICKET_ACTION, createTicketActionCallback);
};
