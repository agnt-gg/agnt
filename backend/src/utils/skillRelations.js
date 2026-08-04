/**
 * skillRelations.js — First-class inter-skill relationships and extraction provenance.
 *
 * Skills may declare relationships to other skills inside their (spec-legal, free-form)
 * `metadata` frontmatter map. Nothing here adds new top-level frontmatter keys, so
 * agentskills.io portability is preserved — foreign clients simply ignore `metadata`.
 *
 * Shape (YAML frontmatter):
 *   metadata:
 *     relations:
 *       composes-with: [media-use, hyperframes-cli]   # complementary, frequently co-activated
 *       depends-on: [hyperframes-core]                # activate that skill too
 *       supersedes: [old-render-pipeline]             # prefer me; that one is deprecated
 *     provenance:
 *       source-trace: "<goal/execution id>"
 *       extracted: "2026-08-03"
 *       rationale: "Came from trace X; generalizes when Y; fails when Z"
 *       confidence: 0.82
 *
 * Inspired by SkillSmith (arXiv:2607.27497): relationship metadata + extraction
 * rationales enable rationale-conditioned skill composition — here at zero training cost.
 */

/** Canonical relation keys (kebab-case, as written in frontmatter). */
export const RELATION_KEYS = ['composes-with', 'depends-on', 'supersedes'];

/** camelCase aliases accepted on input, normalized away. */
const RELATION_ALIASES = {
  composesWith: 'composes-with',
  dependsOn: 'depends-on',
  supersedes: 'supersedes',
};

/**
 * Lenient slug shape check for relation TARGETS (warn-only, never reject).
 * Mirrors the Agent Skills name rules without importing skillValidation
 * (keeps the dependency graph one-directional: skillValidation → skillRelations).
 */
function isPlausibleSlug(value) {
  return typeof value === 'string'
    && value.length >= 1 && value.length <= 64
    && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)
    && !value.includes('--');
}

/**
 * Coerce metadata (object | JSON string | null) to a plain object or null.
 * DB rows carry metadata as a JSON string; filesystem frontmatter carries an object.
 */
export function coerceMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof metadata === 'object' && !Array.isArray(metadata)) return metadata;
  return null;
}

/**
 * Extract normalized relations from a skill's metadata.
 * Always returns { composesWith: string[], dependsOn: string[], supersedes: string[] }.
 * Accepts kebab-case (canonical) and camelCase (alias) keys; scalars are promoted
 * to single-element arrays; non-string / implausible entries are dropped; deduped.
 */
export function extractRelations(metadata) {
  const empty = { composesWith: [], dependsOn: [], supersedes: [] };
  const meta = coerceMetadata(metadata);
  const relations = meta?.relations;
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return empty;

  const out = { ...empty };
  const keyMap = {
    'composes-with': 'composesWith',
    'depends-on': 'dependsOn',
    'supersedes': 'supersedes',
  };

  for (const [rawKey, rawVal] of Object.entries(relations)) {
    const canonical = RELATION_ALIASES[rawKey] || rawKey;
    const field = keyMap[canonical];
    if (!field) continue; // unknown relation type — validateRelationsMetadata warns
    const values = Array.isArray(rawVal) ? rawVal : [rawVal];
    for (const v of values) {
      const slug = typeof v === 'string' ? v.trim() : null;
      if (slug && isPlausibleSlug(slug) && !out[field].includes(slug)) {
        out[field].push(slug);
      }
    }
  }
  return out;
}

/** True when a relations object (from extractRelations) has any entries. */
export function hasRelations(relations) {
  return !!relations
    && (relations.composesWith?.length > 0
      || relations.dependsOn?.length > 0
      || relations.supersedes?.length > 0);
}

/**
 * Extract provenance from metadata. Returns a normalized object or null.
 * Accepts kebab-case (canonical) and camelCase source-trace keys.
 */
