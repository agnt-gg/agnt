/**
 * Editing a Plugin Forge draft by hand: the rules behind the Overview's Edit
 * form and "Start from scratch".
 *
 * The draft is the same one the Forge chat edits (store/features/pluginBuilder):
 * manifest.json, one code file per tool, package.json. Nothing here talks to
 * the backend; Install builds whatever the draft holds, exactly as before.
 *
 * The form edits the manifest in plain terms (a field's kind, not its
 * type/inputType pair) and never drops what it does not show: a field's
 * conditional rules, defaults and any other keys survive a round trip.
 */

/** "My Weather Tool!" -> "my-weather-tool"; never empty. */
export function slugify(text, fallback = 'my-plugin') {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

/** What a person picks; what the manifest stores. */
export const FIELD_KINDS = Object.freeze([
  { id: 'text', label: 'Text', type: 'string', inputType: 'text' },
  { id: 'textarea', label: 'Long text', type: 'string', inputType: 'textarea' },
  { id: 'number', label: 'Number', type: 'number', inputType: 'number' },
  { id: 'checkbox', label: 'Yes / no', type: 'boolean', inputType: 'checkbox' },
  { id: 'select', label: 'Choice', type: 'string', inputType: 'select' },
  { id: 'codearea', label: 'Code', type: 'string', inputType: 'codearea' },
]);

export const OUTPUT_TYPES = Object.freeze(['string', 'number', 'boolean', 'object', 'array']);

export function kindOf(spec = {}) {
  if (spec.inputType === 'select') return 'select';
  if (spec.inputType === 'checkbox' || spec.type === 'boolean') return 'checkbox';
  if (spec.inputType === 'textarea') return 'textarea';
  if (spec.inputType === 'codearea') return 'codearea';
  if (spec.type === 'number' || spec.inputType === 'number') return 'number';
  return 'text';
}

/** manifest parameters object -> rows the form edits (order kept). */
export function fieldsFromParameters(parameters = {}) {
  return Object.entries(parameters || {}).map(([name, spec = {}]) => {
    const { type, inputType, description, required, options, ...rest } = spec || {};
    return {
      name,
      kind: kindOf(spec || {}),
      description: description || '',
      required: Boolean(required),
      options: Array.isArray(options) ? options.join(', ') : '',
      rest,
    };
  });
}

/** Rows -> manifest parameters. Blank names are dropped; duplicates keep the first. */
export function parametersFromFields(fields = []) {
  const parameters = {};
  for (const field of fields) {
    const name = String(field.name || '').trim();
    if (!name || parameters[name]) continue;
    const kind = FIELD_KINDS.find((entry) => entry.id === field.kind) || FIELD_KINDS[0];
    const spec = { ...(field.rest || {}), type: kind.type, inputType: kind.inputType };
    if (field.description?.trim()) spec.description = field.description.trim();
    if (field.required) spec.required = true;
    if (kind.id === 'select') {
      spec.options = String(field.options || '').split(',').map((option) => option.trim()).filter(Boolean);
    }
    parameters[name] = spec;
  }
  return parameters;
}

export function outputsFromSchema(outputs = {}) {
  return Object.entries(outputs || {}).map(([name, spec = {}]) => {
    const { type, description, ...rest } = spec || {};
    return { name, type: OUTPUT_TYPES.includes(type) ? type : 'string', description: description || '', rest };
  });
}

export function schemaFromOutputs(rows = []) {
  const outputs = {};
  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name || outputs[name]) continue;
    outputs[name] = { ...(row.rest || {}), type: row.type || 'string', ...(row.description?.trim() ? { description: row.description.trim() } : {}) };
  }
  return outputs;
}

/** A tool's code: the shape every plugin tool needs, ready to fill in. */
export function toolCodeStub(type, title = type) {
  const className = slugify(type, 'tool').split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('') || 'Tool';
  return `// ${title}
class ${className} {
  constructor() {
    this.name = '${type}'; // must equal the tool's type in manifest.json
  }

  // params: the tool's input fields. A sign-in's key or token, when the tool
  // has one, arrives as params.__auth.token.
  async execute(params, inputData, workflowEngine) {
    try {
      // Your logic here.
      return { success: true, result: params };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default new ${className}();
`;
}

const DEFAULT_OUTPUTS = { success: { type: 'boolean', description: 'Whether it worked' }, result: { type: 'object', description: 'What it produced' }, error: { type: 'string', description: 'What went wrong, if anything' } };

/** A new tool entry and its code file, with a type unused in this manifest. */
export function newTool(manifest = {}, title = 'New tool') {
  const taken = new Set((manifest.tools || []).map((tool) => tool.type));
  const base = slugify(title, 'tool');
  let type = base;
  for (let n = 2; taken.has(type); n++) type = `${base}-${n}`;
  const file = `${type}.js`;
  const tool = {
    type,
    entryPoint: `./${file}`,
    schema: { title, category: 'action', type, icon: manifest.icon || 'custom', description: '', parameters: {}, outputs: { ...DEFAULT_OUTPUTS } },
  };
  return { tool, file, code: toolCodeStub(type, title) };
}

/** "Start from scratch": a complete, installable draft with one tool. */
export function blankDraft(displayName = 'My plugin') {
  const name = slugify(displayName);
  const manifest = {
    name,
    displayName,
    version: '1.0.0',
    description: '',
    author: 'AGNT User',
    icon: 'custom',
    permissions: { capabilities: [], domains: [] },
    tools: [],
  };
  const { tool, file, code } = newTool(manifest, displayName);
  manifest.tools.push(tool);
  return { manifest, files: { [file]: code }, packageJson: { name, version: '1.0.0', type: 'module', main: file } };
}

