import { createHash } from 'node:crypto';

export const LESSON_LIMITS = Object.freeze({ when: 300, action: 500, boundary: 300, evidence: 500 });
export const LESSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(Object.entries(LESSON_LIMITS).map(([field, maxLength]) =>
    [field, { type: 'string', minLength: 1, maxLength }])),
  required: Object.keys(LESSON_LIMITS),
};
const normalize = (value) => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';

export function canonicalLesson(lesson) {
  if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) throw new Error('A structured lesson is required');
  if (Object.keys(lesson).some(key => !Object.hasOwn(LESSON_LIMITS, key))) throw new Error('Unknown lesson field');
  return Object.fromEntries(Object.entries(LESSON_LIMITS).map(([field, max]) => {
    const value = normalize(lesson[field]);
    if (!value || value.length > max) throw new Error(`lesson.${field} must contain 1-${max} characters`);
    return [field, value];
  }));
}

/** Exact identity includes evidence and negation, but not the episode's source IDs. */
export function lessonIdentity(lesson, userId, agentId) {
  return 'lesson-' + createHash('sha256').update(JSON.stringify([userId, agentId, canonicalLesson(lesson)])).digest('hex');
}

/** A shared gate for direct saves and automatic extraction. Validation is not a truth judgement. */
export function prepareMemoryWrite(args, { userId, agentId = 'orchestrator', executionId, conversationId, userText = '' }) {
  if (!userId) throw new Error('User context required for memory storage');
  if (args.lesson !== undefined) {
    if (!executionId) throw new Error('An attributable execution is required for a lesson');
    const lesson = canonicalLesson(args.lesson);
    return {
      agentId, userId, memoryType: 'pattern', lesson,
      sourceConversationId: conversationId,
      content: `Lesson v1\nWhen: ${lesson.when}\nDo: ${lesson.action}\nBoundary: ${lesson.boundary}\nEvidence: ${lesson.evidence}\nSource execution: ${executionId}\nSource conversation: ${conversationId || '(none)'}`,
    };
  }
  if (!['fact', 'preference', 'correction'].includes(args.memory_type)) {
    throw new Error('Episode summaries are not durable memories. Supply lesson {when, action, boundary, evidence}, or retain nothing.');
  }
  const statement = normalize(args.user_statement);
  const content = normalize(args.content);
  if (!statement || statement.length > 1200 || !normalize(userText).includes(statement)) {
    throw new Error('user_statement must quote an actual user statement in this episode');
  }
  if (!content || content.length > 1200) throw new Error('Memory content must contain 1-1200 characters');
  return {
    agentId, userId, memoryType: args.memory_type, sourceConversationId: conversationId,
    content: `${content}\nUser statement: ${statement}\nSource execution: ${executionId || '(none)'}\nSource conversation: ${conversationId || '(none)'}`,
  };
}
