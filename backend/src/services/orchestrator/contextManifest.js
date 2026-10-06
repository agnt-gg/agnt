import crypto from 'crypto';
import { estimateTokens, estimateToolTokens } from '../../utils/contextManager.js';
import { priceItems } from '../../utils/contextEconomics.js';
import { describeSkillCatalog, findLoadedSkills } from './skillsInventory.js';

/** System sections that are skills. They are reported under `skills`, not `system`. */
export const SKILL_SECTION_IDS = new Set(['skills', 'skills_assigned', 'skills_pinned']);

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

/**
 * Unit marker for every token count leaving the backend.
 *
 * Estimates are emitted RAW and carry the `calibration` factor beside them;
 * the display boundary multiplies once. The marker exists so that conversion
 * is IDEMPOTENT rather than positional — a payload replayed on reconnect, or
 * restored from the frontend's localStorage cache, can be re-checked instead
 * of re-scaled.
 *
 * Its ABSENCE is meaningful too: payloads written before this change were
 * already calibrated, so "no unit" correctly means "do not touch", and the
 * cached-status migration is a no-op in both directions.
 */
export const TOKEN_UNIT_RAW = 'raw';

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
 * Which system sections differ between two turns, by id.
 *
 * A section that appeared or disappeared is reported as such; it used to be
 * dropped (only ids present on BOTH turns were compared), so a section that
 * came and went was never named. 'static' is not real text but the residue
 * total minus named sections, so it moves by a few tokens whenever any named
 * section moves; it is reported only when nothing named explains the change.
 */
export function diffSections(prior, current) {
  const ids = (sections) => Object.keys(sections).filter((id) => id !== 'static');
  const sectionsAdded = ids(current).filter((id) => prior[id] === undefined);
  const sectionsRemoved = ids(prior).filter((id) => current[id] === undefined);
  const changedSections = ids(current).filter((id) => prior[id] !== undefined && prior[id] !== current[id]);
  const namedChange = sectionsAdded.length + sectionsRemoved.length + changedSections.length > 0;
  if (!namedChange && prior.static !== current.static) changedSections.push('static');
  return { changedSections, sectionsAdded, sectionsRemoved };
}

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
 * @param {number}   [input.calibration]   estimate->real factor for the display boundary
 * @param {object}   [input.skillsText]    { catalog, assigned }: the exact skill text in the system prompt
 * @returns {{manifest: object, fingerprints: object}}
 */
export function buildContextManifest({
  systemPrompt = '',
  promptSections = [],
  skillsText = null,
  toolSchemas = [],
  toolProvenance = {},
  toolSurfaceMeta = {},
  contextResult = {},
  capResult = null,
  prior = null,
  economics = null,
  cacheTtlMs = null,
  cacheBestEffort = false,
  servedProvider = null,
  servedModel = null,
  calibration = 1,
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
  // Skills get their own group; the residue above was computed with them in,
  // so system.total stays the whole system bucket.
  const pricedSections = priceItems(dynamic.filter((s) => !SKILL_SECTION_IDS.has(s.id)), rate);
  const skills = buildSkillsGroup({
    sections: dynamic.filter((s) => SKILL_SECTION_IDS.has(s.id)),
    skillsText,
    messages: contextResult.messages,
    messagesTotal: contextResult.messagesTokens || 0,
    rate,
  });

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
    // Raw estimates + the factor to convert them. This event and the
    // context_status event render side by side in one panel, so they MUST
    // agree on units; shipping the factor rather than the product is what
    // makes that structural instead of a convention two files have to keep.
    unit: TOKEN_UNIT_RAW,
    calibration: Number.isFinite(calibration) && calibration > 0 ? calibration : 1,
    // null when the model has no pricing metadata. A fabricated $0.00 reads as
    // "this is free", which is a worse answer than "unknown".
    economics: economics || null,
    // How long this provider keeps the prefix. Null when we have no basis for
    // a claim, in which case the panel says nothing about cache freshness
    // rather than inventing a deadline.
    cacheTtlMs: cacheTtlMs ?? null,
    // True for providers whose cache is automatic, server-side and documented
    // as opportunistic (Groq: byte-identical requests measurably flip between
    // hit and miss, and no affinity parameter exists). Lets the panel present
    // a miss as expected behaviour rather than as a broken cache.
    cacheBestEffort: !!cacheBestEffort,
    // Which provider actually answered (invariant I3). Null on the first emit
    // — nothing has run yet — and set when a failover re-emits the manifest,
    // so a panel can never attribute one provider's cache economics to a
    // request that a different provider served.
    servedProvider: servedProvider ?? null,
    servedModel: servedModel ?? null,
    system: {
      // The whole system bucket, skills included, so it matches context_status.
      // `skills.resident` is the part of it the Skills group shows instead.
      total: systemTokens,
      sections: pricedSections,
    },
    skills,
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

    const { changedSections, sectionsAdded, sectionsRemoved } = diffSections(prior.sections || {}, fingerprints.sections);

    manifest.cache = {
      prefixStable: systemStable && toolsStable,
      systemStable,
      toolsStable,
      changedSections,
      sectionsAdded,
      sectionsRemoved,
      toolsAdded: Math.max(0, toolNames.length - priorTools.length),
    };
  } else {
    manifest.cache = { prefixStable: true, first: true };
  }

  return { manifest, fingerprints };
}

/**
 * The Skills group: every skill this request carries, from either bucket.
 *
 *   resident = catalog + assigned + pinned (/skill) skills, inside system.total
 *   loaded   = activate_skill playbooks, inside messages.total
 *   total    = resident + loaded
 *
 * The section token counts are authoritative for the resident part (the same
 * numbers the cache fingerprints use); the parsed per-skill lines only
 * itemize them.
 */
function buildSkillsGroup({ sections, skillsText, messages, messagesTotal, rate }) {
  const sectionTokens = (id) => sections.find((s) => s.id === id)?.tokens || 0;
  const catalogTokens = sectionTokens('skills');
  const assignedTokens = sectionTokens('skills_assigned');
  const pinned = sections.find((s) => s.id === 'skills_pinned');
  const pinnedTokens = pinned?.tokens || 0;
  const parsed = catalogTokens > 0 ? describeSkillCatalog(skillsText?.catalog, estimateTokens) : null;

  const loadedItems = findLoadedSkills(messages, estimateTokens).sort((a, b) => b.tokens - a.tokens);
  // Per-result estimates can overshoot the bucket they live in by rounding;
  // the group may never claim more of the messages than there is.
  const loadedTokens = Math.min(messagesTotal, loadedItems.reduce((sum, s) => sum + s.tokens, 0));
  const resident = catalogTokens + assignedTokens + pinnedTokens;

  return {
    total: resident + loadedTokens,
    resident,
    loadedTokens,
    catalog: {
      tokens: catalogTokens,
      describedCount: parsed?.described.length || 0,
      namedOnlyCount: parsed?.namedOnly.length || 0,
      namedOnlyTokens: parsed?.namedOnlyTokens || 0,
      rulesTokens: parsed?.rulesTokens || 0,
      items: priceItems((parsed?.described || []).slice().sort((a, b) => b.tokens - a.tokens), rate),
    },
    assigned: { tokens: assignedTokens },
    pinned: pinned ? priceItems([{ name: pinned.label, tokens: pinnedTokens }], rate)[0] : null,
    loaded: priceItems(loadedItems, rate),
  };
}
