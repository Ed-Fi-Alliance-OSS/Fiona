// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, expect, it, jest } from '@jest/globals';
import {
  getUserDirectory,
  INTERNAL_EMAIL_DOMAIN,
  requireUserDirectory,
  SEGMENT_KEYS,
  segmentForEmail,
  segmentOf,
  tryGetUserDirectory,
} from '../../lib/user-segments.js';

/** Fake users container that honors the @userIds parameter like Cosmos does. */
function usersContainer(users, id = 'slack-users') {
  const query = jest.fn((spec) => {
    const ids = spec.parameters.find((p) => p.name === '@userIds').value;
    return { fetchAll: async () => ({ resources: users.filter((user) => ids.includes(user.id)) }) };
  });
  return { id, items: { query } };
}

function failingContainer(error, id = 'slack-users') {
  return { id, items: { query: jest.fn(() => ({ fetchAll: jest.fn().mockRejectedValue(error) })) } };
}

const cosmosError = (code, message = 'Forbidden: secret request details') =>
  Object.assign(new Error(message), { code });

describe('constants', () => {
  it('defines the internal domain and segment order', () => {
    expect(INTERNAL_EMAIL_DOMAIN).toBe('ed-fi.org');
    expect(SEGMENT_KEYS).toEqual(['internal', 'external', 'unknown']);
  });
});

