import { PLUGIN_KINDS, checkPluginExamples } from '../../plugins/lib/validate-core.js';

/** Display metadata only. Never expose agent prompts, workflow graphs, widget code or credentials in a catalog. */
export function catalogPresentation(manifest = {}) {
  const output = {};
  for (const kind of ['agents', 'widgets', 'skills', 'workflows']) {
    if (!Array.isArray(manifest[kind])) continue;
    output[kind] = manifest[kind].filter(Boolean).map((entry) => {
      if (typeof entry === 'string') return { slug: entry };
      const definition = entry.payload || entry;
      return {
        slug: entry.slug || definition.id || definition.name,
        name: definition.name || definition.title,
        description: definition.description,
      };
    });
  }
  for (const field of ['category', 'license', 'permissions']) {
    if (manifest[field] != null) output[field] = manifest[field];
  }
  // The store shelf (app / pack / utility), only when it is one of the three.
  const kind = String(manifest.kind || '').trim().toLowerCase();
  if (PLUGIN_KINDS.includes(kind)) output.kind = kind;
  // The publisher's "Try it" asks, only when well-formed.
  const { examples } = checkPluginExamples(manifest);
  if (examples.length) output.examples = examples;
  return output;
}
