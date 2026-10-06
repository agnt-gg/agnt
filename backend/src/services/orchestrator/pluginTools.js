/**
 * Plugin Forge tools — how the Plugin Forge chat builds a plugin.
 *
 * THE DRAFT LIVES IN THE BROWSER. Plugin Forge keeps the plugin being written
 * in the frontend `pluginBuilder` store (persisted locally, edited by hand in
 * the Code tab). Every chat turn ships it as `pluginState`:
 *
 *   pluginState = {
 *     name:         manifest name, or '' before one exists
 *     files:        { 'manifest.json': '…', 'search.js': '…', 'package.json': '…' }
 *     installState: 'none' | 'draft' | 'changed' | 'installed'
 *   }
 *
 * These tools edit that object IN PLACE, so a later call in the same turn sees
 * the earlier call's change, and report each change back as a `frontendEvent`
 * the page applies to its store. The same contract Widget Forge uses for
 * `widgetState`, for the same reason: the user watches the edit land.
 *
 * WRITES GO THROUGH THE HTTP ROUTES, NOT AROUND THEM. Install, load and test
 * call the app's own API with the caller's token, so the plugin account
 * boundary and the serialized install queue (pluginAccountRoutes.js) apply to
 * the chat exactly as they apply to the buttons.
 *
 * WHY EDITS AND NOT REGENERATION. The Forge chat this replaces sent every
 * message to a three-step code generator: a question rewrote the whole plugin
 * and bumped its version. `edit_plugin_file` changes the lines asked for;
 * `generate_plugin` exists only for a plugin that does not exist yet.
 */
import { bumpVersion, determineVersionBump } from '../pluginContract.js';
import { fuzzyFind } from './fuzzyFind.js';

const MANIFEST = 'manifest.json';
const PACKAGE = 'package.json';
const JSON_FILES = new Set([MANIFEST, PACKAGE]);

/** Top-level files, or one level inside a bundled-asset directory. Nothing else. */
const PLUGIN_FILE_NAME = /^(?:(?:agents|workflows|skills|widgets|tools)\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
/** Same rule pluginAccountRoutes.js applies to a plugin name. */
const PLUGIN_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
/** Test output handed back to the model; the full text is in the Test tab. */
const MAX_TEST_OUTPUT_CHARS = 4000;

const FORGE_REQUIRED =
  'This tool edits the Plugin Forge draft, and this chat is not attached to one. ' +
  'Ask the user to open Plugins → Plugin Forge (/plugin-forge) and continue there.';

/**
 * A request the tool cannot honour as given (bad JSON, missing file, no
 * session). Returned to the model as an error to act on; not logged, because
 * it is not a fault in the app.
 */
class ForgeInputError extends Error {}

export function isSafePluginFileName(name) {
  return typeof name === 'string' && PLUGIN_FILE_NAME.test(name) && !name.includes('..');
}

/** Pretty-printed exactly as the page prints it, so both sides fingerprint the same text. */
export function canonicalJson(text) {
  return JSON.stringify(JSON.parse(text), null, 2);
}

export function getPluginToolSchemas() {
  const fn = (name, description, properties = {}, required = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  return [
    fn(
      'generate_plugin',
      'Generate a brand-new plugin (manifest, tool code, package.json) from a description, replacing the empty Plugin Forge draft. Only for a plugin that does not exist yet; change an existing draft with edit_plugin_file / write_plugin_file.',
      {
        description: { type: 'string', description: 'What the plugin does: its tools, the service or API it wraps, inputs, outputs, auth.' },
        replace: { type: 'boolean', description: 'Discard a non-empty draft. Only when the user asked to start a different plugin.' },
      },
      ['description'],
    ),
    fn(
      'edit_plugin_file',
      'Apply search/replace edits to one file of the Plugin Forge draft. The way to change an existing plugin.',
      {
        file: { type: 'string', description: 'File name as listed in Plugin state, e.g. "manifest.json" or "search.js".' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Exact text currently in the file' },
              replace: { type: 'string', description: 'Replacement text' },
            },
            required: ['search', 'replace'],
          },
          description: 'Applied in order.',
        },
        description: { type: 'string', description: 'One line: what the edit does.' },
      },
      ['file', 'edits'],
    ),
    fn(
      'write_plugin_file',
      'Create a file in the Plugin Forge draft, or replace one whole. Use for a new tool\'s code file; prefer edit_plugin_file for changes.',
      {
        file: { type: 'string', description: 'File name, e.g. "create-page.js". Top level only (or agents/, workflows/, skills/, widgets/, tools/).' },
        content: { type: 'string', description: 'Complete file content.' },
      },
      ['file', 'content'],
    ),
    fn(
      'delete_plugin_file',
      'Delete a file from the Plugin Forge draft (not manifest.json). Remove its tool from manifest.json too.',
      { file: { type: 'string', description: 'File name to delete.' } },
      ['file'],
    ),
    fn('install_plugin', 'Build the Plugin Forge draft and install it, so its tools become callable. Required before test_plugin_tool sees a change.'),
    fn(
      'test_plugin_tool',
      'Run one tool of the installed plugin for real, exactly as an agent would, and return its output. The result also appears in the Forge\'s Test tab.',
      {
        toolType: { type: 'string', description: 'The tool\'s "type" from manifest.json.' },
        args: { type: 'object', description: 'Tool parameters.' },
      },
      ['toolType'],
    ),
    fn(
      'load_plugin',
      'Open an installed plugin\'s source in the Plugin Forge, replacing the current draft.',
      {
        name: { type: 'string', description: 'Installed plugin name (kebab-case).' },
        discardDraft: { type: 'boolean', description: 'Required when the current draft has changes that are not installed, and only after the user agreed to lose them.' },
      },
      ['name'],
    ),
  ];
}

