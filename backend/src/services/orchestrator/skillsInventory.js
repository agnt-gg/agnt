import { assistantToolCalls } from './historyRehydration.js';
import { ACTIVE_SKILL_OPEN, ACTIVE_SKILL_CLOSE } from './turnContext.js';

/** `<skill name="x">` inside an [ACTIVE SKILL] block (SkillService.buildSkillsContext). */
const PINNED_SKILL_NAME = /<skill name="([^"]*)">/;

/**
 * What skills cost in one request, and where each part lives.
 *
 * Skills reach a request three ways, and the context panel used to show only
 * one of them, as a single "Skills catalog" row inside System prompt:
 *   - the CATALOG: one line per skill in the system block (gists, then a
 *     name-only list, then the activation rules);
 *   - PINNED skills: an agent's assigned-skills highlight, or a skill the
 *     composer injected for this conversation, also in the system block;
 *   - LOADED skills: playbooks returned by activate_skill, which sit in the
 *     message history for the rest of the conversation (never aged).
 *
 * Everything here is recovered from the exact text that was sent: the catalog
 * is frozen per conversation (and persisted), so parsing it shows what this
 * conversation really carries, including one frozen under older rules.
 * Pure: no I/O, no mutation of inputs.
 */

/** Lead-in of the catalog's name-only line. SkillService writes it; this parses it. */
export const NAME_ONLY_LEAD = 'Also installed (name only; call activate_skill with "search" to see what fits, or with the name to load one): ';

const CATALOG_BLOCK = /<available-skills>\n([\s\S]*?)\n?<\/available-skills>/;

/**
 * @param {string} catalogText the frozen skills catalog section
 * @param {(text: string) => number} estimate prose token estimator
 * @returns {null | {
 *   tokens: number,
 *   described: Array<{name: string, tokens: number}>,
 *   namedOnly: string[],
 *   namedOnlyTokens: number,
 *   rulesTokens: number,
 * }}
 */
export function describeSkillCatalog(catalogText, estimate) {
  const text = String(catalogText || '');
  if (!text.trim()) return null;

  const described = [];
  let namedOnly = [];
  let namedOnlyTokens = 0;
  const block = text.match(CATALOG_BLOCK);
  for (const line of block ? block[1].split('\n') : []) {
    if (line.startsWith('- ')) {
      const nameEnd = line.indexOf(': ');
      described.push({ name: (nameEnd > 2 ? line.slice(2, nameEnd) : line.slice(2)).trim(), tokens: estimate(line) });
    } else if (line.startsWith(NAME_ONLY_LEAD)) {
      namedOnly = line.slice(NAME_ONLY_LEAD.length).split('; ').map((n) => n.trim()).filter(Boolean);
      namedOnlyTokens = estimate(line);
    }
  }

  const tokens = estimate(text);
  const listed = described.reduce((sum, s) => sum + s.tokens, 0) + namedOnlyTokens;
  // Whatever is not a skill line: the XML wrapper and the activation rules.
  // Clamped because per-line estimates round up independently.
  return { tokens, described, namedOnly, namedOnlyTokens, rulesTokens: Math.max(0, tokens - listed) };
}

/** Plain text of a tool result, or null for non-text content. */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.map((b) => (typeof b === 'string' ? b : b?.text)).filter((t) => typeof t === 'string');
    return texts.length > 0 ? texts.join('\n') : null;
  }
  return null;
}

/**
 * Skill playbooks loaded into this request's messages: by activate_skill, or
 * pinned with /skill (an [ACTIVE SKILL] block on a user message, turnContext.js).
 * Searches (activate_skill with `search`) load nothing and are skipped, and so
 * is the "None." block a released skill leaves behind.
 * A skill activated twice is one row, its tokens summed.
 *
 * @param {Array<object>} messages the request messages, either provider shape
 * @param {(text: string) => number} estimate prose token estimator
 * @returns {Array<{name: string, tokens: number, activations: number}>}
 */
export function findLoadedSkills(messages, estimate) {
  if (!Array.isArray(messages)) return [];
  const byName = new Map();
  const count = (name, text) => {
    const row = byName.get(name) || { name, tokens: 0, activations: 0 };
    row.tokens += estimate(text);
    row.activations += 1;
    byName.set(name, row);
  };

  for (const message of messages) {
    if (message?.role !== 'user' || typeof message.content !== 'string') continue;
    const start = message.content.indexOf(ACTIVE_SKILL_OPEN);
    const end = start === -1 ? -1 : message.content.indexOf(ACTIVE_SKILL_CLOSE, start);
    if (end === -1) continue;
    const block = message.content.slice(start, end + ACTIVE_SKILL_CLOSE.length);
    const name = block.match(PINNED_SKILL_NAME)?.[1];
    if (name) count(name, block);
  }

  const skillOfCall = new Map();
  for (const message of messages) {
    for (const call of assistantToolCalls(message)) {
      if (call.name !== 'activate_skill') continue;
      const input = call.input || {};
      if (typeof input.search === 'string' && input.search.trim()) continue;
      const name = input.skill_name || input.skill_id;
      if (name) skillOfCall.set(call.id, String(name));
    }
  }
  if (skillOfCall.size === 0) return [...byName.values()];

  const add = (callId, content) => {
    const name = skillOfCall.get(callId);
    const text = name ? resultText(content) : null;
    if (text !== null) count(name, text);
  };
  for (const message of messages) {
    if (message?.role === 'tool' && message.tool_call_id) add(message.tool_call_id, message.content);
    else if (message?.role === 'user' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type === 'tool_result' && block.tool_use_id) add(block.tool_use_id, block.content);
      }
    }
  }
  return [...byName.values()];
}
