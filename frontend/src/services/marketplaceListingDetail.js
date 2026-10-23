/**
 * What a Market listing (agent, workflow, tool, skill) contains and does, read
 * from the definition the publisher shipped (the listing's `metadata`), laid
 * out like a plugin's detail: what's inside, the access it uses, the package.
 *
 * Plugins have their own detail (PluginDetail via AppsSection); everything
 * else showed only a title and a description (reported 2026-10-21).
 *
 * Only facts in the listing are shown. Access is derived from what the asset
 * actually uses (an agent's tools, a workflow's steps, a tool's code, a
 * skill's allowed tools), never guessed beyond that.
 */
import { workflowStepOrder, humanKey } from '@/views/Focused/focusedEditors.js';

const parse = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const list = (value) => (Array.isArray(value) ? value.filter((entry) => entry != null && entry !== '') : []);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const nameOf = (entry) => (typeof entry === 'string' ? entry : text(entry?.name) || text(entry?.title) || text(entry?.id));

/** "web_search" / "web-search" / "WebSearch" -> "Web search". */
export function readableName(id) {
  const words = String(id || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

// ── Access, from what the asset uses ─────────────────────────────────────────
// Each rule: a label people understand, and the WORDS of a tool / step name
// (or exact code calls) that mean it. Whole words only: "file" must not match
// "profile", nor "api" "rapid". Ordered as they are shown.
const ACCESS_RULES = [
  { id: 'programs', label: 'Runs programs and commands on this computer', icon: 'terminal', words: ['shell', 'command', 'bash', 'terminal', 'powershell', 'child_process', 'spawn', 'execsync'] },
  { id: 'code', label: 'Runs code it writes or carries', icon: 'code', words: ['javascript', 'python', 'code', 'interpreter'] },
  // names: whole tool names only (a skill's "Read" / "Write" tools); as words
  // they would flag edit_image or write_blog_post.
  { id: 'files', label: 'Reads and writes files on this computer', icon: 'file', words: ['file', 'files', 'fs', 'readfile', 'writefile', 'glob', 'grep', 'directory', 'folder'], names: ['read', 'write', 'edit', 'multiedit'] },
  { id: 'internet', label: 'Connects to the internet', icon: 'globe', words: ['web', 'addresses', 'scrape', 'fetch', 'http', 'https', 'url', 'browser', 'request', 'api', 'axios', 'download'], names: ['webfetch', 'websearch'] },
  { id: 'email', label: 'Sends email', icon: 'arrow', words: ['email', 'mail', 'gmail', 'smtp'] },
  { id: 'messages', label: 'Posts messages to other services', icon: 'arrow', words: ['slack', 'discord', 'telegram', 'twitter', 'tweet', 'sms', 'whatsapp'] },
  { id: 'schedule', label: 'Runs on its own (a schedule or an incoming event)', icon: 'trigger', words: ['trigger', 'timer', 'schedule', 'webhook', 'cron', 'listener'] },
  { id: 'agents', label: 'Starts other agents or workflows', icon: 'agent', words: ['agent', 'agents', 'workflow', 'workflows', 'delegate', 'orchestrator'] },
];

/** The lower-case words of a name: "execute_shell_command" -> execute, shell, command. */
const wordsOf = (name) => String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The access a set of things it uses implies, each with what implies it. */
export function accessFrom(names) {
  const used = list(names).map(String);
  return ACCESS_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    icon: rule.icon,
    because: [...new Set(used.filter((name) => wordsOf(name).some((word) => rule.words.includes(word)) || (rule.names || []).includes(name.toLowerCase())).map(readableName))],
  })).filter((entry) => entry.because.length);
}

// A setting worth showing: short, and never something that looks like a secret.
const SECRET_KEY = /key|token|secret|password|passwd|auth|credential|cookie|bearer/i;
function settingPreview(key, value) {
  if (SECRET_KEY.test(key)) return null;
  if (value === undefined || value === null || value === '' || typeof value === 'object') return null;
  const shown = String(value).replace(/\s+/g, ' ').trim();
  if (!shown) return null;
  return { key: humanKey(key), value: shown.length > 140 ? shown.slice(0, 137) + '…' : shown };
}

// ── Per type ─────────────────────────────────────────────────────────────────

function agentDetail(meta) {
  const tools = list(meta.assignedTools).map(nameOf).filter(Boolean);
  const skills = list(meta.assignedSkills).map(nameOf).filter(Boolean);
  const workflows = list(meta.assignedWorkflows).map(nameOf).filter(Boolean);
  const groups = [
    { key: 'tools', label: 'Tools it can use', icon: 'tool', items: tools.map((id) => ({ id, name: readableName(id), detail: id })) },
    { key: 'skills', label: 'Skills', icon: 'book', items: skills.map((id) => ({ id, name: readableName(id) })) },
    { key: 'workflows', label: 'Workflows it can run', icon: 'flow', items: workflows.map((id) => ({ id, name: readableName(id) })) },
  ].filter((group) => group.items.length);
  const facts = [];
  if (text(meta.provider) || text(meta.model)) facts.push({ key: 'Model', value: [text(meta.provider), text(meta.model)].filter(Boolean).join(' · ') });
  else facts.push({ key: 'Model', value: 'Your selected AI' });
  if (Number(meta.creditLimit) > 0) facts.push({ key: 'Credit limit', value: String(meta.creditLimit) });
  return {
    groups,
    instructions: text(meta.systemPrompt) || text(meta.instructions) || text(meta.prompt),
    instructionsLabel: 'Instructions',
    facts,
    access: accessFrom([...tools, ...workflows.map(() => 'workflow')]),
  };
}

