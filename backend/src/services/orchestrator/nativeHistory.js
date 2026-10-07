/**
 * nativeHistory.js — translate Anthropic-native history into the OpenAI chat
 * shape every non-Anthropic transport is written against.
 *
 * WHY THIS EXISTS
 * ---------------
 * The message ledger is not single-shaped. Claude turns run natively, so the
 * ledger (and the stored transcript historyRehydration restores from) carries
 * Anthropic content blocks:
 *   assistant: [ {type:'thinking'}, {type:'text'}, {type:'tool_use'} ]
 *   user:      [ {type:'tool_result', tool_use_id, content} ]
 * The Anthropic transport already accepts the OpenAI shape as input
 * (_normalizeHistoryMessages). The reverse was missing: the Responses,
 * Chat Completions and Gemini converters read `msg.content` as a string and
 * `msg.tool_calls` for calls. Handed native blocks — which is exactly what a
 * provider FAILOVER does, because rehydration targets the primary tier and
 * the chain then re-points the same ledger at another provider — Codex
 * rejected the turn with:
 *   400 Invalid type for 'input[0].content[0].text': expected a string, but got an array
 *
 * THE RULE
 * --------
 * Called at each non-Anthropic transport's outbound choke point, so whatever
 * shape reaches a transport, it sends its own wire format. Translation is
 * lossless for everything the target can represent; `thinking` /
 * `redacted_thinking` are dropped because their signatures only verify on
 * Anthropic.
 *
 * Returns the INPUT ARRAY ITSELF when nothing is native, so the common path
 * allocates nothing and its bytes (and prompt-cache prefix) are untouched.
 * Never mutates its input: the array handed to an adapter is the live ledger.
 */

import { TOOL_LOAD_FIELD } from './deferredTools.js';

const DROPPED_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking']);

function isNativeBlockArray(content) {
  return Array.isArray(content) && content.some((block) => block && typeof block === 'object' && (
    block.type === 'tool_use'
    || block.type === 'tool_result'
    || block.type === 'image'
    || DROPPED_BLOCK_TYPES.has(block.type)
    || block.type === 'text'
  ));
}

/** True when a message must be translated before an OpenAI-shaped transport can read it. */
export function isAnthropicNativeMessage(msg) {
  if (!msg || (msg.role !== 'assistant' && msg.role !== 'user')) return false;
  if (!isNativeBlockArray(msg.content)) return false;
  // A user message of only OpenAI parts ({type:'text'} / {type:'image_url'}) is
  // already valid OpenAI input; leave it byte-identical.
  if (msg.role === 'user') {
    return msg.content.some((block) => block?.type === 'tool_result' || block?.type === 'image' || DROPPED_BLOCK_TYPES.has(block?.type));
  }
  return true;
}

function joinText(blocks) {
  return blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n\n');
}

/** A tool_result's content as the string OpenAI tool messages require. */
function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((part) => {
    if (part?.type === 'text') return part.text || '';
    if (part?.type === 'tool_reference') return `Loaded tool: ${part.tool_name}`;
    if (part?.type === 'image') return '[image]';
    return JSON.stringify(part);
  }).filter(Boolean).join('\n');
}

function imageBlockToPart(block) {
  const source = block.source || {};
  const url = source.type === 'base64' ? `data:${source.media_type};base64,${source.data}` : source.url;
  return url ? { type: 'image_url', image_url: { url } } : null;
}

function translateAssistant(msg) {
  const toolCalls = msg.content
    .filter((block) => block?.type === 'tool_use' && block.id)
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name || 'unknown', arguments: JSON.stringify(block.input ?? {}) },
    }));
  const text = joinText(msg.content);
  if (!text && toolCalls.length === 0) return []; // thinking-only: nothing the target can carry
  const { content: _native, ...rest } = msg;
  return [{ ...rest, content: text || (toolCalls.length > 0 ? null : ''), ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }];
}

function translateUser(msg) {
  const out = [];
  const rest = [];
  for (const block of msg.content) {
    if (block?.type === 'tool_result') {
      out.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: toolResultText(block.content),
        ...(block[TOOL_LOAD_FIELD] ? { [TOOL_LOAD_FIELD]: block[TOOL_LOAD_FIELD] } : {}),
      });
    } else if (block && !DROPPED_BLOCK_TYPES.has(block.type)) {
      rest.push(block);
    }
  }
  // Text or images that rode in the same Anthropic user turn (a follow-up the
  // alternation merge folded in) follow the tool results as their own message.
  const parts = rest.map((block) => {
    if (block.type === 'image') return imageBlockToPart(block);
    if (block.type === 'text') return { type: 'text', text: block.text || '' };
    return block; // already an OpenAI part (image_url, …)
  }).filter(Boolean);
  if (parts.length > 0) {
    const onlyText = parts.every((part) => part.type === 'text');
    out.push({ role: 'user', content: onlyText ? parts.map((part) => part.text).join('\n\n') : parts });
  }
  return out;
}

/**
 * The OpenAI-shaped equivalent of `messages`. Same array when nothing needed
 * translating; otherwise a new array with only native messages replaced.
 */
export function toOpenAIHistory(messages) {
  if (!Array.isArray(messages) || !messages.some(isAnthropicNativeMessage)) return messages;
  return messages.flatMap((msg) => {
    if (!isAnthropicNativeMessage(msg)) return [msg];
    return msg.role === 'assistant' ? translateAssistant(msg) : translateUser(msg);
  });
}
