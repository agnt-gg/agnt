import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detached } from './detached.js';

afterEach(() => vi.restoreAllMocks());

describe('detached', () => {
  it('a synchronous throw never reaches the caller', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => detached('t', () => { throw new Error('boom'); })).not.toThrow();
    expect(warn.mock.calls[0][1]).toBe('boom');
  });

  it('a non-promise return value is fine', () => {
    expect(() => detached('t', () => undefined)).not.toThrow();
  });

  it('a rejection is logged, not unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    detached('t', async () => { throw new Error('later'); });
    await new Promise((r) => setTimeout(r, 0));
    expect(warn.mock.calls[0][1]).toBe('later');
  });
});

describe('the goal loop\'s follow-ups are all detached', () => {
  it('TaskOrchestrator never calls .catch directly on a fire-and-forget follow-up', () => {
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../services/goal/TaskOrchestrator.js'), 'utf8');
    expect(src).not.toMatch(/InsightTriggers\.onGoalCompleted\([^)]*\)\.catch/);
    expect(src).not.toMatch(/this\._sendGoalResultsToChat\([^)]*\)\.catch/);
    expect((src.match(/detached\('/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