function workflowDetail(meta) {
  const graph = { nodes: list(meta.nodes), edges: list(meta.edges) };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  // `label` nodes are notes on the canvas, not steps.
  const order = workflowStepOrder(graph).filter((id) => byId.get(id)?.type !== 'label');
  const steps = order.map((id, index) => {
    const node = byId.get(id) || {};
    const settings = Object.entries(node.parameters || {}).map(([key, value]) => settingPreview(key, value && typeof value === 'object' && 'value' in value ? value.value : value)).filter(Boolean);
    return {
      id,
      name: text(node.text) || readableName(node.type),
      number: index + 1,
      detail: [node.category === 'trigger' ? 'Starts the workflow' : '', readableName(node.type)].filter(Boolean).join(' · '),
      settings: settings.slice(0, 6),
    };
  });
  const triggers = graph.nodes.filter((node) => node.category === 'trigger');
  return {
    groups: steps.length ? [{ key: 'steps', label: 'Steps, in the order they run', icon: 'flow', numbered: true, items: steps }] : [],
    instructions: '',
    facts: [{ key: 'Starts', value: triggers.length ? triggers.map((node) => text(node.text) || readableName(node.type)).join(', ') : 'When you run it' }],
    access: accessFrom(graph.nodes.filter((node) => node.type !== 'label').map((node) => String(node.type || ''))),
  };
}

function toolDetail(meta) {
  const isCode = /CODE|JS|PY/i.test(String(meta.base || '')) || !!text(meta.code);
  const language = /PY/i.test(String(meta.base || meta.language || '')) ? 'Python' : 'JavaScript';
  const inputs = Object.entries(parse(meta.parameters) || {})
    .filter(([key]) => !['instructions', 'provider', 'model'].includes(key))
    .map(([key, def]) => ({ id: key, name: text(def?.label) || readableName(key), detail: [text(def?.description), def?.required ? 'Required' : '', Array.isArray(def?.options) ? `One of: ${def.options.join(', ')}` : ''].filter(Boolean).join(' · ') }));
  const outputs = Object.entries(parse(meta.outputs) || {}).map(([key, def]) => ({ id: key, name: key, detail: [text(def?.type), text(def?.description)].filter(Boolean).join(' · ') }));
  const prompt = text(parse(meta.parameters)?.instructions);
  const code = text(meta.code);
  return {
    groups: [
      { key: 'inputs', label: 'Inputs', icon: 'tool', items: inputs },
      { key: 'outputs', label: 'Outputs', icon: 'flow', items: outputs },
    ].filter((group) => group.items.length),
    instructions: isCode ? '' : prompt,
    instructionsLabel: 'Prompt',
    code: isCode ? code : '',
    codeLabel: isCode ? `${language} code` : '',
    facts: [{ key: 'Kind', value: isCode ? `${language} code` : 'A prompt your AI fills in' }],
    // Code is read for what it uses: what it calls, not what it mentions in comments.
    access: accessFrom([
      isCode ? `execute-${language.toLowerCase()}` : '',
      ...(code.match(/\bfetch\(|\baxios\b|\bhttps?:\/\/|\bchild_process\b|\bspawn\(|\bexecSync\(|\breadFile(?:Sync)?\(|\bwriteFile(?:Sync)?\(/g) || []).map((call) => (/^https?:/.test(call) ? 'web-addresses' : call.replace(/[(:/]+$/, '') + '()')),
    ].filter(Boolean)),
  };
}

function skillDetail(meta) {
  const allowed = list(meta.allowedTools).map(nameOf).filter(Boolean);
  return {
    groups: allowed.length ? [{ key: 'tools', label: 'Tools it may use', icon: 'tool', items: allowed.map((id) => ({ id, name: readableName(id) })) }] : [],
    instructions: text(meta.instructions),
    instructionsLabel: 'Instructions it gives the AI',
    facts: [text(meta.license) ? { key: 'License', value: text(meta.license) } : null, text(meta.metadata?.author) ? { key: 'Author', value: text(meta.metadata.author) } : null, text(meta.metadata?.source) ? { key: 'Source', value: text(meta.metadata.source) } : null].filter(Boolean),
    access: accessFrom(allowed),
  };
}

const BY_TYPE = { agent: agentDetail, workflow: workflowDetail, tool: toolDetail, skill: skillDetail };

/**
 * @param {object} listing  a marketplace item ({ asset_type, metadata, ... })
 * @returns {null | { groups, instructions, instructionsLabel, code, codeLabel, facts, access, itemCount, known }}
 *   null for a type this does not describe (plugins have their own page).
 */
export function listingDetail(listing = {}) {
  const build = BY_TYPE[listing?.asset_type];
  if (!build) return null;
  const meta = parse(listing.metadata);
  if (!meta || typeof meta !== 'object') return { groups: [], instructions: '', facts: [], access: [], itemCount: 0, known: false };
  const detail = build(meta);
  return { code: '', codeLabel: '', instructionsLabel: 'Instructions', ...detail, itemCount: detail.groups.reduce((sum, group) => sum + group.items.length, 0), known: true };
}