export async function executePluginTool(functionName, args = {}, authToken, context = {}) {
  try {
    const result = await runPluginTool(functionName, args || {}, authToken, context);
    return JSON.stringify(result);
  } catch (error) {
    if (!(error instanceof ForgeInputError)) console.error(`[pluginTools] ${functionName} failed:`, error);
    return JSON.stringify({ success: false, error: error.message });
  }
}

async function runPluginTool(functionName, args, authToken, context) {
  switch (functionName) {
    case 'generate_plugin':
      return generatePlugin(args, context);
    case 'edit_plugin_file':
      return editPluginFile(args, context);
    case 'write_plugin_file':
      return writePluginFile(args, context);
    case 'delete_plugin_file':
      return deletePluginFile(args, context);
    case 'install_plugin':
      return installPlugin(authToken, context);
    case 'test_plugin_tool':
      return testPluginTool(args, authToken, context);
    case 'load_plugin':
      return loadPlugin(args, authToken, context);
    default:
      return { success: false, error: `Unknown plugin tool: ${functionName}` };
  }
}

// ── draft helpers ───────────────────────────────────────────────────────────

/** The draft this turn is editing, or null when the chat is not Plugin Forge. */
function draftOf(context) {
  const state = context?.pluginState;
  if (!state || typeof state !== 'object') return null;
  if (!state.files || typeof state.files !== 'object' || Array.isArray(state.files)) state.files = {};
  return state;
}

function hasFiles(draft) {
  return Object.keys(draft.files).length > 0;
}

/** Any edit to an installed plugin makes it 'changed'; to nothing, a 'draft'. */
function markEdited(draft) {
  draft.installState = draft.installState === 'installed' || draft.installState === 'changed' ? 'changed' : 'draft';
}

function parseManifest(draft) {
  const text = draft.files[MANIFEST];
  if (typeof text !== 'string') throw new ForgeInputError('The draft has no manifest.json.');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ForgeInputError(`manifest.json is not valid JSON: ${error.message}`);
  }
}

/** Validate and normalise a file's new content. Throws with a message the model can act on. */
function prepareContent(file, content) {
  if (typeof content !== 'string') throw new ForgeInputError(`Content for ${file} must be a string.`);
  if (!JSON_FILES.has(file)) return content;
  try {
    return canonicalJson(content);
  } catch (error) {
    throw new ForgeInputError(`${file} would not be valid JSON (${error.message}); nothing was changed.`);
  }
}

const fileUpdated = (file, content) => ({ type: 'plugin-file-updated', data: { file, content } });

