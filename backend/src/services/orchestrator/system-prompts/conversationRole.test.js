import { describe, it, expect } from 'vitest';
import { loadConversationRoleSection, buildMainChatSection, buildSubChatSection } from './conversationRole.js';

const models = (row, role) => ({
  ContentOutputModel: { findMetaByConversationId: async () => row },
  ConversationRoleModel: { roleOf: async () => role },
});

describe('loadConversationRoleSection', () => {
  const ctx = { conversationId: 'c1', userId: 'u1' };

  it('gives the Main chat the project-manager brief', async () => {
    const section = await loadConversationRoleSection(ctx, models({ id: 'o1' }, { role: 'main' }));
    expect(section).toBe(buildMainChatSection());
    expect(section).toContain('start_chat');
  });

  it('gives a sub-chat the worker brief', async () => {
    expect(await loadConversationRoleSection(ctx, models({ id: 'o2' }, { role: 'sub' }))).toBe(buildSubChatSection());
  });

  it('adds nothing to an ordinary or unsaved conversation', async () => {
    expect(await loadConversationRoleSection(ctx, models({ id: 'o3' }, null))).toBe('');
    expect(await loadConversationRoleSection(ctx, models(null, null))).toBe('');
    expect(await loadConversationRoleSection({}, models({ id: 'o4' }, { role: 'main' }))).toBe('');
  });

  it('never fails the turn when the lookup fails', async () => {
    const broken = { ContentOutputModel: { findMetaByConversationId: async () => { throw new Error('db busy'); } }, ConversationRoleModel: {} };
    expect(await loadConversationRoleSection(ctx, broken)).toBe('');
  });
});
