// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals';

// Mock dotenv so the test file's CWD doesn't need a real .env
jest.unstable_mockModule('dotenv', () => ({ config: jest.fn() }));

// Mock the store so processUser doesn't attempt real Cosmos writes
const mockUpsertUser = jest.fn().mockResolvedValue(true);
jest.unstable_mockModule('../../src/agent/slack-users-store.js', () => ({
  ensureStoreReady: jest.fn().mockResolvedValue(true),
  upsertUser: mockUpsertUser,
}));

let mapApiMember, mapCsvRow, _resetCounters;

beforeAll(async () => {
  ({ mapApiMember, mapCsvRow, _resetCounters } = await import('../../scripts/load-slack-users.js'));
});

beforeEach(() => {
  mockUpsertUser.mockClear();
  mockUpsertUser.mockResolvedValue(true);
  _resetCounters();
});

// ── mapApiMember ──────────────────────────────────────────────────────────

describe('mapApiMember', () => {
  const raw = {
    id: 'U98765',
    team_id: 'T11111',
    name: 'jdoe',
    real_name: 'John Doe (fallback)',
    is_bot: false,
    is_admin: true,
    is_owner: false,
    deleted: false,
    profile: {
      real_name: 'John Doe',
      display_name: 'johnd',
      email: 'jdoe@example.com',
    },
  };

  it('maps id and userId from member.id', () => {
    const u = mapApiMember(raw);
    expect(u.id).toBe('U98765');
    expect(u.userId).toBe('U98765');
  });

  it('maps teamId from team_id', () => {
    expect(mapApiMember(raw).teamId).toBe('T11111');
  });

  it('prefers profile.real_name over member.real_name', () => {
    expect(mapApiMember(raw).realName).toBe('John Doe');
  });

  it('maps email from profile.email', () => {
    expect(mapApiMember(raw).email).toBe('jdoe@example.com');
  });

  it('maps boolean flags', () => {
    const u = mapApiMember(raw);
    expect(u.isBot).toBe(false);
    expect(u.isAdmin).toBe(true);
    expect(u.isOwner).toBe(false);
    expect(u.deleted).toBe(false);
  });

  it('coerces missing fields to empty string / false', () => {
    const u = mapApiMember({});
    expect(u.id).toBe('');
    expect(u.email).toBe('');
    expect(u.isBot).toBe(false);
  });
});

// ── mapCsvRow ─────────────────────────────────────────────────────────────

describe('mapCsvRow', () => {
  const row = {
    userid: 'U55555',
    username: 'jsmith',
    fullname: 'Jane Smith',
    displayname: 'jsmith',
    email: 'jsmith@example.com',
    status: 'Active',
  };

  it('maps id and userId from userid column', () => {
    const u = mapCsvRow(row);
    expect(u.id).toBe('U55555');
    expect(u.userId).toBe('U55555');
  });

  it('maps name from username column', () => {
    expect(mapCsvRow(row).name).toBe('jsmith');
  });

  it('maps realName from fullname column', () => {
    expect(mapCsvRow(row).realName).toBe('Jane Smith');
  });

  it('sets deleted=false when status is Active', () => {
    expect(mapCsvRow(row).deleted).toBe(false);
  });

  it('sets deleted=true when status is Deactivated', () => {
    expect(mapCsvRow({ ...row, status: 'Deactivated' }).deleted).toBe(true);
  });

  it('sets deleted=true case-insensitively', () => {
    expect(mapCsvRow({ ...row, status: 'deactivated' }).deleted).toBe(true);
  });

  it('sets isBot=false (not present in CSV exports)', () => {
    expect(mapCsvRow(row).isBot).toBe(false);
  });

  it('sets teamId to empty string (not present in CSV exports)', () => {
    expect(mapCsvRow(row).teamId).toBe('');
  });
});
