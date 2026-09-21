import { currentTeamExecution } from '../authorization/TeamExecutionContext.js';
import { currentScopeRequest } from '../authorization/ScopeRequestContext.js';
let runtime = null;
export function installConversationWorkRuntime(value) {
  if (runtime && runtime !== value) throw new Error('Conversation work runtime already installed');
  runtime = value;
}
export async function admitConversationWork(input) {
  if (!runtime?.admit) return false;
  // Existing team execution retains its approved principal/tool boundary.
  // Personal-chat MVP must never capture a team's actor as personal authority.
  if (currentTeamExecution() || currentScopeRequest()) return false;
  await runtime.admit(input);
  return true;
}
export async function pauseConversationWork(conversationId, ownerId) {
  if (!runtime) return false;
  const work = await runtime.store.findActiveConversation(conversationId,ownerId);
  return work ? runtime.pause(work.id,ownerId) : false;
}
export async function steerConversationWork(conversationId, ownerId, { key, text }) {
  if (!runtime) return false;
  if (typeof text !== 'string' || !text.trim()) return false;
  const work = await runtime.store.findActiveConversation(conversationId, ownerId);
  if (!work) return false;
  await runtime.inbox.append(work.id, ownerId, { key, kind: 'steering', payload: { text } });
  return true;
}
export async function conversationWorkStatus(conversationId, ownerId) {
  if (!runtime) return null;
  const work = await runtime.store.findActiveConversation(conversationId,ownerId);
  if (!work) return null;
  return {workId:work.id,status:work.status,reason:work.reason,nextWake:work.next_wake};
}
