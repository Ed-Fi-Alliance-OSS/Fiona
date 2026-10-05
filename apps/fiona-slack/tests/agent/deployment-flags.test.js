// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, beforeEach } from '@jest/globals';

const { isEscalationEnabled, isTicketingFeatureEnabled } = await import('../../src/agent/deployment-flags.js');

describe('isTicketingFeatureEnabled', () => {
  beforeEach(() => {
    delete process.env.TICKET_CREATION_ENABLED;
  });

  it('is false when TICKET_CREATION_ENABLED is unset', () => {
    expect(isTicketingFeatureEnabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    process.env.TICKET_CREATION_ENABLED = 'true';
    expect(isTicketingFeatureEnabled()).toBe(true);
  });

  it('is false for "false"', () => {
    process.env.TICKET_CREATION_ENABLED = 'false';
    expect(isTicketingFeatureEnabled()).toBe(false);
  });

  // A GitHub Actions variable left blank, or a bicep param defaulted to '', both
  // arrive as an empty string rather than an absent var.
  it('is false for an empty string', () => {
    process.env.TICKET_CREATION_ENABLED = '';
    expect(isTicketingFeatureEnabled()).toBe(false);
  });

  it('is false for a truthy-looking value that is not "true"', () => {
    process.env.TICKET_CREATION_ENABLED = 'TRUE';
    expect(isTicketingFeatureEnabled()).toBe(false);
  });
});

describe('isEscalationEnabled', () => {
  beforeEach(() => {
    delete process.env.ESCALATION_ENABLED;
  });

  it('is false when ESCALATION_ENABLED is unset', () => {
    expect(isEscalationEnabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    process.env.ESCALATION_ENABLED = 'true';
    expect(isEscalationEnabled()).toBe(true);
  });

  it('is false for "false"', () => {
    process.env.ESCALATION_ENABLED = 'false';
    expect(isEscalationEnabled()).toBe(false);
  });

  it('is false for an empty string', () => {
    process.env.ESCALATION_ENABLED = '';
    expect(isEscalationEnabled()).toBe(false);
  });

  it('is independent of the ticketing flag', () => {
    process.env.TICKET_CREATION_ENABLED = 'true';
    expect(isEscalationEnabled()).toBe(false);
  });
});
