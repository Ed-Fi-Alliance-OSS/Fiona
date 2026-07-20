// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { feedbackReasonClosedCallback, feedbackReasonViewCallback } from './feedback_reason.js';
import { TICKET_MODAL_CALLBACK, ticketModalSubmitCallback } from './ticket_modal.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  app.view('feedback_reason', feedbackReasonViewCallback);
  app.view({ callback_id: 'feedback_reason', type: 'view_closed' }, feedbackReasonClosedCallback);
  app.view(TICKET_MODAL_CALLBACK, ticketModalSubmitCallback);
};