describe('segmentForEmail', () => {
  it.each([
    ['person@ed-fi.org', 'internal'],
    ['  Person@ED-FI.ORG  ', 'internal'],
    [' A@ED-FI.ORG ', 'internal'],
    ['member@sub.ed-fi.org', 'external'],
    ['person@outside.org', 'external'],
    ['x@ed-fi.org.evil.com', 'external'],
    ['a@evil-ed-fi.org', 'external'],
    ['a@ed-fi.org.', 'external'], // trailing dot is a different domain string, never internal
    ['evil-ed-fi.org', 'unknown'],
    ['a@ed-fi.org@evil.com', 'unknown'],
    ['a b@ed-fi.org', 'unknown'],
    ['not-an-email', 'unknown'],
    ['@ed-fi.org', 'unknown'],
    ['', 'unknown'],
    ['   ', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    [123, 'unknown'],
    [{}, 'unknown'],
  ])('classifies %p as %s', (email, segment) => {
    expect(segmentForEmail(email)).toBe(segment);
  });
});

describe('segmentOf', () => {
  it('falls back to unknown for users missing from the directory or a null directory', () => {
    const directory = new Map([['a', 'internal']]);
    expect(segmentOf(directory, 'a')).toBe('internal');
    expect(segmentOf(directory, 'missing')).toBe('unknown');
    expect(segmentOf(directory, undefined)).toBe('unknown');
    expect(segmentOf(null, 'a')).toBe('unknown');
  });
});

describe('getUserDirectory', () => {
  it('maps user IDs to segments only, never emails', async () => {
    const warn = jest.fn();
    const users = usersContainer([
      { id: 'a', email: '  Person@ED-FI.ORG  ' },
      { id: 'b', email: 'member@sub.ed-fi.org' },
      { id: 'c', email: 'c@outside.org' },
      { id: 'd', email: 'd@outside.org' },
    ]);
    const directory = await getUserDirectory(users, ['a', 'b', 'c', 'd', 'a', null], warn);
    expect([...directory.entries()]).toEqual([
      ['a', 'internal'],
      ['b', 'external'],
      ['c', 'external'],
      ['d', 'external'],
    ]);
    expect(users.items.query.mock.calls[0][0].parameters[0].value).toEqual(['a', 'b', 'c', 'd']);
    expect(JSON.stringify([...directory])).not.toContain('@');
    expect(warn).not.toHaveBeenCalled();
  });

  it('classifies directory records with a missing or null email as unknown', async () => {
    const users = usersContainer([
      { id: 'a', email: 'a@ed-fi.org' },
      { id: 'b', email: 'b@outside.org' },
      { id: 'c', email: 'c@outside.org' },
      { id: 'd', email: 'd@outside.org' },
      { id: 'noEmail' },
    ]);
    const directory = await getUserDirectory(users, ['a', 'b', 'c', 'd', 'noEmail'], jest.fn());
    expect(directory.get('noEmail')).toBe('unknown');
    const nullEmail = await getUserDirectory(usersContainer([{ id: 'n', email: null }]), ['n'], jest.fn());
    expect(nullEmail.get('n')).toBe('unknown');
  });

  it('skips the query when there are no user IDs', async () => {
    const users = usersContainer([]);
    expect((await getUserDirectory(users, [null, undefined], jest.fn())).size).toBe(0);
    expect(users.items.query).not.toHaveBeenCalled();
  });

  it('queries in chunks of at most 500 IDs and merges the results', async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => `u${i}`);
    const users = usersContainer(ids.map((id) => ({ id, email: `${id}@outside.org` })));
    const directory = await getUserDirectory(users, ids, jest.fn());
    const chunkSizes = users.items.query.mock.calls.map(([spec]) => spec.parameters[0].value.length);
    expect(chunkSizes).toEqual([500, 500, 201]);
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(500);
    expect(directory.size).toBe(1201);
    expect(directory.get('u1200')).toBe('external');
  });

  it('warns when the directory resolves none of the users', async () => {
    const warn = jest.fn();
    const directory = await getUserDirectory(usersContainer([]), ['a', 'b'], warn);
    expect(directory.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'slack-users' resolved 0 of 2 users"));
  });

  it('warns when more than 25% of users stay Unknown', async () => {
    const warn = jest.fn();
    await getUserDirectory(
      usersContainer([
        { id: 'a', email: 'a@ed-fi.org' },
        { id: 'b', email: '' },
      ]),
      ['a', 'b', 'missing'],
      warn,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('left 2 of 3 users Unknown'));
  });

  it('does not warn at exactly 25% Unknown', async () => {
    const warn = jest.fn();
    await getUserDirectory(
      usersContainer([
        { id: 'a', email: 'a@ed-fi.org' },
        { id: 'b', email: 'b@outside.org' },
        { id: 'c', email: 'c@outside.org' },
      ]),
      ['a', 'b', 'c', 'missing'],
      warn,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('tryGetUserDirectory', () => {
  it('returns null without querying when no users container is configured', async () => {
    const warn = jest.fn();
    expect(await tryGetUserDirectory(undefined, ['a'], warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns null and warns with the container and status, not the raw error message, on a Cosmos error', async () => {
    const warn = jest.fn();
    expect(await tryGetUserDirectory(failingContainer(cosmosError(403)), ['a'], warn)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0];
    expect(message).toContain("'slack-users'");
    expect(message).toContain('status 403');
    expect(message).not.toContain('secret request details');
  });

  it('treats an error with a numeric statusCode as a Cosmos error', async () => {
    const warn = jest.fn();
    const error = Object.assign(new Error('not found'), { statusCode: 404 });
    expect(await tryGetUserDirectory(failingContainer(error, 'users-x'), ['a'], warn)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/'users-x'.*status 404/));
  });

  it('rethrows non-Cosmos (programming) errors', async () => {
    const warn = jest.fn();
    const bug = new TypeError('x is not a function');
    await expect(tryGetUserDirectory(failingContainer(bug), ['a'], warn)).rejects.toBe(bug);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns the directory when the query succeeds', async () => {
    const directory = await tryGetUserDirectory(usersContainer([{ id: 'a', email: 'x@ed-fi.org' }]), ['a'], jest.fn());
    expect(directory.get('a')).toBe('internal');
  });
});

describe('requireUserDirectory', () => {
  it('returns the directory when the query succeeds', async () => {
    const directory = await requireUserDirectory(usersContainer([{ id: 'a', email: 'a@ed-fi.org' }]), ['a'], jest.fn());
    expect(directory.get('a')).toBe('internal');
  });

  it('throws a clear error naming the container and status, keeping the Cosmos error as cause', async () => {
    const original = cosmosError(403);
    const error = await requireUserDirectory(failingContainer(original), ['a'], jest.fn()).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("'slack-users'");
    expect(error.message).toContain('status 403');
    expect(error.message).toContain('not generating a report');
    expect(error.cause).toBe(original);
  });

  it('rethrows non-Cosmos errors as-is', async () => {
    const bug = new TypeError('boom');
    await expect(requireUserDirectory(failingContainer(bug), ['a'], jest.fn())).rejects.toBe(bug);
  });
});

describe('directory failure classification', () => {
  const timeoutError = Object.assign(new Error('Timed out'), { name: 'TimeoutError', code: 'TimeoutError' });
  const networkError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const credentialError = Object.assign(new Error('no managed identity'), { name: 'CredentialUnavailableError' });

  it.each([
    ['a Cosmos timeout (string code)', timeoutError, 'status TimeoutError'],
    ['a network error (string code)', networkError, 'status ECONNRESET'],
    ['a credential failure (no code)', credentialError, 'status CredentialUnavailableError'],
    ['throttling (429)', cosmosError(429), 'status 429'],
  ])('treats %s as unavailable: Slack falls back, the PDF fails', async (_label, error, detail) => {
    const warn = jest.fn();
    await expect(tryGetUserDirectory(failingContainer(error), ['U1'], warn)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(detail));
    await expect(requireUserDirectory(failingContainer(error), ['U1'], warn)).rejects.toThrow(detail);
  });

  it('rethrows a Cosmos 400 BadRequest, which means the query itself is broken', async () => {
    const badRequest = cosmosError(400, 'Syntax error near value');
    await expect(tryGetUserDirectory(failingContainer(badRequest), ['U1'], jest.fn())).rejects.toBe(badRequest);
    await expect(requireUserDirectory(failingContainer(badRequest), ['U1'], jest.fn())).rejects.toBe(badRequest);
  });

  it('describes an error with no code or name as an unknown error', async () => {
    const warn = jest.fn();
    await expect(tryGetUserDirectory(failingContainer({}), ['U1'], warn)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown error'));
  });
});

describe('transport failures surfaced as TypeError', () => {
  const fetchFailed = () =>
    new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });

  it('treats `TypeError: fetch failed` with a cause as an unavailable directory in the Slack path', async () => {
    const warn = jest.fn();
    await expect(tryGetUserDirectory(failingContainer(fetchFailed()), ['U1'], warn)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'slack-users' unavailable"));
  });

  it('fails the PDF path with an "unavailable" error', async () => {
    await expect(requireUserDirectory(failingContainer(fetchFailed()), ['U1'], jest.fn())).rejects.toThrow(
      'unavailable',
    );
  });

  it('still rethrows a plain TypeError, which is a bug in our code', async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'id')");
    await expect(tryGetUserDirectory(failingContainer(bug), ['U1'], jest.fn())).rejects.toBe(bug);
    await expect(requireUserDirectory(failingContainer(bug), ['U1'], jest.fn())).rejects.toBe(bug);
  });
});
