import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUnstartedConversation, withoutWelcome } from './chatHome.js';
import { buildProviderGreeting } from './providerGreeting.js';

const DIR = dirname(fileURLToPath(import.meta.url));

describe('a conversation at its start screen', () => {
  it('is one nobody has spoken in: empty, or only the greeting', () => {
    expect(isUnstartedConversation([])).toBe(true);
    expect(isUnstartedConversation(undefined)).toBe(true);
    expect(isUnstartedConversation([{ role: 'assistant', content: 'Hi!' }])).toBe(true);
  });

  it('ends with the first message', () => {
    expect(isUnstartedConversation([{ role: 'assistant' }, { role: 'user', content: 'go' }])).toBe(false);
  });

  it('is never the home while provider setup is waiting', () => {
    expect(isUnstartedConversation([{ role: 'assistant', showProviderSetup: true }])).toBe(false);
  });

  it('AGNT One draws the transcript without the welcome, but never without the setup card', () => {
    const welcome = buildProviderGreeting(true, { id: 'g1' });
    const setup = buildProviderGreeting(false, { id: 'g2' });
    const legacy = { id: 'g0', role: 'assistant', content: "Hi! I'm Annie, your personal AI assistant. What can I help you build today?" };
    const ask = { id: 'u1', role: 'user', content: 'What can you do for me?' };
    const reply = { id: 'a1', role: 'assistant', content: 'Plenty.' };
    expect(withoutWelcome([welcome, ask, reply]).map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(withoutWelcome([legacy, ask]).map((m) => m.id)).toEqual(['u1']);
    expect(withoutWelcome([setup]).map((m) => m.id)).toEqual(['g2']);
    expect(withoutWelcome(undefined)).toEqual([]);
  });

  // The home and the title bar must answer the same question, or a blank but
  // titled chat (Main chat) renders its home under a bar, shifted down.
  it('is the one rule Chat and the AGNT One shell both use', () => {
    const chat = readFileSync(join(DIR, 'Chat.vue'), 'utf8');
    const shell = readFileSync(join(DIR, '../../../../One/OneShell.vue'), 'utf8');
    expect(chat).toMatch(/isUnstartedConversation\(store\.state\.chat\.messages\)/);
    expect(shell).toMatch(/isUnstartedConversation\(store\.state\.chat\?\.messages\)/);
  });
});
