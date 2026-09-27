import { describe, it, expect } from 'vitest';
import { titleCase } from './titleCase.js';

describe('titleCase', () => {
  it('turns desktop capitals into readable words', () => {
    expect(titleCase('AGENTS')).toBe('Agents');
    expect(titleCase('WIDGET FORGE')).toBe('Widget Forge');
    expect(titleCase('APPROVALS')).toBe('Approvals');
  });

  it('keeps acronyms as acronyms', () => {
    expect(titleCase('AI PROVIDERS')).toBe('AI Providers');
    expect(titleCase('MCP SERVERS')).toBe('MCP Servers');
    expect(titleCase('OAUTH APPS')).toBe('OAuth Apps');
  });

  it('preserves separators', () => {
    expect(titleCase('APPS/PLUGINS')).toBe('Apps/Plugins');
    expect(titleCase('SELF-IMPROVE')).toBe('Self-Improve');
  });

  it('leaves mixed-case and empty labels alone', () => {
    expect(titleCase('Morning briefing')).toBe('Morning briefing');
    expect(titleCase('')).toBe('');
    expect(titleCase(undefined)).toBe('');
  });
});
