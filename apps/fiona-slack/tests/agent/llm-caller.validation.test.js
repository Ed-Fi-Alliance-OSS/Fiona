import { describe, it, expect } from '@jest/globals';

// Mock all external dependencies before importing the module under test.
import { jest } from '@jest/globals';

jest.unstable_mockModule('@azure/ai-projects', () => ({
  AIProjectClient: jest.fn(),
}));

jest.unstable_mockModule('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

jest.unstable_mockModule('openai', () => ({
  OpenAI: jest.fn(),
  AzureOpenAI: jest.fn(),
}));

jest.unstable_mockModule('../../src/agent/utils/source-normalizer.js', () => ({
  normalizeSources: jest.fn().mockReturnValue({ sources: [], sourceIndexMap: {} }),
}));

jest.unstable_mockModule('../../src/agent/utils/citation-telemetry.js', () => ({
  recordMetadataWaitDuration: jest.fn(),
  recordSourceCount: jest.fn(),
  incrementDegradedNoMetadataCount: jest.fn(),
  incrementTotalResponseCount: jest.fn(),
}));

const { validateAzureAgentId } = await import('../../src/agent/llm-caller.js');

describe('validateAzureAgentId (B2)', () => {
  describe('valid formats', () => {
    it('accepts a simple alphanumeric name', () => {
      const result = validateAzureAgentId('myagent');
      expect(result.name).toBe('myagent');
      expect(result.version).toBe('1');
    });

    it('accepts name with hyphens and underscores', () => {
      const result = validateAzureAgentId('my-agent_v2');
      expect(result.name).toBe('my-agent_v2');
    });

    it('accepts name:version format with integer version', () => {
      const result = validateAzureAgentId('myagent:3');
      expect(result.name).toBe('myagent');
      expect(result.version).toBe('3');
    });

    it('accepts name:version format with semver (major.minor)', () => {
      const result = validateAzureAgentId('myagent:1.2');
      expect(result.version).toBe('1.2');
    });

    it('accepts name:version format with full semver (major.minor.patch)', () => {
      const result = validateAzureAgentId('myagent:1.2.3');
      expect(result.version).toBe('1.2.3');
    });
  });

  describe('invalid formats', () => {
    it('throws for empty string', () => {
      expect(() => validateAzureAgentId('')).toThrow('required');
    });

    it('throws for null', () => {
      expect(() => validateAzureAgentId(null)).toThrow('required');
    });

    it('throws for undefined', () => {
      expect(() => validateAzureAgentId(undefined)).toThrow('required');
    });

    it('throws for whitespace-only string', () => {
      expect(() => validateAzureAgentId('   ')).toThrow('required');
    });

    it('throws for name with special characters', () => {
      expect(() => validateAzureAgentId('my agent!')).toThrow('invalid characters');
    });

    it('throws for name with spaces', () => {
      expect(() => validateAzureAgentId('my agent')).toThrow('invalid characters');
    });

    it('throws when more than one colon separator is present', () => {
      expect(() => validateAzureAgentId('a:b:c')).toThrow('invalid format');
    });

    it('throws for non-semver version (letters)', () => {
      expect(() => validateAzureAgentId('myagent:latest')).toThrow('invalid format');
    });

    it('throws for non-semver version (four parts)', () => {
      expect(() => validateAzureAgentId('myagent:1.2.3.4')).toThrow('invalid format');
    });
  });
});
