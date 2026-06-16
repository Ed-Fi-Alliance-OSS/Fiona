import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals';

// Set COSMOS_CONNECTION_STRING before the module is imported so that the
// module-level constant picks it up at load time.
process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=dGVzdA==;';

const mockUpsert = jest.fn().mockResolvedValue({});
const mockContainerObj = { items: { upsert: mockUpsert } };
const mockDatabase = {
  container: jest.fn().mockReturnValue(mockContainerObj),
  containers: {
    createIfNotExists: jest.fn().mockResolvedValue({ container: mockContainerObj })
  }
};
const MockCosmosClient = jest.fn().mockImplementation(() => ({
  database: jest.fn().mockReturnValue(mockDatabase),
  databases: {
    createIfNotExists: jest.fn().mockResolvedValue({ database: mockDatabase })
  }
}));

jest.unstable_mockModule('@azure/cosmos', () => ({
  CosmosClient: MockCosmosClient,
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

describe('recordInteraction - with connection string', () => {
  let recordInteraction;

  beforeAll(async () => {
    ({ recordInteraction } = await import('../../src/agent/interaction-store.js'));
  });

  beforeEach(() => {
    mockUpsert.mockClear();
  });

  it('calls upsert with the correct composite id', async () => {
    await recordInteraction({
      userId: 'U123',
      teamId: 'T123',
      channelId: 'C456',
      threadTs: '1234567890.000001',
      messageTs: '1234567890.000002',
      interactionType: 'app_mention',
      status: 'success',
      rateLimited: false,
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.id).toBe('U123_1234567890.000001_1234567890.000002');
  });

  it('persists all interaction fields', async () => {
    await recordInteraction({
      userId: 'U123',
      teamId: 'T456',
      channelId: 'C789',
      threadTs: '1234567890.000003',
      messageTs: '1234567890.000004',
      interactionType: 'assistant_message',
      status: 'error',
      errorType: 'llm_error',
      rateLimited: false,
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.userId).toBe('U123');
    expect(doc.teamId).toBe('T456');
    expect(doc.channelId).toBe('C789');
    expect(doc.threadTs).toBe('1234567890.000003');
    expect(doc.messageTs).toBe('1234567890.000004');
    expect(doc.interactionType).toBe('assistant_message');
    expect(doc.status).toBe('error');
    expect(doc.errorType).toBe('llm_error');
    expect(doc.rateLimited).toBe(false);
  });

  it('sets errorType to null when status is success', async () => {
    await recordInteraction({
      userId: 'U111',
      teamId: 'T111',
      channelId: 'C111',
      threadTs: '1234567890.000005',
      messageTs: '1234567890.000006',
      interactionType: 'app_mention',
      status: 'success',
      errorType: 'some_error',
      rateLimited: false,
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.errorType).toBeNull();
  });

  it('includes a timestamp in ISO 8601 format', async () => {
    await recordInteraction({
      userId: 'U222',
      teamId: 'T222',
      channelId: 'C222',
      threadTs: '1234567890.000007',
      messageTs: '1234567890.000008',
      interactionType: 'app_mention',
      status: 'success',
      rateLimited: false,
    });

    const [doc] = mockUpsert.mock.calls[0];
    expect(typeof doc.timestamp).toBe('string');
    expect(new Date(doc.timestamp).toISOString()).toBe(doc.timestamp);
  });

  it('passes MultiHash partition key [deploymentType, userId]', async () => {
    await recordInteraction({
      userId: 'U333',
      teamId: 'T333',
      channelId: 'C333',
      threadTs: '1234567890.000009',
      messageTs: '1234567890.000010',
      interactionType: 'app_mention',
      status: 'success',
      rateLimited: false,
    });

    const [doc, options] = mockUpsert.mock.calls[0];
    expect(options).toEqual(
      expect.objectContaining({
        partitionKey: [doc.deploymentType, doc.userId],
      }),
    );
  });

  it('resolves without error on success', async () => {
    await expect(
      recordInteraction({
        userId: 'U999',
        teamId: 'T999',
        channelId: 'C999',
        threadTs: '1234567890.999001',
        messageTs: '1234567890.999002',
        interactionType: 'app_mention',
        status: 'success',
        rateLimited: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('supports idempotent upsert (duplicate events overwrite)', async () => {
    const interaction = {
      userId: 'U444',
      teamId: 'T444',
      channelId: 'C444',
      threadTs: '1234567890.000011',
      messageTs: '1234567890.000012',
      interactionType: 'app_mention',
      status: 'success',
      rateLimited: false,
    };

    await recordInteraction(interaction);
    await recordInteraction(interaction);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const [firstDoc] = mockUpsert.mock.calls[0];
    const [secondDoc] = mockUpsert.mock.calls[1];
    expect(firstDoc.id).toBe(secondDoc.id);
  });
});
