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

/**
 * fetch mock: `routes` maps "METHOD url" (or url, for any method) to a status,
 * an Error to throw, or `{ status, location, cancel }` for a redirect or a
 * custom body.cancel.
 */
function fakeFetch(routes) {
  return jest.fn(async (url, init) => {
    const route = routes[`${init.method} ${url}`] ?? routes[url];
    if (route instanceof Error) throw route;
    const { status = 200, location = null, cancel = jest.fn() } = typeof route === 'object' ? route : { status: route };
    return { status, headers: new Headers(location ? { location } : {}), body: { cancel } };
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

  it('sends HEAD with redirects handled manually and the Fiona User-Agent', async () => {
    const fetchImpl = fakeFetch({});
    await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DOCS}/a`,
      expect.objectContaining({
        method: 'HEAD',
        redirect: 'manual',
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

  it.each([404, 410])('confirms a HEAD %i with GET before calling the page dead', async (status) => {
    const fetchImpl = fakeFetch({ [`HEAD ${DOCS}/a`]: status, [`GET ${DOCS}/a`]: status });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl.mock.calls.map(([, init]) => init.method)).toEqual(['HEAD', 'GET']);
    expect(verdicts.get(`${DOCS}/a`)).toBe('dead');
  });

  it('takes the GET status when HEAD says 404 but GET serves the page', async () => {
    const fetchImpl = fakeFetch({ [`HEAD ${DOCS}/a`]: 404, [`GET ${DOCS}/a`]: 200 });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
    expect(verdicts.get(`${DOCS}/a`)).toBe('live');
  });

  it('does not GET a page HEAD already found live', async () => {
    const fetchImpl = fakeFetch({ [`${DOCS}/a`]: 200 });
    await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('stream locked'))],
    [
      'throws',
      () => {
        throw new TypeError('stream locked');
      },
    ],
  ])('keeps a dead GET verdict when releasing the body %s', async (_label, cancel) => {
    const fetchImpl = fakeFetch({ [`HEAD ${DOCS}/a`]: 405, [`GET ${DOCS}/a`]: { status: 404, cancel } });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
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
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['https://ed-fi.org/page/'], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get('https://ed-fi.org/page/')).toBe('live');
  });

  it('reports a malformed URL as unknown without fetching', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['not a url'], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdicts.get('not a url')).toBe('unknown');
  });

  it('matches a subdomain of an allowlisted host', async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await check(['https://stage.ed-fi.org/success-stories/'], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get('https://stage.ed-fi.org/success-stories/')).toBe('live');
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

describe('checkUrls redirects', () => {
  it('follows a redirect within the allowlist and takes the final status', async () => {
    const fetchImpl = fakeFetch({
      [`${DOCS}/old`]: { status: 301, location: '/new/' },
      [`${DOCS}/new/`]: 404,
    });
    const verdicts = await check([`${DOCS}/old`], fetchImpl);
    // HEAD follows the redirect to a 404, then GET follows it again to confirm.
    expect(fetchImpl.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `HEAD ${DOCS}/old`,
      `HEAD ${DOCS}/new/`,
      `GET ${DOCS}/old`,
      `GET ${DOCS}/new/`,
    ]);
    expect(verdicts.get(`${DOCS}/old`)).toBe('dead');
  });

  it('follows a redirect to another allowlisted host', async () => {
    const fetchImpl = fakeFetch({ [`${DOCS}/a`]: { status: 302, location: 'https://www.ed-fi.org/a/' } });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://www.ed-fi.org/a/', expect.anything());
    expect(verdicts.get(`${DOCS}/a`)).toBe('live');
  });

  it.each([
    ['another host', 'https://evil.example.com/x'],
    ['a lookalike host', 'https://ed-fi.org.evil.com/x'],
    ['an internal address', 'http://169.254.169.254/latest/meta-data/'],
    ['a non-HTTP scheme', 'file:///etc/passwd'],
  ])('does not follow a redirect to %s, and reports it unknown', async (_label, location) => {
    const fetchImpl = fakeFetch({ [`${DOCS}/a`]: { status: 301, location }, [location]: 404 });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verdicts.get(`${DOCS}/a`)).toBe('unknown');
  });

  it('holds the GET fallback to the allowlist too', async () => {
    const fetchImpl = fakeFetch({
      [`HEAD ${DOCS}/a`]: 405,
      [`GET ${DOCS}/a`]: { status: 302, location: 'https://evil.example.com/x' },
    });
    const verdicts = await check([`${DOCS}/a`], fetchImpl);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`${DOCS}/a`, `${DOCS}/a`]);
    expect(verdicts.get(`${DOCS}/a`)).toBe('unknown');
  });

  it('gives up after 5 redirects and reports unknown', async () => {
    const fetchImpl = fakeFetch({ [`${DOCS}/loop`]: { status: 307, location: `${DOCS}/loop` } });
    const verdicts = await check([`${DOCS}/loop`], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(verdicts.get(`${DOCS}/loop`)).toBe('unknown');
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

  it('returns when the budget ends even if a request ignores the abort, keeping finished verdicts', async () => {
    let finishHung;
    const fetchImpl = jest.fn((url) => {
      if (url === `${DOCS}/fast`) return Promise.resolve({ status: 404, headers: new Headers(), body: null });
      return new Promise((resolve) => {
        finishHung = () => resolve({ status: 404, headers: new Headers(), body: null });
      });
    });

    const verdicts = await check([`${DOCS}/fast`, `${DOCS}/hung`], fetchImpl, { timeoutMs: 20 });

    expect(verdicts.get(`${DOCS}/fast`)).toBe('dead');
    expect(verdicts.get(`${DOCS}/hung`)).toBe('unknown');

    // The hung request finishing later must not change what the caller already has.
    finishHung();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(verdicts.get(`${DOCS}/hung`)).toBe('unknown');
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

  // A brief 404 (a docs deploy, a CDN blip) must not hide a page for long.
  it('keeps a dead verdict for 1h, like a live one', async () => {
    let clock = 0;
    const now = () => clock;
    const fetchImpl = fakeFetch({ [`${DOCS}/gone`]: 404 });
    await check([`${DOCS}/gone`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // HEAD, then the confirming GET
    clock = 59 * 60 * 1000;
    const verdicts = await check([`${DOCS}/gone`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(verdicts.get(`${DOCS}/gone`)).toBe('dead');
    clock = 61 * 60 * 1000;
    await check([`${DOCS}/gone`], fetchImpl, { now });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
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
