// entityRefs — turn the names Annie mentions into clickable references.
//
// Input: rendered message HTML and a registry of known entities
//   [{ kind: 'agent'|'workflow'|'goal'|'trace'|'memory'|'chat', id, name, screen }]
// Output: the same HTML with each first-class mention wrapped:
//   <span class="entity-ref" data-kind="agent" data-id="…" data-screen="AgentsScreen">Release Marshal</span>
//
// Rules that keep it honest:
//   · only TEXT nodes are touched; never inside <code>, <pre>, <a>, <script>,
//     <style>, or an existing .entity-ref
//   · whole-word matches only, case-sensitive (an agent called "Data" must
//     not light up the word "data")
//   · longest names first so "Stripe Webhook Handler" wins over "Stripe"
//   · each entity is wrapped at most `maxPerEntity` times per message so a
//     long reply is not a wall of chips
//
// Pure string work, no DOM, so it runs in the renderer and in tests alike.

const SKIP_TAGS = new Set(['code', 'pre', 'a', 'script', 'style', 'textarea', 'kbd']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Build the matcher list once per registry; names ≥ 3 chars, longest first. */
export function compileEntityMatchers(entities) {
  const list = (entities || [])
    .filter((e) => e && e.name && String(e.name).trim().length >= 3 && e.kind && e.id != null)
    .map((e) => ({ ...e, name: String(e.name).trim() }))
    .sort((a, b) => b.name.length - a.name.length);
  return list.map((e) => ({
    entity: e,
    // \b does not understand unicode word chars; use lookarounds on non-word.
    re: new RegExp(`(^|[^\\w.-])(${escapeRe(e.name)})(?=$|[^\\w-])`, 'g'),
  }));
}

const refSpan = (entity, name) =>
  `<span class="entity-ref" data-kind="${escapeAttr(entity.kind)}" data-id="${escapeAttr(entity.id)}"${entity.screen ? ` data-screen="${escapeAttr(entity.screen)}"` : ''}>${name}</span>`;

/**
 * Wrap mentions in one text node. Matchers run longest-name first, and a
 * segment a matcher has wrapped is sealed — a later, shorter name can never
 * re-match inside it ("Stripe" inside "Stripe Webhook Handler").
 */
function wrapTextNode(text, matchers, budget) {
  let segments = [{ text, sealed: false }];
  for (const { entity, re } of matchers) {
    if ((budget.get(entity) || 0) >= budget.max) continue;
    const next = [];
    for (const seg of segments) {
      if (seg.sealed) {
        next.push(seg);
        continue;
      }
      let last = 0;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(seg.text)) !== null) {
        const used = budget.get(entity) || 0;
        if (used >= budget.max) break;
        const [whole, pre, name] = m;
        const start = m.index + pre.length;
        if (start > last) next.push({ text: seg.text.slice(last, start), sealed: false });
        next.push({ text: refSpan(entity, name), sealed: true });
        budget.set(entity, used + 1);
        last = start + name.length;
        // zero-width guard for the lookahead form
        if (whole.length === 0) re.lastIndex++;
      }
      if (last < seg.text.length) next.push({ text: seg.text.slice(last), sealed: false });
    }
    segments = next;
  }
  return segments.map((s) => s.text).join('');
}

/**
 * @param {string} html
 * @param {Array} entities
 * @param {{maxPerEntity?: number}} [opts]
 * @returns {string}
 */
export function annotateEntityRefs(html, entities, opts = {}) {
  if (!html || !entities || !entities.length) return html || '';
  const matchers = compileEntityMatchers(entities);
  if (!matchers.length) return html;
  const budget = new Map();
  budget.max = opts.maxPerEntity ?? 3;

  // Tokenise into tags and text. Track a skip depth for tags whose text we
  // must not touch. `.entity-ref` spans already present are skipped too.
  const tokens = html.split(/(<[^>]+>)/g);
  let skipDepth = 0;
  const skipStack = [];
  const out = [];
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok[0] === '<') {
      const m = tok.match(/^<\/?\s*([a-zA-Z][\w-]*)/);
      const tag = m ? m[1].toLowerCase() : '';
      const closing = tok[1] === '/';
      const selfClosing = /\/\s*>$/.test(tok) || tag === 'br' || tag === 'img' || tag === 'hr';
      const isRef = !closing && tag === 'span' && /class="[^"]*\bentity-ref\b/.test(tok);
      if (!closing && !selfClosing && (SKIP_TAGS.has(tag) || isRef)) {
        skipStack.push(tag);
        skipDepth++;
      } else if (closing && skipStack.length && skipStack[skipStack.length - 1] === tag) {
        skipStack.pop();
        skipDepth--;
      }
      out.push(tok);
      continue;
    }
    out.push(skipDepth > 0 ? tok : wrapTextNode(tok, matchers, budget));
  }
  return out.join('');
}

/**
 * The owning screen for an entity kind — where ⇧-click goes, and where the
 * inspector request is routed when the current screen cannot show it.
 */
export const ENTITY_SCREENS = Object.freeze({
  agent: 'AgentsScreen',
  workflow: 'WorkflowsScreen',
  goal: 'GoalsScreen',
  trace: 'TracesScreen',
  execution: 'TracesScreen',
  memory: 'MemoryScreen',
  chat: 'ChatScreen',
  tool: 'ToolsScreen',
  skill: 'SkillsScreen',
  plugin: 'PluginsScreen',
  widget: 'WidgetManagerScreen',
  connector: 'ConnectorsScreen',
  artifact: 'ArtifactsScreen',
});

/**
 * Build the registry from store state. Kept here so Chat and the widgets
 * that render messages feed the annotator the same way.
 */
export function entityRegistryFromStore(store) {
  const out = [];
  for (const a of store.getters['agents/allAgents'] || []) out.push({ kind: 'agent', id: a.id, name: a.name, screen: ENTITY_SCREENS.agent });
  for (const w of store.getters['workflows/allWorkflows'] || []) out.push({ kind: 'workflow', id: w.id, name: w.name, screen: ENTITY_SCREENS.workflow });
  for (const g of store.getters['goals/allGoals'] || []) out.push({ kind: 'goal', id: g.id, name: g.title || g.text, screen: ENTITY_SCREENS.goal });
  return out;
}
