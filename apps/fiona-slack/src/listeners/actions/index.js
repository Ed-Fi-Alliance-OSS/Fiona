// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { CREATE_TICKET_ACTION } from '../commands/command-handler.js';
import { TICKET_TYPE_ACTION } from '../views/ticket_modal.js';
import { createTicketActionCallback } from './create_ticket.js';
import { feedbackActionCallback } from './feedback.js';
import {
  TICKET_APPROVE_ACTION,
  TICKET_DISCARD_ACTION,
  ticketApproveActionCallback,
  ticketDiscardActionCallback,
} from './ticket_approval.js';
import { ticketTypeActionCallback } from './ticket_type.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  app.action('feedback', feedbackActionCallback);
  app.action(CREATE_TICKET_ACTION, createTicketActionCallback);
  app.action(TICKET_APPROVE_ACTION, ticketApproveActionCallback);
  app.action(TICKET_DISCARD_ACTION, ticketDiscardActionCallback);
  app.action(TICKET_TYPE_ACTION, ticketTypeActionCallback);
};
