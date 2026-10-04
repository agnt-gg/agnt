import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUnstartedConversation } from './chatHome.js';

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

  // The home and the title bar must answer the same question, or a blank but
  // titled chat (Main chat) renders its home under a bar, shifted down.
  it('is the one rule Chat and the Focused shell both use', () => {
    const chat = readFileSync(join(DIR, 'Chat.vue'), 'utf8');
    const shell = readFileSync(join(DIR, '../../../../Focused/FocusedShell.vue'), 'utf8');
    expect(chat).toMatch(/isUnstartedConversation\(store\.state\.chat\.messages\)/);
    expect(shell).toMatch(/isUnstartedConversation\(store\.state\.chat\?\.messages\)/);
  });
});
