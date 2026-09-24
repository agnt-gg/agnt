/**
 * Deferred tool loading: discovered tools arrive in the MESSAGE HISTORY, never
 * in the tool array, so a discovery can no longer rewrite the cached prefix.
 *
 * WHY. Appending a discovered tool to `tools` changes the first block of the
 * request. Every provider caches `tools -> system -> messages` as one prefix,
 * so the whole conversation is rewritten at the cache-WRITE rate. Measured
 * live 2026-09-24, same conversation, before vs after a discovery:
 *
 *   claude-code opus-5-5   append to tools: 0 of 15,918 read    deferred: 16,007 of 16,011
 *   openai-codex gpt-6     append to tools: 0 of  9,890 read    deferred:  9,728 of  9,890
 *
 * HOW, per provider. Both mechanisms are the vendors' own:
 *
 *   anthropic   Every permitted tool is sent; non-resident ones carry
 *               `defer_loading: true`. Deferred definitions are NOT part of the
 *               cached prefix and cost a flat ~93 tokens however many there
 *               are (1 vs 80 measured identical). discover_tools answers with
 *               a tool_result made ONLY of `tool_reference` blocks (the API
 *               rejects references mixed with text), and the API expands them.
 *   responses   Only resident tools are sent. discover_tools' output is
 *               followed by an `additional_tools` input item carrying the loaded
 *               definitions; OpenAI injects it at that point in the history.
 *   (neither)   A conversation that fails over to a provider without either
 *               mechanism gets resident + loaded tools in the array, which is
 *               exactly the legacy behaviour. A failover is a cold cache anyway.
 *
 * BYTE-EXACTNESS. A load is recorded ONCE, on the tool-result message, as
 * `_agntToolLoad` with a frozen copy of each definition. Every later request
 * renders it from that record, so the bytes never move. Private `_agnt*`
 * fields never reach a wire: each transport renders or strips them.
 *
 * The mode is chosen on a conversation's first turn and then frozen, because
 * switching modes changes the tool array.
 */

export const TOOL_LOAD_FIELD = '_agntToolLoad';
export const DEFERRED_MARK = '_agntDeferred';
/** discover_tools reports the names it loaded under this key; the orchestrator removes it. */
export const TOOL_REFS_KEY = '_tool_refs';

/** Anthropic: every Claude 4.5+ model plus Fable/Mythos (docs, tool-search model table). */
export function anthropicSupportsDeferredTools(model) {
  const m = String(model || '').toLowerCase();
  if (/^claude-(fable|mythos)-\d/.test(m)) return true;
  const v = m.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
  if (!v) return false;
  const major = Number(v[2]);
  const minor = v[3] ? Number(v[3]) : 0;
  return major > 4 || (major === 4 && minor >= 5);
}

/** OpenAI Responses: gpt-5.4 and later (docs: "only gpt-5.4 and later models support tool_search"). */
export function responsesSupportsDeferredTools(model) {
  const v = String(model || '').toLowerCase().match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (!v) return false;
  const major = Number(v[1]);
  const minor = v[2] ? Number(v[2]) : 0;
  return major > 5 || (major === 5 && minor >= 4);
}

/** Kill switch, read per new conversation. Existing conversations keep their frozen mode. */
export function deferredToolsEnabled(env = process.env) {
  return env.AGNT_DEFERRED_TOOLS !== '0';
}

/** 'deferred' | 'legacy'. Called once per conversation, from the primary adapter. */
export function chooseToolLoadingMode(adapter, env = process.env) {
  if (!deferredToolsEnabled(env)) return 'legacy';
  return adapter?.deferredToolStyle?.() ? 'deferred' : 'legacy';
}

/** Non-resident permitted tools, name-sorted so the list never depends on registry order. */
export function buildDeferredCatalog(permittedSchemas, residentNames) {
  const resident = residentNames instanceof Set ? residentNames : new Set(residentNames || []);
  const seen = new Set();
  const catalog = [];
  for (const schema of permittedSchemas || []) {
    const name = schema?.function?.name;
    if (!name || resident.has(name) || seen.has(name)) continue;
    seen.add(name);
    catalog.push(schema);
  }
  return catalog.sort((a, b) => (a.function.name < b.function.name ? -1 : a.function.name > b.function.name ? 1 : 0));
}

/** Loads recorded in the ledger, in order, deduped by name. Reads both ledger shapes. */
export function collectToolLoads(messages) {
  const schemas = [];
  const seen = new Set();
  const take = (load) => {
    for (const schema of load?.schemas || []) {
      const name = schema?.function?.name;
      if (name && !seen.has(name)) { seen.add(name); schemas.push(schema); }
    }
  };
  for (const message of messages || []) {
    if (message?.[TOOL_LOAD_FIELD]) take(message[TOOL_LOAD_FIELD]);
    if (Array.isArray(message?.content)) {
      for (const block of message.content) if (block?.[TOOL_LOAD_FIELD]) take(block[TOOL_LOAD_FIELD]);
    }
  }
  return schemas;
}

