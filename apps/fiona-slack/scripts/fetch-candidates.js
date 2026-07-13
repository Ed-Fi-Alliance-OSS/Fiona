// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { config as loadDotenvConfig } from 'dotenv';

export function buildSlackUrl(channelId, messageTs) {
  const numeric = messageTs.replace('.', '').padEnd(16, '0');
  return `https://ed-fi-alliance.slack.com/archives/${channelId}/p${numeric}`;
}

export async function fetchConversations(container, { deploymentType, since }) {
  const results = [];
  let offset = 0;

  while (true) {
    const { resources } = await container.items
      .query(
        `SELECT c.id, c.userId, c.channelId, c.threadTs, c.messageTs, c.userMessage, c.botResponse, c.sources, c.timestamp, c.entryPoint, c.threadHistory FROM c WHERE c.deploymentType = "${deploymentType}" ORDER BY c.timestamp DESC OFFSET ${offset} LIMIT 100`,
      )
      .fetchAll();

    if (!resources.length) break;

    for (const r of resources) {
      if (r.timestamp >= since) {
        const { threadHistory, ...rest } = r;
        results.push({
          ...rest,
          threadTurns: Array.isArray(threadHistory) ? threadHistory.length : 0,
          source: 'cosmos',
        });
      }
    }

    // All remaining records are older than our window — stop fetching
    if (resources.at(-1).timestamp < since) break;

    offset += 100;
  }

  return results;
}

export async function joinFeedback(conversations, feedbackContainer, { deploymentType }) {
  return Promise.all(
    conversations.map(async (conv) => {
      const feedbackId = `${conv.userId}_${conv.messageTs}`;
      try {
        const { resource } = await feedbackContainer
          .item(feedbackId, [deploymentType, feedbackId])
          .read();
        const hasBadFeedback = resource?.value === 'bad-feedback';
        return {
          ...conv,
          hasBadFeedback,
          badFeedbackReason: hasBadFeedback ? (resource?.reason ?? null) : null,
        };
      } catch {
        return { ...conv, hasBadFeedback: false, badFeedbackReason: null };
      }
    }),
  );
}

async function fetchSlackBackfill(token, { convSince, slackSince, existingIds }) {
  const headers = { Authorization: `Bearer ${token}` };

  const listRes = await fetch('https://slack.com/api/conversations.list?types=im&limit=200', {
    headers,
  });
  const listData = await listRes.json();
  if (!listData.ok) throw new Error(`conversations.list failed: ${listData.error}`);

  const records = [];
  for (const channel of listData.channels ?? []) {
    const repliesRes = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel.id}&ts=${channel.latest ?? ''}&limit=100`,
      { headers },
    );
    const repliesData = await repliesRes.json();
    if (!repliesData.ok) continue;

    const messages = repliesData.messages ?? [];
    for (let i = 0; i < messages.length - 1; i++) {
      const userMsg = messages[i];
      const botMsg = messages[i + 1];
      if (userMsg.bot_id || !botMsg.bot_id) continue;
      if (userMsg.ts < slackSince || userMsg.ts >= convSince) continue;

      const msgKey = `${channel.id}_${userMsg.ts}`;
      if (existingIds.has(msgKey)) continue;

      const slackUrl = buildSlackUrl(channel.id, botMsg.ts);
      records.push({
        id: `slack_${channel.id}_${userMsg.ts}`,
        userId: userMsg.user ?? 'unknown',
        channelId: channel.id,
        threadTs: messages[0].ts,
        messageTs: botMsg.ts,
        timestamp: new Date(parseFloat(botMsg.ts) * 1000).toISOString(),
        entryPoint: 'assistant_message',
        userMessage: userMsg.text?.replace(/<@[^>]+>\s*/g, '').trim() ?? '',
        botResponse: botMsg.text ?? '',
        sources: [],
        threadTurns: messages.length,
        hasBadFeedback: false,
        badFeedbackReason: null,
        slackUrl,
        source: 'slack',
      });
    }
  }
  return records;
}

function getArg(name, fallback = undefined) {
  const idx = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  const token = process.argv[idx];
  if (token.includes('=')) return token.split('=').slice(1).join('=');
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

function loadDotenv() {
  const envFile = getArg('env-file');
  if (envFile) {
    loadDotenvConfig({ path: path.resolve(process.cwd(), envFile) });
    return;
  }
  loadDotenvConfig();
  loadDotenvConfig({ path: path.resolve(import.meta.dirname, '..', '.env') });
}

function getCosmosClient() {
  const connStr = process.env.COSMOS_CONNECTION_STRING;
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (connStr) return new CosmosClient(connStr);
  if (endpoint) {
    return new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }
  throw new Error(
    'Cosmos DB not configured. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
  );
}

export async function main() {
  loadDotenv();

  const days = Number(getArg('days', 30));
  const deploymentType = getArg('deployment-type', process.env.DEPLOYMENT_TYPE || 'production');
  const outputPath = getArg('output', 'candidates-raw.json');
  const slackLookbackDays = getArg('slack-lookback-days')
    ? Number(getArg('slack-lookback-days'))
    : null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = process.env.COSMOS_DATABASE || 'chatbot';
  const convContainerName = process.env.COSMOS_CONVERSATIONS_CONTAINER || 'conversations';
  const fbContainerName = process.env.COSMOS_CONTAINER || 'feedback';

  const client = getCosmosClient();
  const convContainer = client.database(db).container(convContainerName);
  const fbContainer = client.database(db).container(fbContainerName);

  console.log(`Fetching conversations (last ${days} days, ${deploymentType})...`);
  let conversations = await fetchConversations(convContainer, { deploymentType, since });
  conversations = await joinFeedback(conversations, fbContainer, { deploymentType });
  conversations = conversations.map((c) => ({
    ...c,
    slackUrl: buildSlackUrl(c.channelId, c.messageTs),
  }));

  if (slackLookbackDays) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) throw new Error('SLACK_BOT_TOKEN required for --slack-lookback-days');
    const slackSince = new Date(
      Date.now() - slackLookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const existingIds = new Set(conversations.map((c) => `${c.channelId}_${c.messageTs}`));
    const backfill = await fetchSlackBackfill(token, { convSince: since, slackSince, existingIds });
    console.log(`Slack backfill: ${backfill.length} additional records`);
    conversations.push(...backfill);
  }

  const badFeedbackCount = conversations.filter((c) => c.hasBadFeedback).length;
  writeFileSync(path.resolve(outputPath), JSON.stringify(conversations, null, 2), 'utf8');

  console.log(`Total candidates: ${conversations.length}`);
  console.log(`Bad-feedback flagged: ${badFeedbackCount}`);
  console.log(`Output: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
