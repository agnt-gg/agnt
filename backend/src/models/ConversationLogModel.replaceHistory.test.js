/**
 * replaceHistory against real SQLite (the per-run temp database).
 *
 * The route's protection against clobbering a turn that finished between its
 * read and its write rests entirely on `updated_at IS ?` matching the string
 * getByConversationId returned. That is a storage-format property no mock can
 * prove, so it is proven here.
 */
import { describe, it, expect } from 'vitest';
import ConversationLogModel from './ConversationLogModel.js';

const id = () => `replace-history-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('ConversationLogModel.replaceHistory', () => {
  it('writes when updated_at still matches what was read', async () => {
    const conversationId = id();
    await ConversationLogModel.create({ conversationId, userId: 'u1', initial_prompt: 'hi', full_history: '[]', final_response: 'old', tool_calls: '[]', errors: null });
    const read = await ConversationLogModel.getByConversationId(conversationId, 'u1');

    const result = await ConversationLogModel.replaceHistory({
      conversationId,
      full_history: JSON.stringify([{ role: 'assistant', content: 'new' }]),
      final_response: 'new',
      expectedUpdatedAt: read.updatedAt,
    });

    expect(result.updated).toBe(true);
    const after = await ConversationLogModel.getByConversationId(conversationId, 'u1');
    expect(after.messages).toEqual([{ role: 'assistant', content: 'new' }]);
    expect(after.finalResponse).toBe('new');
  });

  it('refuses when the row was written after it was read', async () => {
    const conversationId = id();
    await ConversationLogModel.create({ conversationId, userId: 'u1', initial_prompt: 'hi', full_history: '[]', final_response: 'old', tool_calls: '[]', errors: null });

    const result = await ConversationLogModel.replaceHistory({
      conversationId,
      full_history: '[]',
      final_response: 'new',
      expectedUpdatedAt: '1999-01-01 00:00:00',
    });

    expect(result.updated).toBe(false);
    expect((await ConversationLogModel.getByConversationId(conversationId, 'u1')).finalResponse).toBe('old');
  });
});
