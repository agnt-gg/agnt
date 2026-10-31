import { describe, it, expect } from 'vitest';
import { runAnnieTurn, anniePrompt, isAnnie } from './TeamSpaceAnnie.js';

describe('Annie in a teamspace chat', () => {
  it('runs one headless turn as the person who tagged her and returns her answer', async () => {
    let seen;
    const text = await runAnnieTurn({ userId: 'ana', authToken: 'Bearer t', prompt: 'hello' }, async (input) => {
      seen = input;
      input.transport.send('final_content', { content: 'Hi team!' });
    });
    expect(text).toBe('Hi team!');
    expect(seen).toMatchObject({ userId: 'ana', authToken: 'Bearer t', chatType: 'orchestrator', body: { message: 'hello', history: [] } });
  });
  it('a turn with no answer is an error, never a blank message', async () => {
    await expect(runAnnieTurn({ userId: 'ana', authToken: 't', prompt: 'x' }, async (input) => input.transport.send('error', { error: 'no model' }))).rejects.toThrow('no model');
  });
  it('the prompt carries the recent chat with names, then the request', () => {
    const prompt = anniePrompt({ spaceName: 'Sales', message: { body: '@Annie sum up' }, history: [{ author: { kind: 'person', id: 'p1' }, body: 'Globex said yes' }], names: new Map([['p1', 'Jess']]) });
    expect(prompt).toMatch(/"Sales" teamspace/);
    expect(prompt).toMatch(/Jess: Globex said yes/);
    expect(prompt.trim().endsWith('The request: @Annie sum up')).toBe(true);
    expect(isAnnie({ kind: 'agent', id: 'annie' })).toBe(true);
    expect(isAnnie({ kind: 'person', id: 'annie' })).toBe(false);
  });
});
