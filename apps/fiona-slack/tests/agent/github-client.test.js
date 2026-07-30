import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post: mockPost } }));

const { isGithubConfigured, createIssue } = await import('../../src/agent/github-client.js');

const logger = { error: jest.fn(), warn: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SLACK_GITHUB_ISSUE_REPO = 'Ed-Fi-Alliance-OSS/Fiona';
  process.env.SLACK_GITHUB_ISSUE_TOKEN = 'ghp-secret-token';
  delete process.env.GITHUB_API_URL;
});

describe('isGithubConfigured', () => {
  it('is true when repo and token are set', () => {
    expect(isGithubConfigured()).toBe(true);
  });
  it('is false when the token is missing', () => {
    delete process.env.SLACK_GITHUB_ISSUE_TOKEN;
    expect(isGithubConfigured()).toBe(false);
  });
});

describe('createIssue', () => {
  it('POSTs to the repo issues endpoint and returns number + html_url', async () => {
    mockPost.mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/Ed-Fi-Alliance-OSS/Fiona/issues/42' } });
    const result = await createIssue(
      { title: 'It broke', bodyText: 'Details here', labels: ['bug'] },
      logger,
    );
    expect(result).toEqual({ number: 42, url: 'https://github.com/Ed-Fi-Alliance-OSS/Fiona/issues/42' });
    const [url, body, opts] = mockPost.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/Ed-Fi-Alliance-OSS/Fiona/issues');
    expect(body).toEqual({ title: 'It broke', body: 'Details here', labels: ['bug'] });
    expect(opts.headers.Authorization).toBe('Bearer ghp-secret-token');
    expect(opts.headers.Accept).toBe('application/vnd.github+json');
    expect(opts.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('honors GITHUB_API_URL for GitHub Enterprise Server', async () => {
    process.env.GITHUB_API_URL = 'https://ghe.example.org/api/v3';
    mockPost.mockResolvedValue({ data: { number: 7, html_url: 'https://ghe.example.org/x/y/issues/7' } });
    await createIssue({ title: 't', bodyText: 'b' }, logger);
    expect(mockPost.mock.calls[0][0]).toBe('https://ghe.example.org/api/v3/repos/Ed-Fi-Alliance-OSS/Fiona/issues');
  });

  it('omits labels from the payload when none are given', async () => {
    mockPost.mockResolvedValue({ data: { number: 1, html_url: 'u' } });
    await createIssue({ title: 't', bodyText: 'b' }, logger);
    expect(mockPost.mock.calls[0][1]).toEqual({ title: 't', body: 'b' });
  });

  it('throws with type github_auth_failed on 401', async () => {
    mockPost.mockRejectedValue({ response: { status: 401 }, message: 'Bad credentials' });
    await expect(createIssue({ title: 't', bodyText: 'b' }, logger)).rejects.toMatchObject({ type: 'github_auth_failed' });
  });

  it('throws with type github_create_failed on 422', async () => {
    mockPost.mockRejectedValue({ response: { status: 422 }, message: 'Validation failed' });
    await expect(createIssue({ title: 't', bodyText: 'b' }, logger)).rejects.toMatchObject({ type: 'github_create_failed' });
  });
});
