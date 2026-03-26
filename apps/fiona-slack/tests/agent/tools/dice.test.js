import { describe, it, expect } from '@jest/globals';
import { rollDice, rollDiceDefinition } from '../../../src/agent/tools/dice.js';

describe('rollDice', () => {
  it('returns a valid result with default parameters', () => {
    const result = rollDice();
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls[0]).toBeGreaterThanOrEqual(1);
    expect(result.rolls[0]).toBeLessThanOrEqual(6);
    expect(result.total).toBe(result.rolls[0]);
    expect(result.description).toMatch(/Rolled a 1d6/);
  });

  it('rolls the correct number of dice', () => {
    const result = rollDice({ sides: 6, count: 3 });
    expect(result.rolls).toHaveLength(3);
    expect(result.total).toBe(result.rolls.reduce((sum, r) => sum + r, 0));
  });

  it('respects the sides parameter', () => {
    for (let i = 0; i < 20; i++) {
      const result = rollDice({ sides: 20, count: 1 });
      expect(result.rolls[0]).toBeGreaterThanOrEqual(1);
      expect(result.rolls[0]).toBeLessThanOrEqual(20);
    }
  });

  it('returns an error for sides < 2', () => {
    const result = rollDice({ sides: 1, count: 1 });
    expect(result.error).toBe('A die must have at least 2 sides');
    expect(result.rolls).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('returns an error for count < 1', () => {
    const result = rollDice({ sides: 6, count: 0 });
    expect(result.error).toBe('Must roll at least 1 die');
    expect(result.rolls).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('includes a description in the result', () => {
    const result = rollDice({ sides: 12, count: 2 });
    expect(result.description).toBe(`Rolled a 2d12 to total ${result.total}`);
  });

  it('returns rolls array summing to total', () => {
    const result = rollDice({ sides: 6, count: 5 });
    const sum = result.rolls.reduce((acc, r) => acc + r, 0);
    expect(result.total).toBe(sum);
  });

  it('uses defaults when called with empty object', () => {
    const result = rollDice({});
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls[0]).toBeGreaterThanOrEqual(1);
    expect(result.rolls[0]).toBeLessThanOrEqual(6);
  });
});

describe('rollDiceDefinition', () => {
  it('has type "function"', () => {
    expect(rollDiceDefinition.type).toBe('function');
  });

  it('has name "roll_dice"', () => {
    expect(rollDiceDefinition.name).toBe('roll_dice');
  });

  it('has a non-empty description', () => {
    expect(typeof rollDiceDefinition.description).toBe('string');
    expect(rollDiceDefinition.description.length).toBeGreaterThan(0);
  });

  it('has parameters schema with object type', () => {
    expect(rollDiceDefinition.parameters.type).toBe('object');
  });

  it('has a sides property in parameters', () => {
    const { sides } = rollDiceDefinition.parameters.properties;
    expect(sides).toBeDefined();
    expect(sides.type).toBe('integer');
  });

  it('has a count property in parameters', () => {
    const { count } = rollDiceDefinition.parameters.properties;
    expect(count).toBeDefined();
    expect(count.type).toBe('integer');
  });

  it('requires sides and count', () => {
    expect(rollDiceDefinition.parameters.required).toContain('sides');
    expect(rollDiceDefinition.parameters.required).toContain('count');
  });
});
