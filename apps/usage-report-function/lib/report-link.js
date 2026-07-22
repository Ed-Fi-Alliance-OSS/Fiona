// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const STORAGE_ACCOUNT_URL = process.env.USAGE_REPORTS_STORAGE_ACCOUNT_URL;
const CONTAINER_NAME = 'usage-reports';
const POINTER_BLOB_NAME = 'latest-link.json';

/**
 * Reads the `latest-link.json` pointer written by the
 * generate-usage-report-pdf GitHub Actions workflow and returns the report
 * URL only if it matches the requested window. Never throws — any failure
 * (missing config, missing/corrupt blob, window mismatch) is logged via
 * `logger.warn` and resolves to `null`, so a storage problem never blocks
 * the weekly Slack post.
 *
 * @param {Object} window
 * @param {string} window.deploymentType
 * @param {string} window.weekEnd  ISO date string (YYYY-MM-DD)
 * @param {Object} logger - Logger object with a `warn` method.
 * @returns {Promise<string|null>}
 */
export async function getLatestReportLink({ deploymentType, weekEnd }, logger) {
  if (!STORAGE_ACCOUNT_URL) {
    logger.warn('USAGE_REPORTS_STORAGE_ACCOUNT_URL environment variable is not set — omitting report link');
    return null;
  }

  try {
    const credential = new DefaultAzureCredential();
    const blobServiceClient = new BlobServiceClient(STORAGE_ACCOUNT_URL, credential);
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blockBlobClient = containerClient.getBlockBlobClient(POINTER_BLOB_NAME);

    const buffer = await blockBlobClient.downloadToBuffer();
    const pointer = JSON.parse(buffer.toString('utf-8'));

    if (pointer.deploymentType !== deploymentType || pointer.weekEnd !== weekEnd) {
      logger.warn(
        `Report link pointer window mismatch (expected deploymentType=${deploymentType} weekEnd=${weekEnd}, ` +
          `got deploymentType=${pointer.deploymentType} weekEnd=${pointer.weekEnd}) — omitting link`,
      );
      return null;
    }

    return pointer.url;
  } catch (error) {
    logger.warn(`Failed to read latest report link: ${error.message}`);
    return null;
  }
}
