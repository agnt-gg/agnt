import { describe, it, expect, vi } from 'vitest';
import { connectionForCaller, chatGptAccountIdOf } from './ModelRoutes.js';
import { getConnection } from '../services/ai/connectionRuntime.js';

// A member who signed in with their own Claude Code was told it was "not
// connected": the model list always came from the instance owner's sign-in.
describe('whose Claude Code / Codex models a caller sees', () => {
  it("a verified caller gets the connection their chats use (a member's own, or a shared one)", async () => {
    const own = { label: 'member-2 own' };
    const resolve = vi.fn(async () => own);
    expect(await connectionForCaller({}, 'claude-code', { resolve, userOf: () => 'member-2' })).toBe(own);
    expect(resolve).toHaveBeenCalledWith('member-2', 'claude-code');
  });

  it('an unverified caller keeps the instance\u2019s own, as before', async () => {
    const resolve = vi.fn();
    expect(await connectionForCaller({}, 'openai-codex', { resolve, userOf: () => null })).toBe(getConnection('openai-codex'));
    expect(resolve).not.toHaveBeenCalled();
  });

  it("reads the ChatGPT account from the token being used, not the owner's", () => {
    const token = `h.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-member' } })).toString('base64url')}.s`;
    expect(chatGptAccountIdOf(token)).toBe('acct-member');
    expect(chatGptAccountIdOf('not-a-jwt')).toBeNull();
  });
});
