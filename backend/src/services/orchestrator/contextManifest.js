import crypto from 'crypto';
import { estimateToolTokens } from '../../utils/contextManager.js';
import { priceItems } from '../../utils/contextEconomics.js';

/**
 * The itemized inventory behind the chat's System Monitoring panel.
 *
 * The panel already showed how BIG each bucket was (system / tools / messages).
 * It could never show what was INSIDE one, so a 120k-token tool surface and a
 * 20k one looked identical apart from a number. That mattered little when the
 * surface was static; now that lazy discovery grows it turn by turn, "which
 * tools are loaded and why" is the difference between an obvious problem and
 * an invisible one.
 *
 * Everything here is already computed elsewhere in the request path — this
 * module only collects it into one serializable shape. It is deliberately
 * pure: no I/O, no logging, no mutation of its inputs, so it can be unit
 * tested against real schemas without booting a provider.
 */

const hash = (s) => crypto.createHash('sha1').update(String(s ?? '')).digest('hex').slice(0, 12);

/** Human-readable provenance for a tool. Mirrors the selection rules in chatConfigs. */
export const TOOL_REASONS = {
  default: 'default',      // DEFAULT_TOOLS — always present
  group: 'group',          // matched a keyword TOOL_GROUP
  discovered: 'discovered',// loaded mid-conversation via discover_tools
  universal: 'universal',  // system primitive (mcp_client, tutorial tools)
  specialty: 'specialty',  // sidebar page's locked tool set
  assigned: 'assigned',    // pinned to a saved agent
  selected: 'selected',    // explicitly checked in a narrow whitelist
};

/**
 * @param {object}   input
 * @param {string}   input.systemPrompt
 * @param {Array}    input.promptSections  [{ id, label, tokens, frozen }] dynamic sections
 * @param {Array}    input.toolSchemas     the schemas actually being sent
 * @param {object}   input.toolProvenance  { [toolName]: { reason, group? } }
 * @param {object}   [input.economics]     from buildEconomics() — priced when present
 * @param {object}   input.toolSurfaceMeta { registryTotal, mode, deniedCount, groups }
 * @param {object}   input.contextResult   from manageContext (systemTokens, toolTokens, ...)
 * @param {object}   [input.capResult]     from capToolsToBudget when the surface was capped
 * @param {object}   [input.prior]         previous turn's fingerprints, for cache-prefix stability
 * @returns {{manifest: object, fingerprints: object}}
 */
export function buildContextManifest({
  systemPrompt = '',
  promptSections = [],
  toolSchemas = [],
  toolProvenance = {},
  toolSurfaceMeta = {},
  contextResult = {},
  capResult = null,
  prior = null,
  economics = null,
  cacheTtlMs = null,
} = {}) {
  // A per-turn price on every line item. Sections and tool schemas are re-sent
  // on every single request, so their token count is a recurring charge rather
  // than a one-off — which is the whole reason to itemize them.
  const rate = economics?.rate ?? null;
  // ---- System prompt: dynamic sections + whatever static text remains ----
  const dynamic = promptSections
    .filter((s) => (s.tokens || 0) > 0)
    .map((s) => ({ id: s.id, label: s.label, tokens: s.tokens, frozen: !!s.frozen }));

  const dynamicTotal = dynamic.reduce((acc, s) => acc + s.tokens, 0);
  const systemTokens = contextResult.systemTokens || 0;
  // The residue is the hand-written prompt itself. Clamped at 0: the section
  // estimates and the whole-prompt estimate come from the same estimator, but
  // a section can be transformed slightly during assembly.
  const staticTokens = Math.max(0, systemTokens - dynamicTotal);
  if (staticTokens > 0) {
    dynamic.push({ id: 'static', label: 'Core instructions', tokens: staticTokens, frozen: true });
  }
  dynamic.sort((a, b) => b.tokens - a.tokens);
  const pricedSections = priceItems(dynamic, rate);

  // ---- Tools: itemized, in the exact order they are sent ----
  const tools = toolSchemas.map((schema) => {
    const name = schema.function?.name || '(unnamed)';
    const prov = toolProvenance[name] || {};
    return {
      name,
      tokens: estimateToolTokens([schema]),
      reason: prov.reason || 'default',
      group: prov.group || null,
      trigger: prov.trigger || null,
      round: prov.round ?? null,
    };
  });

  const registryTotal = toolSurfaceMeta.registryTotal || tools.length;
  const droppedCount = capResult?.capped ? (capResult.hiddenCount || 0) : 0;

  const manifest = {
    mode: toolSurfaceMeta.mode || 'auto',
    // null when the model has no pricing metadata. A fabricated $0.00 reads as
    // "this is free", which is a worse answer than "unknown".
    economics: economics || null,
    // How long this provider keeps the prefix. Null when we have no basis for
    // a claim, in which case the panel says nothing about cache freshness
    // rather than inventing a deadline.
    cacheTtlMs: cacheTtlMs ?? null,
    system: {
      total: systemTokens,
      sections: pricedSections,
    },
    tools: {
      total: contextResult.toolTokens || 0,
      count: tools.length,
      registryTotal,
      // Reachable but not loaded — the whole point of the discovery design.
      hiddenCount: Math.max(0, registryTotal - tools.length - droppedCount),
      // Forcibly removed to fit the model's budget or function-count ceiling.
      // Previously this only ever reached a console.warn.
      droppedCount,
      deniedCount: toolSurfaceMeta.deniedCount || 0,
      groups: toolSurfaceMeta.groups || [],
      items: priceItems(tools, rate),
    },
    messages: {
      total: contextResult.messagesTokens || 0,
      count: (contextResult.messages || []).length,
      managed: !!contextResult.wasManaged,
      reduction: contextResult.wasManaged
        ? (contextResult.originalTokens || 0) - (contextResult.managedTokens || 0)
        : 0,
    },
  };

  // ---- Cache prefix stability ----
  // The cached prompt prefix survives only if the system prompt is byte-stable
  // AND the tools array is a prefix-extension of last turn's. Anything else
  // silently re-writes the whole prefix at full price, which is otherwise
  // invisible until the bill arrives.
  const toolNames = tools.map((t) => t.name);
  const fingerprints = {
    system: hash(systemPrompt),
    sections: Object.fromEntries(dynamic.map((s) => [s.id, s.tokens])),
    tools: toolNames.join(','),
    toolCount: toolNames.length,
  };

  if (prior) {
    const systemStable = prior.system === fingerprints.system;
    // Append-only means last turn's list is a literal prefix of this one's.
    const priorTools = prior.tools ? prior.tools.split(',') : [];
    const toolsStable = toolNames.slice(0, priorTools.length).join(',') === prior.tools;

    const changedSections = [];
    for (const [id, tokens] of Object.entries(fingerprints.sections)) {
      if (prior.sections && prior.sections[id] !== undefined && prior.sections[id] !== tokens) {
        changedSections.push(id);
      }
    }

    manifest.cache = {
      prefixStable: systemStable && toolsStable,
      systemStable,
      toolsStable,
      changedSections,
      toolsAdded: Math.max(0, toolNames.length - priorTools.length),
    };
  } else {
    manifest.cache = { prefixStable: true, first: true };
  }

  return { manifest, fingerprints };
}
