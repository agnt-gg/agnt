/**
 * conversationFork.js — make a new conversation that starts where another
 * one was cut.
 *
 * A conversation is more than its sidebar transcript. The server holds, per
 * conversation id:
 *   - conversation_logs        the provider transcript (native tool rounds,
 *                              full tool results, thinking blocks) — the
 *                              client's copy is a lossy projection of it;
 *   - conversation_prompt_state the frozen prompt prefix and the cache
 *                              fingerprint that gates rehydration;
 *   - conversation_settings    skill / goal bindings and the AI override;
 *   - conversation_data_refs   offloaded tool data the history refers to.
 *
 * A fork that copied only the sidebar transcript would answer its first turn
 * from the projection — capped tool results, no thinking — so "keep all the
 * context above" would silently not hold. This copies all four under a new id.
 *
 * The log is the one copy that must succeed; the rest fail open (each costs
 * cache reads or a binding, never a turn), and the result says which landed.
 *
 * The caller must already have proven the user owns the source log.
 */

import { randomUUID } from 'crypto';
import ConversationLogModel from '../../models/ConversationLogModel.js';
import ConversationSettingsModel from '../../models/ConversationSettingsModel.js';
import conversationManager from '../ConversationManager.js';
import { copyConversationState } from './conversationStateStore.js';
import { copyDataRefs } from './dataRefStore.js';
import { finalResponseOf } from './transcriptBranching.js';

async function copySettings(fromId, toId, userId) {
  const settings = await ConversationSettingsModel.get(fromId);
  if (!settings) return false;
  if (settings.user_id != null && String(settings.user_id) !== String(userId)) return false;
  await ConversationSettingsModel.upsert({
    conversationId: toId,
    userId,
    activeSkillId: settings.active_skill_id || null,
    activeGoalId: settings.active_goal_id || null,
    provider: settings.provider || null,
    model: settings.model || null,
    routingMode: settings.routing_mode || null,
  });
  return true;
}

/** Run a best-effort copy; a failure is logged and reported as false. */
async function bestEffort(label, sourceId, work) {
  try {
    return await work();
  } catch (error) {
    console.error(`[ConversationFork] ${label} not copied from ${sourceId} (non-critical):`, error.message);
    return false;
  }
}

/**
 * @param {object} args
 * @param {string} args.sourceId   the conversation being forked
 * @param {string} args.userId     its proven owner
 * @param {object} args.log        the source log as read (getByConversationId)
 * @param {Array}  args.messages   the source provider transcript, already cut
 * @returns {Promise<{conversationId: string, copied: {promptState: boolean, settings: boolean, dataRefs: number}}>}
 */
export async function forkConversation({ sourceId, userId, log, messages }) {
  const conversationId = randomUUID();
  await ConversationLogModel.create({
    conversationId,
    userId,
    initial_prompt: log?.initialPrompt ?? null,
    full_history: JSON.stringify(messages),
    final_response: finalResponseOf(messages),
    tool_calls: '[]',
    errors: null,
  });

  const [promptState, settings, dataRefs] = await Promise.all([
    bestEffort('prompt state', sourceId, () => copyConversationState(sourceId, conversationId, userId, conversationManager.get(sourceId))),
    bestEffort('settings', sourceId, () => copySettings(sourceId, conversationId, userId)),
    bestEffort('data refs', sourceId, () => copyDataRefs(sourceId, conversationId, String(userId))),
  ]);

  return { conversationId, copied: { promptState: promptState === true, settings: settings === true, dataRefs: dataRefs || 0 } };
}

export default { forkConversation };
