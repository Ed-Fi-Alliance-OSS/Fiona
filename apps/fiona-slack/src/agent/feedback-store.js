import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'chatbot';
const COSMOS_CONTAINER = process.env.COSMOS_CONTAINER || 'feedback';
const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || 'local';

let warnedMissingConfig = false;

/** @type {import('@azure/cosmos').Container | null} */
let container = null;

/**
 * @param {{ warn?: (msg: string) => void }} [logger]
 */
async function getContainer(logger) {
  if (container) return container;

  let client;
  if (COSMOS_CONNECTION_STRING) {
    client = new CosmosClient(COSMOS_CONNECTION_STRING);
  } else if (COSMOS_ENDPOINT && COSMOS_KEY) {
    client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
  } else if (COSMOS_ENDPOINT) {
    client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: new DefaultAzureCredential() });
  } else {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger?.warn?.(
        'CosmosDB not configured — feedback will not be persisted. Set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT.',
      );
    }
    return null;
  }

  container = client.database(COSMOS_DATABASE).container(COSMOS_CONTAINER);
  return container;
}

/**
 * Record user feedback to Cosmos DB. No-ops silently if Cosmos is not configured.
 *
 * Uses userId + messageTs as the document id so that if a user changes their
 * feedback (thumbs up → thumbs down), the record is updated in place.
 *
 * @param {Object} feedback
 * @param {string} feedback.userId - Slack user ID
 * @param {string} feedback.channelId - Slack channel ID
 * @param {string} feedback.messageTs - Timestamp of the bot message being rated
 * @param {string} feedback.value - 'good-feedback' or 'bad-feedback'
 * @param {string|null} feedback.userMessage - The user's message that prompted the response
 * @param {string|null} feedback.botResponse - The bot's response being rated
 * @param {{ warn?: (msg: string) => void }} [feedback.logger] - Optional logger for warnings
 */
export async function recordFeedback({ userId, channelId, messageTs, value, userMessage, botResponse, logger }) {
  const c = await getContainer(logger);
  if (!c) return;

  const doc = {
    feedbackId: `${userId}_${messageTs}`,
    userId,
    channelId,
    messageTs,
    value,
    userMessage,
    botResponse,
    deploymentType: DEPLOYMENT_TYPE,
    timestamp: new Date().toISOString(),
  };

  await c.items.upsert(doc, {
    partitionKey: [doc.deploymentType, doc.feedbackId],
  });
}
