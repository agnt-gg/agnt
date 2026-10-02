/**
 * suggestions.js — the follow-up chips under a chat answer.
 *
 * Pure: the prompt, the parser and the fallback. The handler in
 * OrchestratorService does the I/O through ModelRouter (origin 'suggestion').
 *
 * The parser is also the router's answer check, so it must be strict: null
 * means "try the next model", and a malformed answer that slipped through
 * would render as three empty chips.
 */

export const SUGGESTION_COUNT = 3;
const MAX_TEXT_CHARS = 120;

export const FALLBACK_SUGGESTIONS = Object.freeze([
  Object.freeze({ id: 'fallback_1', text: 'Tell me more about this', icon: '💭' }),
  Object.freeze({ id: 'fallback_2', text: 'Show me an example', icon: '📝' }),
  Object.freeze({ id: 'fallback_3', text: 'What else can you do?', icon: '🔍' }),
]);

export function fallbackSuggestions() {
  return FALLBACK_SUGGESTIONS.map((s) => ({ ...s }));
}

export function buildSuggestionUserPrompt({ lastUserMessage = '', lastAssistantMessage = '' } = {}) {
  return `Based on this conversation:
Last user message: "${lastUserMessage}"
Last assistant response: "${lastAssistantMessage}"

Generate 3 smart, contextual suggestions that would be helpful next steps. Return ONLY the JSON array.`;
}

/** Reasoning tags and code fences removed; the JSON array (or nothing) left. */
function stripToJson(text) {
  let content = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  return start !== -1 && end > start ? content.slice(start, end + 1) : content;
}

/**
 * A model's answer → exactly SUGGESTION_COUNT suggestions, or null.
 * @returns {Array<{text:string, icon:string}>|null}
 */
export function parseSuggestions(text) {
  let parsed;
  try {
    parsed = JSON.parse(stripToJson(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== SUGGESTION_COUNT) return null;
  const items = parsed.map((item) => {
    const raw = typeof item === 'string' ? item : item?.text;
    const label = typeof raw === 'string' ? raw.trim() : '';
    if (!label || label.length > MAX_TEXT_CHARS) return null;
    const icon = typeof item?.icon === 'string' && item.icon.trim() ? item.icon.trim() : '◊';
    return { text: label, icon };
  });
  return items.every(Boolean) ? items : null;
}

/** Ids the client keys its chips on; unique per response. */
export function withIds(items, now = Date.now()) {
  return items.map((item, index) => ({ id: `dynamic_${now}_${index}`, ...item }));
}

/**
 * Generate the chips through ModelRouter, as origin 'suggestion'.
 *
 * Low stake and checked by parseSuggestions, so the router picks the
 * best-value model the user has connected, then the account default and
 * fallbacks, and the chat's own model LAST (alsoTry) — a user with no default
 * still gets suggestions, but a call made after every turn no longer runs on
 * the chat's frontier model by default.
 *
 * Deliberately NOT tagged with the conversation id: the ledger's last call per
 * conversation decides which model's cache is warm, and a side call must not
 * move it.
 *
 * Never throws: chips are a convenience, so any failure degrades to the
 * generic three with the reason attached.
 *
 * @param {object} args
 * @param {Function} complete  ModelRouter.complete (injected for tests)
 * @returns {Promise<{suggestions: Array, error?: string}>}
 */
export async function generateSuggestions({
  userId,
  authToken = null,
  systemPrompt,
  lastUserMessage,
  lastAssistantMessage,
  provider,
  model,
} = {}, complete) {
  try {
    const served = await complete({
      userId,
      authToken,
      origin: 'suggestion',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildSuggestionUserPrompt({ lastUserMessage, lastAssistantMessage }) },
      ],
      alsoTry: provider ? [{ provider, model }] : [],
      intentInput: { outputTokens: 200 },
      validate: (text) => parseSuggestions(text) !== null || 'not three suggestions',
    });
    return { suggestions: withIds(parseSuggestions(served.text)) };
  } catch (error) {
    console.warn('[Suggestions] Falling back to generic suggestions:', error?.message || error);
    return { suggestions: fallbackSuggestions(), error: error?.message || 'Could not generate suggestions' };
  }
}

export default { FALLBACK_SUGGESTIONS, fallbackSuggestions, buildSuggestionUserPrompt, parseSuggestions, withIds, generateSuggestions };