function apiBase() {
  return `http://localhost:${process.env.PORT || 3333}/api`;
}

async function callApi(authToken, path, init = {}) {
  if (!authToken) throw new ForgeInputError('No user session on this turn, so the plugin API cannot be called.');
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { Authorization: authToken, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

// ── tools ───────────────────────────────────────────────────────────────────

async function generatePlugin({ description, replace }, context) {
  const draft = draftOf(context);
  if (!draft) return { success: false, error: FORGE_REQUIRED };
  if (typeof description !== 'string' || !description.trim()) return { success: false, error: 'description is required.' };
  if (hasFiles(draft) && replace !== true) {
    return {
      success: false,
      error:
        `A draft already exists (${draft.name || 'unnamed'}). Change it with edit_plugin_file or write_plugin_file. ` +
        'Pass replace: true only if the user asked to start a different plugin.',
    };
  }
  // Same rule as generate_widget: the conversation's resolved model, never a
  // hardcoded fallback that would silently fail for non-OpenAI accounts.
  if (!context.provider || !context.model) {
    return { success: false, error: 'generate_plugin needs the conversation\'s provider and model, and none was resolved.' };
  }

  // Lazy: the generator pulls in the plugin installer, which only this call needs.
  const { default: PluginGenerator } = await import('../PluginGenerator.js');
  const generated = await new PluginGenerator(context.userId).generatePlugin(description, context.provider, context.model);
  const { manifest, toolCode = {}, packageJson } = generated || {};
  if (!manifest || typeof manifest.name !== 'string' || !Array.isArray(manifest.tools)) {
    return { success: false, error: 'The generator returned a manifest without a name or tools list. Try a more specific description.' };
  }

  const files = { [MANIFEST]: JSON.stringify(manifest, null, 2) };
  for (const [file, code] of Object.entries(toolCode)) {
    if (!isSafePluginFileName(file) || JSON_FILES.has(file)) {
      return { success: false, error: `The generator produced an invalid file name "${file}". Nothing was changed; try again.` };
    }
    files[file] = String(code);
  }
  if (packageJson) files[PACKAGE] = JSON.stringify(packageJson, null, 2);

  draft.files = files;
  draft.name = manifest.name;
  draft.installState = 'draft';

  return {
    success: true,
    name: manifest.name,
    tools: manifest.tools.map((tool) => tool.type),
    files: Object.keys(files),
    message: `Generated ${manifest.name} with ${manifest.tools.length} tool(s). It is a draft: install_plugin, then test_plugin_tool, before calling it done.`,
    frontendEvents: [{ type: 'plugin-files-replaced', data: { files, installed: false } }],
  };
}

function editPluginFile({ file, edits, description }, context) {
  const draft = draftOf(context);
  if (!draft) return { success: false, error: FORGE_REQUIRED };
  if (typeof draft.files[file] !== 'string') {
    return { success: false, error: `No file "${file}" in the draft. Files: ${Object.keys(draft.files).join(', ') || '(none)'}.` };
  }
  if (!Array.isArray(edits) || edits.length === 0) return { success: false, error: 'edits must be a non-empty array.' };

  let updated = draft.files[file];
  const applied = [];
  const failed = [];
  edits.forEach((edit, index) => {
    const match = fuzzyFind(updated, edit?.search);
    if (!match || typeof edit.replace !== 'string') {
      failed.push({ index, search: String(edit?.search ?? '').slice(0, 80) });
      return;
    }
    updated = updated.slice(0, match.start) + edit.replace + updated.slice(match.end);
    applied.push(index);
  });

  if (applied.length === 0) {
    return { success: false, error: `None of the search strings were found in ${file}. Copy them exactly from Plugin state.`, failed };
  }
  const content = prepareContent(file, updated);
  draft.files[file] = content;
  markEdited(draft);
  if (file === MANIFEST) draft.name = JSON.parse(content).name || draft.name;

  return {
    success: true,
    file,
    applied: applied.length,
    failed: failed.length ? failed : undefined,
    message: `Applied ${applied.length}/${edits.length} edit(s) to ${file}${description ? `: ${description}` : ''}.`,
    frontendEvents: [fileUpdated(file, content)],
  };
}

function writePluginFile({ file, content }, context) {
  const draft = draftOf(context);
  if (!draft) return { success: false, error: FORGE_REQUIRED };
  if (!isSafePluginFileName(file)) {
    return { success: false, error: `"${file}" is not a valid plugin file name: letters, digits, . _ - only, top level or one asset folder deep.` };
  }
  const prepared = prepareContent(file, content);
  const created = typeof draft.files[file] !== 'string';
  draft.files[file] = prepared;
  markEdited(draft);
  if (file === MANIFEST) draft.name = JSON.parse(prepared).name || draft.name;

  return {
    success: true,
    file,
    created,
    message: `${created ? 'Created' : 'Replaced'} ${file}.`,
    frontendEvents: [fileUpdated(file, prepared)],
  };
}

function deletePluginFile({ file }, context) {
  const draft = draftOf(context);
  if (!draft) return { success: false, error: FORGE_REQUIRED };
  if (file === MANIFEST) return { success: false, error: 'manifest.json cannot be deleted; it defines the plugin.' };
  if (typeof draft.files[file] !== 'string') return { success: false, error: `No file "${file}" in the draft.` };
  delete draft.files[file];
  markEdited(draft);
  return {
    success: true,
    file,
    message: `Deleted ${file}. If a tool's entryPoint named it, remove that tool from manifest.json.`,
    frontendEvents: [{ type: 'plugin-file-deleted', data: { file } }],
  };
}

async function installPlugin(authToken, context) {
  const draft = draftOf(context);
  if (!draft) return { success: false, error: FORGE_REQUIRED };
  if (!hasFiles(draft)) return { success: false, error: 'The draft is empty. Generate or write the plugin first.' };
  if (draft.installState === 'installed') {
    return { success: true, name: draft.name, message: 'Already installed; nothing has changed since.' };
  }

  let manifest = parseManifest(draft);
  if (!PLUGIN_NAME.test(manifest.name || '')) {
    return { success: false, error: `manifest.json "name" must be kebab-case letters, digits, . _ - (got "${manifest.name}").` };
  }
  const missing = (manifest.tools || [])
    .map((tool) => String(tool.entryPoint || '').replace(/^\.\//, ''))
    .filter((entry) => entry && typeof draft.files[entry] !== 'string');
  if (missing.length) return { success: false, error: `manifest.json points at files the draft does not have: ${missing.join(', ')}.` };

  const frontendEvents = [];
  // Never reinstall over the same version number: bump it the way the
  // change deserves (tools removed → major, added/changed → minor, else patch).
  const installed = await callApi(authToken, `/plugins/installed/${encodeURIComponent(manifest.name)}/source`);
  if (installed.ok && installed.body?.files?.[MANIFEST]) {
    try {
      const current = JSON.parse(installed.body.files[MANIFEST]);
      if (current.version === manifest.version) {
        manifest = { ...manifest, version: bumpVersion(current.version, determineVersionBump(current, manifest)) };
        draft.files[MANIFEST] = JSON.stringify(manifest, null, 2);
        frontendEvents.push(fileUpdated(MANIFEST, draft.files[MANIFEST]));
      }
    } catch {
      // An unreadable installed manifest is overwritten by this install anyway.
    }
  }

  let packageJson;
  if (typeof draft.files[PACKAGE] === 'string') {
    try {
      packageJson = JSON.parse(draft.files[PACKAGE]);
    } catch (error) {
      return { success: false, error: `package.json is not valid JSON: ${error.message}` };
    }
  }
  const toolCode = Object.fromEntries(Object.entries(draft.files).filter(([file]) => !JSON_FILES.has(file)));

  const build = await callApi(authToken, '/plugins/build-generated', {
    method: 'POST',
    body: JSON.stringify({ manifest, toolCode, packageJson, installAfterBuild: true }),
  });
  if (!build.ok || build.body?.success === false) {
    return { success: false, error: `Install failed: ${build.body?.error || `HTTP ${build.status}`}`, frontendEvents };
  }
  if (build.body?.installed === false) {
    return { success: false, error: `Built, but the install step failed: ${build.body?.installResult?.error || 'unknown error'}`, frontendEvents };
  }

  draft.installState = 'installed';
  draft.name = manifest.name;
  frontendEvents.push({ type: 'plugin-installed', data: { name: manifest.name, files: { ...draft.files } } });
  return {
    success: true,
    name: manifest.name,
    version: manifest.version,
    tools: (manifest.tools || []).map((tool) => tool.type),
    message: `Installed ${manifest.name} v${manifest.version}. Its tools are live; run test_plugin_tool on each before calling it done.`,
    frontendEvents,
  };
}

async function testPluginTool({ toolType, args = {} }, authToken, context) {
  if (typeof toolType !== 'string' || !toolType) return { success: false, error: 'toolType is required.' };
  const draft = draftOf(context);
  let pluginName = null;
  if (draft && hasFiles(draft)) {
    const manifest = parseManifest(draft);
    pluginName = manifest.name;
    if (!(manifest.tools || []).some((tool) => tool.type === toolType)) {
      return { success: false, error: `"${toolType}" is not a tool of ${manifest.name}. Tools: ${(manifest.tools || []).map((t) => t.type).join(', ')}.` };
    }
    if (draft.installState !== 'installed') {
      return {
        success: false,
        error:
          draft.installState === 'changed'
            ? 'The draft has changes that are not installed, so a test would run the old code. Call install_plugin first.'
            : 'This plugin is not installed yet. Call install_plugin first.',
      };
    }
  }

  const started = Date.now();
  const run = await callApi(authToken, `/tools/${encodeURIComponent(toolType)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ args: args && typeof args === 'object' ? args : {} }),
  });
  const ms = Date.now() - started;
  const passed = run.ok && run.body?.success === true;
  const raw = passed ? run.body.result : run.body?.details || run.body?.error || `HTTP ${run.status}`;
  const output = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  const error = passed ? undefined : run.body?.error || `HTTP ${run.status}`;

  return {
    // The TEST ran; whether the tool passed is `passed`. A failing tool is
    // information for the next edit, not an error of this call.
    success: true,
    passed,
    toolType,
    ms,
    output: output.length > MAX_TEST_OUTPUT_CHARS ? `${output.slice(0, MAX_TEST_OUTPUT_CHARS)}\n…[truncated]` : output,
    error,
    frontendEvents: pluginName
      ? [{ type: 'plugin-test-result', data: { pluginName, toolType, result: { ok: passed, output, error, args, ms, at: Date.now() } } }]
      : undefined,
  };
}

async function loadPlugin({ name, discardDraft }, authToken, context) {
  const draft = draftOf(context);
  if (!draft) return { success: false, error: FORGE_REQUIRED };
  if (typeof name !== 'string' || !PLUGIN_NAME.test(name)) return { success: false, error: 'name must be an installed plugin\'s name.' };
  const unsaved = hasFiles(draft) && draft.installState !== 'installed';
  if (unsaved && discardDraft !== true) {
    return {
      success: false,
      error: `The current draft (${draft.name || 'unnamed'}) has changes that are not installed. Ask the user before discarding them, then call again with discardDraft: true.`,
    };
  }

  const source = await callApi(authToken, `/plugins/installed/${encodeURIComponent(name)}/source`);
  if (!source.ok || !source.body?.success) {
    return { success: false, error: source.status === 404 ? `No installed plugin named "${name}".` : `Could not load ${name}: ${source.body?.error || `HTTP ${source.status}`}` };
  }

  const files = {};
  for (const [file, content] of Object.entries(source.body.files || {})) {
    if (!isSafePluginFileName(file)) continue;
    files[file] = JSON_FILES.has(file) ? safeCanonicalJson(content) : String(content);
  }
  if (typeof files[MANIFEST] !== 'string') return { success: false, error: `${name} has no manifest.json.` };

  draft.files = files;
  draft.name = name;
  draft.installState = 'installed';
  return {
    success: true,
    name,
    files: Object.keys(files),
    message: `Opened ${name} in the Forge.`,
    frontendEvents: [{ type: 'plugin-files-replaced', data: { files, installed: true } }],
  };
}

/** Installed JSON is shown as written if it does not parse, rather than refusing to open the plugin. */
function safeCanonicalJson(text) {
  try {
    return canonicalJson(text);
  } catch {
    return String(text);
  }
}