/**
 * The tool array for one request.
 * @param {'anthropic'|'responses'|null} style what the receiving transport supports
 */
export function renderToolsForTransport(style, { resident = [], catalog = [], messages = [] }) {
  if (style === 'anthropic') {
    // Resident first: the tool cache marker goes on the last resident tool,
    // and deferred tools may not carry one.
    return [...resident, ...catalog.map((schema) => ({ ...schema, [DEFERRED_MARK]: true }))];
  }
  if (style === 'responses') return resident;
  const residentNames = new Set(resident.map((s) => s.function?.name));
  return [...resident, ...collectToolLoads(messages).filter((s) => !residentNames.has(s.function?.name))];
}

/** A copy of `messages` with every `_agntToolLoad` removed; the same array when there are none. */
export function stripToolLoads(messages) {
  if (!Array.isArray(messages)) return messages;
  const carries = (m) => m?.[TOOL_LOAD_FIELD] || (Array.isArray(m?.content) && m.content.some((b) => b?.[TOOL_LOAD_FIELD]));
  if (!messages.some(carries)) return messages;
  return messages.map((message) => {
    if (!carries(message)) return message;
    const { [TOOL_LOAD_FIELD]: _drop, ...rest } = message;
    if (Array.isArray(rest.content)) {
      rest.content = rest.content.map((block) => {
        if (!block?.[TOOL_LOAD_FIELD]) return block;
        const { [TOOL_LOAD_FIELD]: _gone, ...clean } = block;
        return clean;
      });
    }
    return rest;
  });
}

/**
 * Turn discover_tools' reported names into a ledger record. Returns the result
 * unchanged unless it is a discover_tools result that loaded deferred tools.
 * The `_tool_refs` key is removed from the content the model sees.
 */
export function attachToolLoad(result, catalog) {
  if (result?.name !== 'discover_tools' || typeof result.content !== 'string') return result;
  let parsed;
  try { parsed = JSON.parse(result.content); } catch { return result; }
  if (!parsed || !Array.isArray(parsed[TOOL_REFS_KEY])) return result;
  const { [TOOL_REFS_KEY]: names, ...visible } = parsed;
  const byName = new Map((catalog || []).map((s) => [s.function?.name, s]));
  // A deep copy, so a later registry edit cannot change bytes already sent.
  const schemas = names.map((n) => byName.get(n)).filter(Boolean).map((s) => JSON.parse(JSON.stringify(s)));
  const content = JSON.stringify(visible);
  if (schemas.length === 0) return { ...result, content };
  const guidance = visible.guidance && typeof visible.guidance === 'object'
    ? Object.values(visible.guidance).filter((t) => typeof t === 'string' && t.trim()).join('\n\n')
    : '';
  return {
    ...result,
    content,
    [TOOL_LOAD_FIELD]: { names: schemas.map((s) => s.function.name), schemas, ...(guidance ? { guidance } : {}) },
  };
}

/**
 * Anthropic rendering of recorded loads, applied to converted (Anthropic-shaped)
 * history. A tool_result carrying a load becomes references only; anything else
 * that must still reach the model (guidance, a folded-in steer) moves to text
 * AFTER all tool_result blocks of that message, where the API accepts it.
 *
 * @param {Array<object>} messages Anthropic-shaped history (not mutated)
 * @param {Set<string>|null} availableNames every tool name in this request; null strips loads
 */
export function renderAnthropicToolLoads(messages, availableNames) {
  return messages.map((message) => {
    if (message?.role !== 'user' || !Array.isArray(message.content)) return message;
    if (!message.content.some((b) => b?.[TOOL_LOAD_FIELD])) return message;
    const results = [];
    const trailing = [];
    const rest = [];
    for (const block of message.content) {
      if (!block?.[TOOL_LOAD_FIELD]) { (block?.type === 'tool_result' ? results : rest).push(block); continue; }
      const { [TOOL_LOAD_FIELD]: load, ...clean } = block;
      const refs = availableNames ? (load.names || []).filter((n) => availableNames.has(n)) : [];
      if (refs.length === 0) { results.push(clean); continue; }
      results.push({ type: 'tool_result', tool_use_id: clean.tool_use_id, content: refs.map((tool_name) => ({ type: 'tool_reference', tool_name })) });
      if (load.guidance) trailing.push({ type: 'text', text: `Guidance for the tools just loaded:\n${load.guidance}` });
      // Content appended after the fact (a steer folded in) is the tail of the array.
      if (Array.isArray(clean.content)) trailing.push(...clean.content.slice(1).filter((b) => b?.type === 'text'));
    }
    return { ...message, content: [...results, ...rest, ...trailing] };
  });
}

/** True when a tool_result carries only references, and so may not receive folded text. */
export function isReferenceOnlyResult(block) {
  return block?.type === 'tool_result' && Array.isArray(block.content) && block.content.length > 0
    && block.content.every((b) => b?.type === 'tool_reference');
}
