import { describe, it, expect, jest } from '@jest/globals';

// Mock all external dependencies that have side effects at module load time
// so that importing llm-caller.js in tests does not fail due to missing credentials.
jest.unstable_mockModule('@azure/ai-projects', () => ({
  AIProjectClient: jest.fn(),
}));
jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));
jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({})),
  AzureOpenAI: jest.fn().mockImplementation(() => ({})),
}));
jest.unstable_mockModule('../../src/agent/tools/dice.js', () => ({
  rollDice: jest.fn(),
  rollDiceDefinition: { name: 'roll_dice', type: 'function' },
}));
jest.unstable_mockModule('../../src/agent/tools/perplexity-search.js', () => ({
  perplexitySearchDefinition: { name: 'perplexity_search', type: 'function' },
}));

// validateAzureAgentId and redactAzureErrorBody are helpers exported for testing.
const { validateAzureAgentId, redactAzureErrorBody } = await import('../../src/agent/llm-caller.js');

describe('validateAzureAgentId', () => {
  it('accepts a simple name with no version', () => {
    expect(() => validateAzureAgentId('my-agent')).not.toThrow();
  });

  it('accepts a name with a numeric version', () => {
    expect(() => validateAzureAgentId('my-agent:1')).not.toThrow();
  });

  it('accepts a name with a minor version', () => {
    expect(() => validateAzureAgentId('my-agent:1.0')).not.toThrow();
  });

  it('accepts a name with a semver version', () => {
    expect(() => validateAzureAgentId('my-agent:1.0.0')).not.toThrow();
  });

  it('accepts names with underscores and hyphens', () => {
    expect(() => validateAzureAgentId('my_agent-v2')).not.toThrow();
  });

  it('accepts uppercase names', () => {
    expect(() => validateAzureAgentId('MyAgent:2')).not.toThrow();
  });

  it('throws for an empty string', () => {
    expect(() => validateAzureAgentId('')).toThrow();
  });

  it('throws for a null value', () => {
    expect(() => validateAzureAgentId(null)).toThrow();
  });

  it('throws for a whitespace-only string', () => {
    expect(() => validateAzureAgentId('   ')).toThrow();
  });

  it('throws when name contains special characters', () => {
    expect(() => validateAzureAgentId('my agent!')).toThrow();
  });

  it('throws when name contains a space', () => {
    expect(() => validateAzureAgentId('my agent')).toThrow();
  });

  it('throws for too many colon-separated segments', () => {
    expect(() => validateAzureAgentId('a:b:c')).toThrow();
  });

  it('throws for a non-numeric version', () => {
    expect(() => validateAzureAgentId('my-agent:beta')).toThrow();
  });

  it('throws for a version with too many segments', () => {
    expect(() => validateAzureAgentId('my-agent:1.2.3.4')).toThrow();
  });
});

describe('redactAzureErrorBody', () => {
  it('extracts error code and message from a valid Azure error JSON', () => {
    const body = JSON.stringify({
      error: { code: 'InvalidRequest', message: 'The request is invalid.' },
    });
    const result = redactAzureErrorBody(body);
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('InvalidRequest');
    expect(parsed.message).toBe('The request is invalid.');
  });

  it('does not include raw token or session data from the original body', () => {
    const body = JSON.stringify({
      error: { code: 'Unauthorized', message: 'Unauthorized.' },
      session_id: 'top-secret-session-123',
      token: 'Bearer eyJhbGciOiJSUzI1NiJ9.secret',
    });
    const result = redactAzureErrorBody(body);
    expect(result).not.toContain('top-secret-session-123');
    expect(result).not.toContain('eyJhbGciOiJSUzI1NiJ9');
  });

  it('returns a placeholder for non-JSON body text', () => {
    const result = redactAzureErrorBody('<html>Internal Server Error</html>');
    expect(result).toContain('redacted');
    expect(result).not.toContain('<html>');
  });

  it('handles a body with only a top-level message field', () => {
    const body = JSON.stringify({ message: 'Service unavailable.' });
    const result = redactAzureErrorBody(body);
    const parsed = JSON.parse(result);
    expect(parsed.message).toBe('Service unavailable.');
  });

  it('handles an empty JSON object gracefully', () => {
    const result = redactAzureErrorBody('{}');
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
