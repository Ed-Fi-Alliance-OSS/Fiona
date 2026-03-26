import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock sub-listener modules before importing the module under test
const mockActionsRegister = jest.fn();
const mockEventsRegister = jest.fn();
const mockAssistantRegister = jest.fn();

jest.unstable_mockModule('../../src/listeners/actions/index.js', () => ({
  register: mockActionsRegister,
}));

jest.unstable_mockModule('../../src/listeners/events/index.js', () => ({
  register: mockEventsRegister,
}));

jest.unstable_mockModule('../../src/listeners/assistant/index.js', () => ({
  register: mockAssistantRegister,
}));

const { registerListeners } = await import('../../src/listeners/index.js');

describe('registerListeners', () => {
  let mockApp;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApp = { action: jest.fn(), event: jest.fn(), assistant: jest.fn() };
  });

  it('calls actions register with the app', () => {
    registerListeners(mockApp);
    expect(mockActionsRegister).toHaveBeenCalledWith(mockApp);
  });

  it('calls events register with the app', () => {
    registerListeners(mockApp);
    expect(mockEventsRegister).toHaveBeenCalledWith(mockApp);
  });

  it('calls assistant register with the app', () => {
    registerListeners(mockApp);
    expect(mockAssistantRegister).toHaveBeenCalledWith(mockApp);
  });

  it('calls all three sub-registrations exactly once', () => {
    registerListeners(mockApp);
    expect(mockActionsRegister).toHaveBeenCalledTimes(1);
    expect(mockEventsRegister).toHaveBeenCalledTimes(1);
    expect(mockAssistantRegister).toHaveBeenCalledTimes(1);
  });
});