/** The code file a tool runs, from its entryPoint ("./x.js" -> "x.js"). */
export const toolFile = (tool) => String(tool?.entryPoint || '').replace(/^\.\//, '');

// ── Sign-ins ──────────────────────────────────────────────────────────────────────
// The Forge's Sign-in tab. A sign-in a tool names must be connectable by
// anyone who installs the plugin: bundled in manifest.auth, or shared by AGNT.
// The authoritative check is backend/plugins/lib/validate-core.js
// checkPluginSignIns, run at build, install and publish; this mirrors its
// classification so the tab can show it while you edit.

export const SIGN_IN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const lower = (value) => String(value || '').trim().toLowerCase();
const https = (value) => {
  try {
    return new URL(String(value)).protocol === 'https:';
  } catch {
    return false;
  }
};

/** The sign-in each tool names, lowercased (or '' for none). */
export function toolSignIn(tool) {
  return lower(tool?.schema?.authProvider || tool?.authProvider);
}

/**
 * One row per sign-in the plugin uses or bundles.
 * source: 'plugin' (bundled) | 'shared' (AGNT) | 'unresolved' (only its author could connect it)
 */
export function signInRows(manifest = {}, { shared = [], connectedIds = [] } = {}) {
  const sharedById = new Map(shared.map((provider) => [lower(provider.id), provider]));
  const declared = new Map((Array.isArray(manifest.auth) ? manifest.auth : []).map((entry) => [lower(entry.id), entry]));
  const connected = new Set(connectedIds.map(lower));
  const ids = [...new Set([...declared.keys(), ...(manifest.tools || []).map(toolSignIn).filter(Boolean)])];
  return ids.map((id) => {
    const usedBy = (manifest.tools || []).filter((tool) => toolSignIn(tool) === id).map((tool) => tool.schema?.title || tool.type);
    const source = sharedById.has(id) ? 'shared' : declared.has(id) ? 'plugin' : 'unresolved';
    const entry = declared.get(id) || sharedById.get(id) || {};
    return {
      id,
      name: entry.name || id,
      source,
      kind: (entry.type || entry.connection_type) === 'oauth2' || (entry.type || entry.connection_type) === 'oauth' ? 'oauth' : 'apikey',
      connected: connected.has(id),
      usedBy,
      // A bundled entry named after a shared sign-in is refused at publish.
      redefinesShared: sharedById.has(id) && declared.has(id),
    };
  });
}

/** Point a tool at a sign-in (or none). authRequired follows the sign-in's kind. */
export function setToolSignIn(manifest, toolType, signInId, kind = 'apikey') {
  return {
    ...manifest,
    tools: (manifest.tools || []).map((tool) => {
      if (tool.type !== toolType) return tool;
      const schema = { ...(tool.schema || {}) };
      delete schema.authProvider;
      delete schema.authRequired;
      const next = { ...tool, schema };
      delete next.authProvider;
      delete next.authRequired;
      if (signInId) {
        schema.authProvider = signInId;
        schema.authRequired = kind === 'oauth' ? 'oauth' : 'apiKey';
      }
      return next;
    }),
  };
}

/** A new bundled sign-in entry, as the form edits it. */
export function blankSignIn(kind = 'apikey', name = '') {
  return kind === 'oauth'
    ? { id: slugify(name, ''), name, type: 'oauth2', authorizationUrl: '', tokenUrl: '', scopes: '', clientId: '', instructions: '', helpUrl: '' }
    : { id: slugify(name, ''), name, type: 'apikey', keyLabel: 'API key', instructions: '', helpUrl: '' };
}

/** Form row -> manifest.auth entry (blanks dropped, scopes split). Never carries a secret: the form has no field for one. */
export function signInEntry(row) {
  const entry = { id: lower(row.id), name: String(row.name || '').trim() || lower(row.id), type: row.type === 'oauth2' ? 'oauth2' : 'apikey' };
  const put = (key, value) => {
    const text = String(value ?? '').trim();
    if (text) entry[key] = text;
  };
  put('icon', row.icon);
  put('instructions', row.instructions);
  put('helpUrl', row.helpUrl);
  if (entry.type === 'apikey') {
    put('keyLabel', row.keyLabel);
  } else {
    put('authorizationUrl', row.authorizationUrl);
    put('tokenUrl', row.tokenUrl);
    put('clientId', row.clientId);
    const scopes = (Array.isArray(row.scopes) ? row.scopes : String(row.scopes || '').split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean);
    if (scopes.length) entry.scopes = scopes;
  }
  return entry;
}

/** manifest.auth entry -> form row. */
export function signInRow(entry = {}) {
  return { ...blankSignIn(entry.type === 'oauth2' ? 'oauth' : 'apikey', entry.name || ''), ...entry, scopes: Array.isArray(entry.scopes) ? entry.scopes.join(', ') : entry.scopes || '' };
}

/** What is wrong with a bundled sign-in, in words; [] when it is fine. */
export function signInProblems(row, { sharedIds = [], otherIds = [] } = {}) {
  const problems = [];
  const id = lower(row.id);
  if (!SIGN_IN_ID.test(id)) problems.push('The id uses lowercase letters, numbers, - and _ only.');
  if (sharedIds.map(lower).includes(id)) problems.push(`"${id}" is already a sign-in AGNT shares. Pick it for your tools instead of bundling your own.`);
  if (otherIds.map(lower).includes(id)) problems.push(`Another bundled sign-in is already "${id}".`);
  if (row.helpUrl && !https(row.helpUrl)) problems.push('The help link must start with https://.');
  if (row.type === 'oauth2') {
    if (!https(row.authorizationUrl)) problems.push('The authorization URL must start with https://.');
    if (!https(row.tokenUrl)) problems.push('The token URL must start with https://.');
  }
  return problems;
}
