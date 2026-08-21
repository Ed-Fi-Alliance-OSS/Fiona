// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockDownloadToBuffer = jest.fn();
const mockGetBlockBlobClient = jest.fn();
const mockGetContainerClient = jest.fn();
const MockBlobServiceClient = jest.fn();
const MockDefaultAzureCredential = jest.fn();

jest.unstable_mockModule('@azure/storage-blob', () => ({
  BlobServiceClient: MockBlobServiceClient,
}));
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: MockDefaultAzureCredential,
}));

process.env.USAGE_REPORTS_STORAGE_ACCOUNT_URL = 'https://teststorage.blob.core.windows.net';

const { getLatestReportLink } = await import('../../lib/report-link.js');

MockBlobServiceClient.mockImplementation(() => ({
  getContainerClient: mockGetContainerClient,
}));
mockGetContainerClient.mockReturnValue({
  getBlockBlobClient: mockGetBlockBlobClient,
});
mockGetBlockBlobClient.mockReturnValue({
  downloadToBuffer: mockDownloadToBuffer,
});

function makeLogger() {
  return { warn: jest.fn() };
}

describe('getLatestReportLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockBlobServiceClient.mockImplementation(() => ({
      getContainerClient: mockGetContainerClient,
    }));
    mockGetContainerClient.mockReturnValue({
      getBlockBlobClient: mockGetBlockBlobClient,
    });
    mockGetBlockBlobClient.mockReturnValue({
      downloadToBuffer: mockDownloadToBuffer,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns the URL when deploymentType and weekEnd match the pointer', async () => {
    mockDownloadToBuffer.mockResolvedValue(
      Buffer.from(
        JSON.stringify({
          url: 'https://teststorage.blob.core.windows.net/usage-reports/executive-report-production-2026-03-10-to-2026-03-16.pdf?sas=abc',
          weekStart: '2026-03-10',
          weekEnd: '2026-03-16',
          deploymentType: 'production',
        }),
      ),
    );

    const logger = makeLogger();
    const result = await getLatestReportLink({ deploymentType: 'production', weekEnd: '2026-03-16' }, logger);

    expect(result).toBe(
      'https://teststorage.blob.core.windows.net/usage-reports/executive-report-production-2026-03-10-to-2026-03-16.pdf?sas=abc',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns when weekEnd does not match', async () => {
    mockDownloadToBuffer.mockResolvedValue(
      Buffer.from(
        JSON.stringify({
          url: 'https://example.test/report.pdf',
          weekStart: '2026-03-03',
          weekEnd: '2026-03-09',
          deploymentType: 'production',
        }),
      ),
    );

    const logger = makeLogger();
    const result = await getLatestReportLink({ deploymentType: 'production', weekEnd: '2026-03-16' }, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('window mismatch'));
  });

  it('returns null and warns when deploymentType does not match', async () => {
    mockDownloadToBuffer.mockResolvedValue(
      Buffer.from(
        JSON.stringify({
          url: 'https://example.test/report.pdf',
          weekStart: '2026-03-10',
          weekEnd: '2026-03-16',
          deploymentType: 'insiders',
        }),
      ),
    );

    const logger = makeLogger();
    const result = await getLatestReportLink({ deploymentType: 'production', weekEnd: '2026-03-16' }, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('window mismatch'));
  });

  it('returns null and warns when the blob does not exist', async () => {
    mockDownloadToBuffer.mockRejectedValue(new Error('BlobNotFound'));

    const logger = makeLogger();
    const result = await getLatestReportLink({ deploymentType: 'production', weekEnd: '2026-03-16' }, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('BlobNotFound'));
  });

  it('returns null and warns when the pointer JSON is malformed', async () => {
    mockDownloadToBuffer.mockResolvedValue(Buffer.from('not json'));

    const logger = makeLogger();
    const result = await getLatestReportLink({ deploymentType: 'production', weekEnd: '2026-03-16' }, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('returns null and warns without touching storage when the account URL is not configured', async () => {
    const originalUrl = process.env.USAGE_REPORTS_STORAGE_ACCOUNT_URL;
    delete process.env.USAGE_REPORTS_STORAGE_ACCOUNT_URL;

    // Re-import with the env var unset to exercise the module-scope guard.
    jest.resetModules();
    jest.unstable_mockModule('@azure/storage-blob', () => ({
      BlobServiceClient: MockBlobServiceClient,
    }));
    jest.unstable_mockModule('@azure/identity', () => ({
      DefaultAzureCredential: MockDefaultAzureCredential,
    }));
    const { getLatestReportLink: getLatestReportLinkNoEnv } = await import('../../lib/report-link.js');

    const logger = makeLogger();
    const result = await getLatestReportLinkNoEnv({ deploymentType: 'production', weekEnd: '2026-03-16' }, logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('USAGE_REPORTS_STORAGE_ACCOUNT_URL'));
    expect(mockDownloadToBuffer).not.toHaveBeenCalled();

    process.env.USAGE_REPORTS_STORAGE_ACCOUNT_URL = originalUrl;
  });
});
