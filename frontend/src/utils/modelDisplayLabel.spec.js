import { describe, it, expect } from 'vitest';
import { modelDisplayLabel } from './modelDisplayLabel.js';

describe('modelDisplayLabel', () => {
  it('names AGNT’s own model by its product name', () => {
    expect(modelDisplayLabel('agnt-flash')).toBe('AGNT Flash');
    expect(modelDisplayLabel(' AGNT-Flash ')).toBe('AGNT Flash');
  });

  it('leaves every other model as its provider calls it', () => {
    expect(modelDisplayLabel('claude-opus-5')).toBe('claude-opus-5');
    expect(modelDisplayLabel('gpt-6.1-sol')).toBe('gpt-6.1-sol');
  });

  it('is empty for nothing, so the pill falls back to “Model”', () => {
    expect(modelDisplayLabel('')).toBe('');
    expect(modelDisplayLabel(undefined)).toBe('');
    expect(modelDisplayLabel(null)).toBe('');
  });
});
