/**
 * PRD-057: Slug resolution for ecosystem plugin bundles.
 *
 * Inside a plugin bundle, cross-asset references use `<plugin-name>/<slug>`
 * strings (e.g. an agent's assignedSkills list might contain
 * "finance-pack/gaap-basics"). At install time those slugs are resolved to
 * local DB IDs minted by the install loader.
 *
 * This module is the small primitive both PluginAssetLoader and
 * AgentImportService use for that resolution.
 */

/**
 * Parse a possible slug reference. Returns { plugin, slug } if the input is
 * `<plugin>/<slug>`, or null if it's a bare reference (built-in tool name,
 * raw UUID, etc.) that should pass through unchanged.
 */
export function parseSlugRef(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.match(/^([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9_.-]*)$/i);
  if (!m) return null;
  return { plugin: m[1], slug: m[2] };
}

/**
 * Resolve a single reference. If the value is a `<plugin>/<slug>` reference,
 * try the in-bundle resolution map first, then fall back to the registry of
 * already-installed plugin assets. If the value is bare, return it unchanged.
 *
 * @param {string} ref               raw reference from plugin payload
 * @param {string} assetType         'agent' | 'workflow' | 'skill' | 'widget' | 'tool'
 * @param {object} ctx
 * @param {Map}    ctx.bundleMap     map of `<plugin>/<type>/<slug>` -> local id (built up during install)
 * @param {Function} ctx.lookupInstalled  async (pluginName, assetType, slug) -> local id | null
 * @returns {Promise<string|null>}   resolved local id, or null if unresolved (bare refs return ref unchanged)
 */
export async function resolveAssetRef(ref, assetType, ctx) {
  const parsed = parseSlugRef(ref);
  if (!parsed) return ref; // bare ref, pass through

  const key = `${parsed.plugin}/${assetType}/${parsed.slug}`;
  if (ctx.bundleMap && ctx.bundleMap.has(key)) {
    return ctx.bundleMap.get(key);
  }

  if (ctx.lookupInstalled) {
    try {
      const localId = await ctx.lookupInstalled(parsed.plugin, assetType, parsed.slug);
      if (localId) return localId;
    } catch {}
  }

  // Couldn't resolve — return null so caller can decide (error vs. skip).
  return null;
}

/**
 * Resolve an array of references in parallel. Returns
 * { resolved: [...], missing: [...] }.
 */
export async function resolveRefList(refs, assetType, ctx) {
  if (!Array.isArray(refs)) return { resolved: [], missing: [] };
  const resolved = [];
  const missing = [];
  for (const r of refs) {
    if (!parseSlugRef(r)) {
      // Bare reference — keep as-is.
      resolved.push(r);
      continue;
    }
    const localId = await resolveAssetRef(r, assetType, ctx);
    if (localId) resolved.push(localId);
    else missing.push(r);
  }
  return { resolved, missing };
}

/**
 * Inverse: given a local UUID and a known origin plugin, produce the
 * `<plugin>/<slug>` reference. Used by the Bundle-as-Plugin flow to rewrite
 * cross-asset references back to portable form.
 */
export function makeSlugRef(pluginName, slug) {
  return `${pluginName}/${slug}`;
}
