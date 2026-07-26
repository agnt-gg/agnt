/**
 * Shared provider-message sanitizers.
 *
 * Extracted from OrchestratorService.js so that every outbound LLM call site
 * — orchestrator, LlmExecutionService, AutonomousMessageService — runs the
 * same guards. Previously these were module-private, so the goal/agent and
 * autonomous-message paths could ship an unsanitized history to Anthropic and
 * 400 with "tool_use ids were found without tool_result blocks immediately
 * after" (or "message content must not be empty").
 *
 * This module intentionally has zero imports — keep it dependency-free so it
 * can be imported from anywhere without cycles.
 */

// Synthetic tool_result injected when the stream is aborted mid tool-run.
// Without this, the next turn replays a message list with tool_use blocks that
// have no corresponding tool_result and Anthropic returns:
//   "tool_use ids were found without tool_result blocks immediately after"
const CANCELLED_TOOL_RESULT = JSON.stringify({
  success: false,
  error: 'Tool execution cancelled: stream aborted before completion.',
});

/**
 * Ensure every tool_use (Anthropic) / tool_calls[] (OpenAI-style) has a matching
 * tool_result / role:'tool' reply in the next message. If not, inject a synthetic
 * "cancelled" result so the conversation can be safely replayed to the provider.
 */
function sanitizeOrphanToolCalls(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;
  const out = [];
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const next = msgs[i + 1];
    out.push(msg);

    if (!msg || msg.role !== 'assistant') continue;

    // Anthropic-style: content array with tool_use blocks; tool_results live in the next user message.
    if (Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter((b) => b && b.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        const nextIsToolResultMsg =
          next && next.role === 'user' && Array.isArray(next.content) &&
          next.content.some((b) => b && b.type === 'tool_result');
        const presentIds = nextIsToolResultMsg
          ? new Set(next.content.filter((b) => b && b.type === 'tool_result').map((b) => b.tool_use_id))
          : new Set();
        const orphans = toolUseBlocks.filter((b) => !presentIds.has(b.id));
        if (orphans.length > 0) {
          const syntheticBlocks = orphans.map((b) => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: CANCELLED_TOOL_RESULT,
            is_error: true,
          }));
          if (nextIsToolResultMsg) {
            next.content = [...next.content, ...syntheticBlocks];
          } else {
            out.push({ role: 'user', content: syntheticBlocks });
          }
          console.warn(`[sanitizeOrphanToolCalls] Injected ${orphans.length} synthetic tool_result(s) for orphan tool_use blocks: ${orphans.map((b) => b.id).join(', ')}`);
        }
      }
    }

    // OpenAI-style: tool_calls[] on assistant; each needs a role:'tool' follow-up with matching tool_call_id.
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const presentIds = new Set();
      let j = i + 1;
      while (j < msgs.length && msgs[j] && msgs[j].role === 'tool') {
        if (msgs[j].tool_call_id) presentIds.add(msgs[j].tool_call_id);
        j++;
      }
      const orphans = msg.tool_calls.filter((tc) => tc && tc.id && !presentIds.has(tc.id));
      if (orphans.length > 0) {
        for (const tc of orphans) {
          out.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function?.name || 'unknown',
            content: CANCELLED_TOOL_RESULT,
          });
        }
        console.warn(`[sanitizeOrphanToolCalls] Injected ${orphans.length} synthetic tool message(s) for orphan tool_calls: ${orphans.map((tc) => tc.id).join(', ')}`);
      }
    }
  }
  return out;
}

/**
 * Inverse of sanitizeOrphanToolCalls: remove tool_result blocks whose matching
 * tool_use is missing from the IMMEDIATELY PREVIOUS assistant message.
 *
 * This rescues histories already corrupted by a prior bug (e.g. a refusal turn
 * that dropped tool_use blocks but left the tool_result downstream). Anthropic
 * 400s with "unexpected tool_use_id found in tool_result blocks" on replay;
 * this strips the orphans so the next call goes through.
 *
 * If a user message ends up empty after orphan removal, drop the whole message
 * (Anthropic also rejects empty user content arrays).
 *
 * Also handles the OpenAI-style inverse: role:'tool' messages with no matching
 * tool_calls[] entry on the preceding assistant.
 */
