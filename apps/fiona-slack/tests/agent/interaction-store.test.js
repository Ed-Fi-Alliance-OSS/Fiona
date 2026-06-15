import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';

// Mock @azure/cosmos and @azure/identity BEFORE the module under test is imported
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

describe('interaction-store - no Cosmos config', () => {
  let getContainer;
  let recordInteraction;

  beforeAll(async () => {
    delete process.env.COSMOS_CONNECTION_STRING;
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;
    jest.resetModules();
    ({ getContainer, recordInteraction } = await import('../../src/agent/interaction-store.js'));
  });

  it('returns null when no Cosmos configuration is set', async () => {
    const container = await getContainer(null);
    expect(container).toBeNull();
  });

  it('silently no-ops when recording without Cosmos config', async () => {
    const logger = { warn: jest.fn() };
    await expect(
      recordInteraction({
        userId: 'U123',
        teamId: 'T123',
        channelId: 'C123',
        threadTs: '1712345678.001',
        messageTs: '1712345678.123',
        interactionType: 'app_mention',
        status: 'success',
        rateLimited: false,
        logger,
      }),
    ).resolves.toBeUndefined();
  });

  it('does not call CosmosClient when not configured', async () => {
    MockCosmosClient.mockClear();
    await recordInteraction({
      userId: 'U123',
      teamId: 'T123',
      channelId: 'C123',
      threadTs: '1712345678.001',
      messageTs: '1712345678.123',
      interactionType: 'app_mention',
      status: 'success',
      rateLimited: false,
    });
    expect(MockCosmosClient).not.toHaveBeenCalled();
  });
});

describe('interaction-store - with connection string', () => {
  let getContainer;
  let recordInteraction;

  beforeAll(async () => {
    process.env.COSMOS_CONNECTION_STRING =
      'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=dGVzdA==';
    jest.resetModules();
    ({ getContainer, recordInteraction } = await import('../../src/agent/interaction-store.js'));
  });

  afterAll(() => {
    delete process.env.COSMOS_CONNECTION_STRING;
  });

  it('returns a container when connection string is configured', async () => {
    MockCosmosClient.mockClear();
    const container = await getContainer({ warn: jest.fn() });
    expect(container).toBeDefined();
    expect(container).not.toBeNull();
  });

  it('upserts document with correct shape when recording succeeds', async () => {
    mockUpsert.mockClear();
    const logger = { warn: jest.fn() };

    await recordInteraction({
      userId: 'U999',
      teamId: 'T999',
      channelId: 'C999',
      threadTs: '1712345678.001',
      messageTs: '1712345678.999',
      interactionType: 'app_mention',
      status: 'success',
      rateLimited: false,
      logger,
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc, options] = mockUpsert.mock.calls[0];
    expect(doc.id).toBe('U999_1712345678.001_1712345678.999');
    expect(doc.status).toBe('success');
    expect(doc.errorType).toBeNull();
    expect(doc.rateLimited).toBe(false);
    expect(doc.interactionType).toBe('app_mention');
    expect(doc.timestamp).toBeDefined();
    expect(options).toEqual({ partitionKey: [doc.deploymentType, doc.userId] });
  });

  it('sets errorType on the document when status is error', async () => {
    mockUpsert.mockClear();

    await recordInteraction({
      userId: 'U888',
      teamId: 'T888',
      channelId: 'C888',
      threadTs: '1712345678.001',
      messageTs: '1712345678.888',
      interactionType: 'app_mention',
      status: 'error',
      errorType: 'llm_error',
      rateLimited: false,
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.status).toBe('error');
    expect(doc.errorType).toBe('llm_error');
  });

  it('supports slash_help interactions that use trigger_id identifiers', async () => {
    mockUpsert.mockClear();

    await recordInteraction({
      userId: 'U555',
      teamId: 'T555',
      channelId: 'C555',
      threadTs: '1334522466599.738474920.8088930838d88f008e0',
      messageTs: '1334522466599.738474920.8088930838d88f008e0',
      interactionType: 'slash_help',
      status: 'success',
      rateLimited: false,
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [doc] = mockUpsert.mock.calls[0];
    expect(doc.id).toBe('U555_1334522466599.738474920.8088930838d88f008e0_1334522466599.738474920.8088930838d88f008e0');
    expect(doc.interactionType).toBe('slash_help');
    expect(doc.threadTs).toBe('1334522466599.738474920.8088930838d88f008e0');
    expect(doc.messageTs).toBe('1334522466599.738474920.8088930838d88f008e0');
  });

  it('logs a warning and does not throw when upsert fails', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('Cosmos write failure'));
    const logger = { warn: jest.fn() };

    await expect(
      recordInteraction({
        userId: 'U777',
        teamId: 'T777',
        channelId: 'C777',
        threadTs: '1712345678.001',
        messageTs: '1712345678.777',
        interactionType: 'app_mention',
        status: 'success',
        rateLimited: false,
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to record interaction'));
  });
});
