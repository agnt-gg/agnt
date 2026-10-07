/**
 * start_chat is the Main chat's alone. It rides in DEFAULT_TOOLS, so before
 * this every conversation was offered it and could spawn "sub-chats" of its
 * own (reported 2026-10-07).
 */
import { describe, it, expect, vi } from 'vitest';
import { conversationRoleOf, withoutMainChatOnlyTools, MAIN_CHAT_ONLY_TOOLS } from './conversationRole.js';
import { DEFAULT_TOOLS } from '../toolSelector.js';

const tool = (name) => ({ type: 'function', function: { name } });
const SURFACE = ['web_search', 'start_chat', 'read_file'].map(tool);
const models = (role, { saved = true } = {}) => ({
  ContentOutputModel: { findMetaByConversationId: vi.fn(async () => (saved ? { id: 'out-1' } : null)) },
  ConversationRoleModel: { roleOf: vi.fn(async () => (role ? { role } : null)) },
});
const names = (schemas) => schemas.map((s) => s.function.name);

describe('Main-chat-only tools', () => {
  it('fixture: start_chat really is a default tool, so filtering is what keeps it out', () => {
    expect(DEFAULT_TOOLS.has('start_chat')).toBe(true);
    expect(MAIN_CHAT_ONLY_TOOLS.has('start_chat')).toBe(true);
  });

  it('the Main chat keeps start_chat', async () => {
    expect(names(await withoutMainChatOnlyTools(SURFACE, { conversationId: 'c', userId: 'u' }, models('main')))).toContain('start_chat');
  });

  it('an ordinary chat, a sub-chat and an unsaved new chat do not get it', async () => {
    for (const [role, opts] of [[null, {}], ['sub', {}], [null, { saved: false }]]) {
      const out = names(await withoutMainChatOnlyTools(SURFACE, { conversationId: 'c', userId: 'u' }, models(role, opts)));
      expect(out).toEqual(['web_search', 'read_file']);
    }
    expect(names(await withoutMainChatOnlyTools(SURFACE, {}, models('main')))).toEqual(['web_search', 'read_file']);
  });

  it('resolves the role once per conversation context', async () => {
    const m = models('main');
    const ctx = { conversationId: 'c', userId: 'u' };
    await conversationRoleOf(ctx, m);
    await conversationRoleOf(ctx, m);
    expect(m.ConversationRoleModel.roleOf).toHaveBeenCalledOnce();
  });

  it('a failed lookup hides the tool and is retried next time', async () => {
    const m = models('main');
    m.ContentOutputModel.findMetaByConversationId.mockRejectedValueOnce(new Error('db busy'));
    const ctx = { conversationId: 'c', userId: 'u' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(names(await withoutMainChatOnlyTools(SURFACE, ctx, m))).not.toContain('start_chat');
    expect(names(await withoutMainChatOnlyTools(SURFACE, ctx, m))).toContain('start_chat');
    warn.mockRestore();
  });
});