function sanitizeUnexpectedToolResults(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;
  const out = [];
  let removedAnthropic = 0;
  let removedOpenAI = 0;

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];

    // Anthropic-style: user message with tool_result blocks; validate against
    // the previous assistant message's tool_use ids.
    if (
      msg && msg.role === 'user' &&
      Array.isArray(msg.content) &&
      msg.content.some((b) => b && b.type === 'tool_result')
    ) {
      const prev = out[out.length - 1];
      const validIds = new Set();
      if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
        for (const b of prev.content) {
          if (b && b.type === 'tool_use' && b.id) validIds.add(b.id);
        }
      }

      const keptBlocks = [];
      const orphanIds = [];
      for (const b of msg.content) {
        if (b && b.type === 'tool_result') {
          if (validIds.has(b.tool_use_id)) keptBlocks.push(b);
          else orphanIds.push(b.tool_use_id);
        } else {
          keptBlocks.push(b);
        }
      }

      if (orphanIds.length > 0) {
        removedAnthropic += orphanIds.length;
        console.warn(
          `[sanitizeUnexpectedToolResults] Removed ${orphanIds.length} orphan tool_result block(s): ${orphanIds.join(', ')}`,
        );
      }

      if (keptBlocks.length > 0) {
        out.push({ ...msg, content: keptBlocks });
      }
      continue;
    }

    // OpenAI-style: role:'tool' message; validate against preceding assistant's
    // tool_calls[]. Walk back over consecutive role:'tool' messages until we
    // hit the assistant that owns them.
    if (msg && msg.role === 'tool') {
      // Find the most recent non-tool message in out — should be the assistant.
      let prevAssistant = null;
      for (let k = out.length - 1; k >= 0; k--) {
        const candidate = out[k];
        if (!candidate || candidate.role === 'tool') continue;
        if (candidate.role === 'assistant') prevAssistant = candidate;
        break;
      }
      // Collect valid IDs from BOTH possible assistant shapes so a mixed-format
      // history (e.g. a saved Anthropic-format assistant message in a turn
      // that's now being replayed to an OpenAI-compatible provider) doesn't
      // get its valid tool messages mistakenly stripped:
      //   - OpenAI shape: prevAssistant.tool_calls[].id
      //   - Anthropic shape: prevAssistant.content[].tool_use.id
      const validIds = new Set();
      if (prevAssistant && Array.isArray(prevAssistant.tool_calls)) {
        for (const tc of prevAssistant.tool_calls) {
          if (tc && tc.id) validIds.add(tc.id);
        }
      }
      if (prevAssistant && Array.isArray(prevAssistant.content)) {
        for (const block of prevAssistant.content) {
          if (block && block.type === 'tool_use' && block.id) validIds.add(block.id);
        }
      }
      if (msg.tool_call_id && !validIds.has(msg.tool_call_id)) {
        removedOpenAI++;
        console.warn(
          `[sanitizeUnexpectedToolResults] Removed orphan role:'tool' message ` +
          `(tool_call_id=${msg.tool_call_id} not in preceding assistant.tool_calls or content[].tool_use)`,
        );
        continue;
      }
    }

    out.push(msg);
  }

  if (removedAnthropic > 0 || removedOpenAI > 0) {
    console.warn(
      `[sanitizeUnexpectedToolResults] Total removed — anthropic tool_result blocks: ${removedAnthropic}, openai tool messages: ${removedOpenAI}`,
    );
  }
  return out;
}

// Empty-response placeholder text. This string is structural padding for the
// LLM's *next* turn (strict providers reject empty assistant messages). It
// must NEVER reach the user-facing UI — see `extractDisplayText` /
// `scrubEmptyPlaceholder` below for the SSE-boundary scrubbers.
const EMPTY_RESPONSE_PLACEHOLDER = '[The model returned an empty response.]';

/**
 * Extract user-displayable text from any assistant content shape:
 *   - string                             → returned as-is
 *   - Anthropic-style array of blocks    → text blocks joined
 *   - generic object {text|message}      → that field
 *   - anything else                      → ''
 *
 * Used at SSE boundaries so we never JSON.stringify an array into the chat
 * stream (which is exactly how `[{"type":"text","text":"..."}]` was leaking
 * to the UI).
 */
function extractDisplayText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n\n');
  }
  if (content && typeof content === 'object') {
    return content.text || content.message || '';
  }
  return '';
}