export function extractProvenance(metadata) {
  const meta = coerceMetadata(metadata);
  const prov = meta?.provenance;
  if (!prov || typeof prov !== 'object' || Array.isArray(prov)) return null;

  const out = {};
  const sourceTrace = prov['source-trace'] ?? prov.sourceTrace;
  if (typeof sourceTrace === 'string' && sourceTrace.trim()) out['source-trace'] = sourceTrace.trim();
  if (typeof prov.extracted === 'string' && prov.extracted.trim()) out.extracted = prov.extracted.trim();
  if (typeof prov.rationale === 'string' && prov.rationale.trim()) out.rationale = prov.rationale.trim();
  if (typeof prov.confidence === 'number' && prov.confidence >= 0 && prov.confidence <= 1) {
    out.confidence = prov.confidence;
  }
  if (Array.isArray(prov.history)) out.history = prov.history;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate relations/provenance blocks inside metadata. WARN-ONLY — skills with
 * malformed relation blocks still load; the block is just ignored where invalid.
 *
 * @param {object|string|null} metadata
 * @param {Iterable<string>} [knownSlugs] — when provided, dangling targets are flagged
 * @returns {string[]} warnings
 */
export function validateRelationsMetadata(metadata, knownSlugs = null) {
  const warnings = [];
  const meta = coerceMetadata(metadata);
  if (!meta) return warnings;

  const relations = meta.relations;
  if (relations !== undefined) {
    if (!relations || typeof relations !== 'object' || Array.isArray(relations)) {
      warnings.push('metadata.relations must be a map of relation-type → skill slug list');
      return warnings;
    }

    const canonicalKeys = new Set([...RELATION_KEYS, ...Object.keys(RELATION_ALIASES)]);
    const known = knownSlugs ? new Set(knownSlugs) : null;

    for (const [key, val] of Object.entries(relations)) {
      if (!canonicalKeys.has(key)) {
        warnings.push(`Unknown relation type "${key}" in metadata.relations (expected: ${RELATION_KEYS.join(', ')})`);
        continue;
      }
      const values = Array.isArray(val) ? val : [val];
      for (const v of values) {
        if (typeof v !== 'string' || !isPlausibleSlug(v.trim())) {
          warnings.push(`Relation "${key}" contains invalid skill slug: ${JSON.stringify(v)}`);
        } else if (known && !known.has(v.trim())) {
          warnings.push(`Relation "${key}" references unknown skill "${v.trim()}"`);
        }
      }
    }
  }

  const prov = meta.provenance;
  if (prov !== undefined && (!prov || typeof prov !== 'object' || Array.isArray(prov))) {
    warnings.push('metadata.provenance must be a map');
  }

  return warnings;
}

/**
 * Build a reverse supersession index over a collection of skills.
 * @param {Iterable<{name: string, metadata?: any, frontmatter?: {metadata?: any}}>} skills
 * @returns {Map<string, string[]>} slug → list of skills that declare they supersede it
 */
export function buildSupersededByIndex(skills) {
  const index = new Map();
  for (const skill of skills) {
    const metadata = skill.frontmatter?.metadata ?? skill.metadata;
    const { supersedes } = extractRelations(metadata);
    for (const target of supersedes) {
      if (!index.has(target)) index.set(target, []);
      const list = index.get(target);
      if (!list.includes(skill.name)) list.push(skill.name);
    }
  }
  return index;
}

/**
 * Build the relations payload that activate_skill appends to its response.
 * Model-facing: hints, never auto-activation — the model stays in the loop.
 *
 * @param {object} args
 * @param {object} args.relations       — from extractRelations
 * @param {string[]} [args.supersededBy] — skills that declare they supersede this one
 * @param {Set<string>} [args.activatedSkills] — already-active skills this session
 * @returns {object|null} payload to spread into the activate_skill result, or null
 */
export function buildActivationRelationsPayload({ relations, supersededBy = [], activatedSkills = new Set() }) {
  const payload = {};
  const notes = [];

  if (relations?.dependsOn?.length > 0) {
    payload.depends_on = relations.dependsOn;
    const missing = relations.dependsOn.filter((s) => !activatedSkills.has(s));
    if (missing.length > 0) {
      notes.push(`This skill depends on ${missing.map((s) => `"${s}"`).join(', ')} — activate ${missing.length === 1 ? 'it' : 'them'} too before proceeding.`);
    }
  }

  if (relations?.composesWith?.length > 0) {
    payload.composes_with = relations.composesWith;
    notes.push(`Composes well with: ${relations.composesWith.join(', ')} (activate if relevant to the task).`);
  }

  if (relations?.supersedes?.length > 0) {
    payload.supersedes = relations.supersedes;
    notes.push(`This skill supersedes: ${relations.supersedes.join(', ')} — prefer this skill over those.`);
  }

  if (supersededBy.length > 0) {
    payload.superseded_by = supersededBy;
    notes.push(`WARNING: this skill is superseded by ${supersededBy.map((s) => `"${s}"`).join(', ')} — consider activating the newer skill instead.`);
  }

  if (Object.keys(payload).length === 0) return null;
  payload.relations_note = notes.join(' ');
  return payload;
}

/**
 * Filter a skill catalog: drop entries superseded by another entry PRESENT in the
 * same catalog (token saving + steers the model to the successor). A skill whose
 * successor is absent stays listed — never orphan a capability.
 *
 * @param {Array<{name: string, metadata?: any}>} entries
 * @returns {{ entries: Array, excluded: string[] }}
 */
export function filterSupersededEntries(entries) {
  if (!entries || entries.length === 0) return { entries: entries || [], excluded: [] };
  const index = buildSupersededByIndex(entries);
  const present = new Set(entries.map((e) => e.name));
  const excluded = [];
  const kept = entries.filter((e) => {
    const supersededBy = (index.get(e.name) || []).filter((s) => present.has(s) && s !== e.name);
    if (supersededBy.length > 0) {
      excluded.push(e.name);
      return false;
    }
    return true;
  });
  return { entries: kept, excluded };
}

/**
 * Build SkillForge extraction provenance for a newly forged/refined skill.
 * @param {object} candidate — TraceAnalyzer skillCandidate (may carry rationale)
 * @param {string} sourceGoalId
 */
export function buildForgeProvenance(candidate, sourceGoalId) {
  const prov = {
    'source-trace': sourceGoalId,
    extracted: new Date().toISOString().slice(0, 10),
  };
  if (typeof candidate?.rationale === 'string' && candidate.rationale.trim()) {
    prov.rationale = candidate.rationale.trim();
  }
  if (typeof candidate?.confidence === 'number') {
    prov.confidence = candidate.confidence;
  }
  return prov;
}

/**
 * Normalize a TraceAnalyzer candidate's relatedSkills into canonical
 * metadata.relations shape (kebab-case keys) for persistence. Returns null when
 * the candidate declares no valid relations, so callers can omit the key.
 */
export function relationsFromCandidate(candidate) {
  const related = candidate?.relatedSkills || candidate?.related_skills;
  if (!related) return null;
  const normalized = extractRelations({ relations: related });
  if (!hasRelations(normalized)) return null;
  const out = {};
  if (normalized.composesWith.length > 0) out['composes-with'] = normalized.composesWith;
  if (normalized.dependsOn.length > 0) out['depends-on'] = normalized.dependsOn;
  if (normalized.supersedes.length > 0) out.supersedes = normalized.supersedes;
  return out;
}
