// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const { checkUrls, clearLinkCheckCache, LINK_CHECK_USER_AGENT } = await import(
  '../../../src/agent/utils/link-checker.js'
);

const ALLOWED = ['www.ed-fi.org', 'docs.ed-fi.org'];
const DOCS = 'https://docs.ed-fi.org';

/** fetch mock: `routes` maps "METHOD url" (or url, for any method) to a status or an Error to throw. */
function fakeFetch(routes) {
  return jest.fn(async (url, init) => {
    const route = routes[`${init.method} ${url}`] ?? routes[url];
    if (route instanceof Error) throw route;
    return { status: route ?? 200, body: { cancel: jest.fn() } };
  });
}

const check = (urls, fetchImpl, extra = {}) =>
  checkUrls(urls, { timeoutMs: 2000, allowedHosts: ALLOWED, fetchImpl, ...extra });

beforeEach(() => clearLinkCheckCache());

describe('checkUrls verdicts', () => {
  it.each([
    [200, 'live'],
    [204, 'live'],
    [301, 'live'],
    [404, 'dead'],
    [410, 'dead'],
    [500, 'unknown'],
    [503, 'unknown'],
    [401, 'unknown'],
    [429, 'unknown'],
  ])('maps HTTP %i to %s', async (status, verdict) => {
    const verdicts = await check([`${DOCS}/a`], fakeFetch({ [`${DOCS}/a`]: status }));
    expect(verdicts.get(`${DOCS}/a`)).toBe(verdict);
  });

  it('treats a network error as unknown', async () => {
    const verdicts = await check([`${DOCS}/a`], fakeFetch({ [`${DOCS}/a`]: new TypeError('fetch failed') }));
    expect(verdicts.get(`${DOCS}/a`)).toBe('unknown');
  });

  it('sends HEAD with redirects followed and the Fiona User-Agent', async () => {
    const fetchImpl = fakeFetch({});
    await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DOCS}/a`,
      expect.objectContaining({
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': LINK_CHECK_USER_AGENT },
      }),
    );
    expect(LINK_CHECK_USER_AGENT).toBe('Fiona-LinkCheck/1.0 (+https://www.ed-fi.org/contact/)');
  });

  it.each([403, 405, 501])('falls back to GET when HEAD returns %i', async (status) => {
    const fetchImpl = fakeFetch({ [`HEAD ${DOCS}/a`]: status, [`GET ${DOCS}/a`]: 404 });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].method).toBe('GET');
    expect(verdicts.get(`${DOCS}/a`)).toBe('dead');
  });

  it('checks each URL once when the input repeats it', async () => {
    const fetchImpl = fakeFetch({});
    await check([`${DOCS}/a`, `${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('checkUrls host allowlist', () => {
  it('does not fetch a host outside the allowlist, and reports it unknown', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['https://evil.example.com/x'], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdicts.get('https://evil.example.com/x')).toBe('unknown');
  });

  // Review Focus 4: the allowlist names www.ed-fi.org, but results also use the bare host.
  it('matches the allowlist with or without a leading www.', async () => {
    const fetchImpl = fakeFetch({ 'https://ed-fi.org/gone/': 404 });
    const verdicts = await check(['https://ed-fi.org/gone/'], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get('https://ed-fi.org/gone/')).toBe('dead');
  });

  it('reports a malformed URL as unknown without fetching', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['not a url'], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdicts.get('not a url')).toBe('unknown');
  });

  it('matches a subdomain of an allowlisted host', async () => {
    const fetchImpl = fakeFetch({ 'https://stage.ed-fi.org/success-stories/': 404 });
    const verdicts = await check(['https://stage.ed-fi.org/success-stories/'], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get('https://stage.ed-fi.org/success-stories/')).toBe('dead');
  });

  it('rejects lookalike hosts that merely contain the allowlisted domain', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['https://evil-ed-fi.org/x', 'https://ed-fi.org.evil.com/x'], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdicts.get('https://evil-ed-fi.org/x')).toBe('unknown');
    expect(verdicts.get('https://ed-fi.org.evil.com/x')).toBe('unknown');
  });

  it('matches a subdomain of a non-www allowlisted host, but not its parent domain or a lookalike', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await checkUrls(
      ['https://x.docs.ed-fi.org/a', 'https://www.ed-fi.org/a', 'https://notdocs.ed-fi.org/a'],
      { timeoutMs: 2000, allowedHosts: ['docs.ed-fi.org'], fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://x.docs.ed-fi.org/a', expect.anything());
    expect(verdicts.get('https://www.ed-fi.org/a')).toBe('unknown');
    expect(verdicts.get('https://notdocs.ed-fi.org/a')).toBe('unknown');
  });
});

describe('checkUrls time budget', () => {
  it('reports checks still running when the budget ends as unknown', async () => {
    const fetchImpl = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const verdicts = await check([`${DOCS}/slow`], fetchImpl, { timeoutMs: 20 });
    expect(verdicts.get(`${DOCS}/slow`)).toBe('unknown');
  });
});

describe('checkUrls cache', () => {
  it('serves a live verdict from cache within 1h', async () => {
    let clock = 0;
    const now = () => clock;
    const fetchImpl = fakeFetch({});
    await check([`${DOCS}/a`], fetchImpl, { now });
    clock = 59 * 60 * 1000;
    await check([`${DOCS}/a`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock = 61 * 60 * 1000;
    await check([`${DOCS}/a`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps a dead verdict for 24h', async () => {
    let clock = 0;
    const now = () => clock;
    const fetchImpl = fakeFetch({ [`${DOCS}/gone`]: 404 });
    await check([`${DOCS}/gone`], fetchImpl, { now });
    clock = 23 * 60 * 60 * 1000;
    const verdicts = await check([`${DOCS}/gone`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get(`${DOCS}/gone`)).toBe('dead');
    clock = 25 * 60 * 60 * 1000;
    await check([`${DOCS}/gone`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never caches unknown', async () => {
    const fetchImpl = fakeFetch({ [`${DOCS}/flaky`]: 503 });
    await check([`${DOCS}/flaky`], fetchImpl);
    await check([`${DOCS}/flaky`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('holds at most 2000 entries, evicting the oldest', async () => {
    const fetchImpl = fakeFetch({});
    const urls = Array.from({ length: 2001 }, (_, i) => `${DOCS}/p${i}`);
    await check(urls, fetchImpl);
    fetchImpl.mockClear();
    await check([`${DOCS}/p0`, `${DOCS}/p2000`], fetchImpl);
    // p0 was evicted and is fetched again; p2000 is still cached.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${DOCS}/p0`);
  });
});
