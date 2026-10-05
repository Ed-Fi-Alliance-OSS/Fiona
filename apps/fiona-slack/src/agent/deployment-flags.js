// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Deployment kill switches for the ticket-creation and escalation features
// (AI-217). MSDF tech asked that neither go live until the team has evaluated
// alternatives for the Salesforce / Slack / Jira / GitHub gap, so both default
// to OFF: only the exact string 'true' turns a feature on. An unset, blank or
// misspelled variable leaves the feature dark, which is the safe direction.
//
// This module deliberately imports nothing. Both the agent layer
// (escalation.js, ticket-service.js) and the listener layer (command-handler.js,
// fiona.js) need these predicates, and any shared home that itself imported from
// either layer would close an import cycle — the one just untangled in AI-203.
//
// Changing a flag requires a restart; these are container-app environment
// variables, not runtime configuration. That is the deliberate difference from
// the Cosmos-backed `isFeatureEnabled` proposed in the feature-flags branch,
// which resolves per user and flips fleet-wide in ~30s without a redeploy. The
// two answer different questions and are meant to coexist:
//
//   deployment-flags.js  — is this feature built into this deployment at all?
//                          A hard kill switch. Works with Cosmos unreachable,
//                          because it reads only the process environment.
//   feature-flags.js     — should this user see this feature right now?
//                          Gradual rollout and per-user beta gating.
//
// A kill switch that depended on a database reachable would be a kill switch
// that can fail open, which is the wrong failure direction for AI-217.

/** True when the ticket-creation feature is switched on for this deployment. */
export function isTicketingFeatureEnabled() {
  return process.env.TICKET_CREATION_ENABLED === 'true';
}

/** True when the escalation feature is switched on for this deployment. */
export function isEscalationEnabled() {
  return process.env.ESCALATION_ENABLED === 'true';
}
