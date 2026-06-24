// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { createHmac } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { validateWebhookSignature } from '../src/lib/webhook-validator.js';

const SECRET = 'test-webhook-secret';
const BODY = '{"action":"labeled","label":{"name":"agent-ready"}}';

function sign(body, secret) {
  const hash = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hash}`;
}

describe('validateWebhookSignature', () => {
  it('returns true for a valid HMAC-SHA256 signature', () => {
    expect(validateWebhookSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('returns false when the signature was made with a different secret', () => {
    expect(validateWebhookSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('returns false when the body has been tampered with', () => {
    const tampered = BODY + ' ';
    expect(validateWebhookSignature(tampered, sign(BODY, SECRET), SECRET)).toBe(false);
  });

  it('returns false when signature is undefined', () => {
    expect(validateWebhookSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('returns false when signature is missing the sha256= prefix', () => {
    const raw = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(validateWebhookSignature(BODY, raw, SECRET)).toBe(false);
  });

  it('returns false when signature is an empty string', () => {
    expect(validateWebhookSignature(BODY, '', SECRET)).toBe(false);
  });
});