/**
 * If the extracted display text is *only* the empty-response placeholder,
 * collapse it to ''. Returns the original text otherwise. Use this at every
 * point where assistant content crosses into the SSE stream or the persisted
 * `final_response` DB field — the placeholder is provider-bookkeeping, not
 * something a human should ever read.
 */
function scrubEmptyPlaceholder(text) {
  if (typeof text !== 'string') return '';
  return text.trim() === EMPTY_RESPONSE_PLACEHOLDER ? '' : text;
}

/**
 * Check whether an assistant message is effectively empty — no text, no tool
 * calls, no tool_use blocks. Strict providers (Anthropic, Kimi, OpenAI) reject
 * these on replay with "must not be empty" 400 errors.
 */
function isEmptyAssistantMessage(msg) {
  if (!msg || msg.role !== 'assistant') return false;

  const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
  if (hasToolCalls) return false;

  const content = msg.content;
  if (typeof content === 'string') {
    return content.trim() === '';
  }
  if (Array.isArray(content)) {
    const hasStructuralBlock = content.some((b) => {
      if (!b || typeof b !== 'object') return false;
      if (b.type === 'text') return typeof b.text === 'string' && b.text.trim() !== '';
      if (b.type === 'tool_use') return true;
      if (b.type === 'image') return true;
      return false;
    });
    return !hasStructuralBlock;
  }
  // null/undefined content with no tool_calls
  return content == null;
}

/**
 * Rescue already-contaminated conversation histories. Walks the inbound
 * message list and drops empty assistant messages whose removal would not
 * orphan a tool_result pair; otherwise pads them with a placeholder so the
 * next provider call doesn't 400 with "message ... must not be empty".
 */
function sanitizeEmptyAssistantMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;

  const EMPTY_PLACEHOLDER = EMPTY_RESPONSE_PLACEHOLDER;
  const out = [];
  let dropped = 0;
  let padded = 0;

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!isEmptyAssistantMessage(msg)) {
      out.push(msg);
      continue;
    }

    // Empty assistant. Dropping is safe only if the surrounding messages don't
    // depend on it (i.e., no following tool_result user message expecting a
    // tool_use from this assistant). If it has no tool_calls/tool_use, it
    // can't be referenced — safe to drop entirely.
    const hasStructuralRef = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (!hasStructuralRef) {
      dropped++;
      continue;
    }

    // Keep structurally but pad content so provider accepts it.
    const patched = { ...msg };
    if (typeof msg.content === 'string' || msg.content == null) {
      patched.content = EMPTY_PLACEHOLDER;
    } else if (Array.isArray(msg.content)) {
      patched.content = [{ type: 'text', text: EMPTY_PLACEHOLDER }, ...msg.content.filter((b) => b && b.type !== 'text')];
    }
    out.push(patched);
    padded++;
  }

  if (dropped > 0 || padded > 0) {
    console.warn(`[sanitizeEmptyAssistantMessages] Rescued history: dropped ${dropped} empty assistant message(s), padded ${padded}`);
  }
  return out;
}

/**
 * Final defense before pushing an assistant message into conversation history.
 * If the adapter-level normalizer missed an empty response, pad it here so
 * it never reaches the next provider call as an empty message.
 */
function safePushAssistantMessage(messages, responseMessage) {
  if (!responseMessage || typeof responseMessage !== 'object') {
    console.warn('[safePushAssistantMessage] Refusing to push non-object assistant message');
    return;
  }
  if (isEmptyAssistantMessage(responseMessage)) {
    console.warn('[safePushAssistantMessage] Adapter returned empty assistant message; padding before history push');
    const padded = { ...responseMessage };
    if (Array.isArray(padded.content)) {
      padded.content = [{ type: 'text', text: EMPTY_RESPONSE_PLACEHOLDER }];
    } else {
      padded.content = EMPTY_RESPONSE_PLACEHOLDER;
    }
    messages.push(padded);
    return;
  }
  messages.push(responseMessage);
}

export {
  CANCELLED_TOOL_RESULT,
  EMPTY_RESPONSE_PLACEHOLDER,
  sanitizeOrphanToolCalls,
  sanitizeUnexpectedToolResults,
  sanitizeEmptyAssistantMessages,
  safePushAssistantMessage,
  isEmptyAssistantMessage,
  extractDisplayText,
  scrubEmptyPlaceholder,
};
