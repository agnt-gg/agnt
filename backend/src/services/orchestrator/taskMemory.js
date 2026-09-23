import AgentMemoryModel from '../../models/AgentMemoryModel.js';
import { buildMemoryDigest } from '../../utils/memoryDigest.js';
import { estimateTokens } from '../../utils/contextManager.js';

export function userMessageText(message) {
  if (typeof message?.content === 'string') return message.content;
  return Array.isArray(message?.content) ? message.content.filter(block => block.type === 'text').map(block => block.text || '').join('\n') : '';
}

/** Only server-owned object identity suppresses a duplicate injection, never a user marker. */
const injected = new WeakSet();
export async function injectTaskMemory(messages, context) {
  const index = messages.findLastIndex(message => message.role === 'user');
  if (index < 0 || !context.userId || injected.has(messages[index])) return;
  const current = messages[index];
  const currentText = context.latestUserMessage || userMessageText(current);
  let query = currentText;
  if (AgentMemoryModel.queryTerms(query).length < 3) {
    const previous = messages.slice(0, index).reverse().find(message => message.role === 'user' && AgentMemoryModel.queryTerms(userMessageText(message)).length >= 3);
    if (previous) query += '\n' + userMessageText(previous).slice(0, 2000);
  }
  try {
    const memories = await AgentMemoryModel.searchRelevant({ userId: context.userId, agentId: context.agentId, query, limit: 5 });
    let linked = memories;
    try {
      const SkillDraftService = (await import('../evolution/SkillDraftService.js')).default;
      linked = await SkillDraftService.linkedMemories(memories, context.userId);
    } catch (error) { console.warn('[TaskMemory] Skill links unavailable:', error.message); }
    const digest = buildMemoryDigest(linked, { estimate: estimateTokens });
    context.taskMemoryIds = digest.memoryIds;
    if (!digest.text) return;
    const content = Array.isArray(current.content)
      ? [...current.content, { type: 'text', text: digest.text }]
      : String(current.content || '') + digest.text;
    messages[index] = { ...current, content };
    injected.add(messages[index]);
  } catch (error) {
    context.taskMemoryIds = [];
    console.warn('[TaskMemory] Retrieval failed:', error.message);
  }
}
