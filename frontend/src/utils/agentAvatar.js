/**
 * HOW TO DRAW AN AGENT — the one resolver, shared by every surface that shows
 * a face: the chat roster, the saved-chat sidebar, anywhere else that follows.
 *
 * An agent's `icon` is a free-form string with no schema behind it. On this
 * install it is one of exactly two things — an inline data-URL (27 agents) or
 * an emoji (63 agents) — but a URL, a FontAwesome class or nothing at all are
 * all reachable through the agent editor, so the resolver handles four rungs
 * and never assumes.
 *
 * THE BUG THIS FIXES. The roster in Chat.vue resolved `URL -> else
 * FontAwesome`, which puts an emoji icon into `<i class="🔬">` — a class
 * attribute made of an emoji, which matches no CSS rule and draws nothing.
 * That silently blanked the MAJORITY of agents on this install. Emoji needs
 * its own rung, ABOVE FontAwesome, because the FA branch is the one that
 * swallows everything it cannot render.
 */

// Anything that names a picture we can put in an <img>.
const IMAGE_PREFIX = /^(https?:\/\/|data:image\/|blob:|\/|\.\/)/i;

// FontAwesome, in every form the app writes it: 'fas fa-robot', 'fa-solid
// fa-robot', or a bare 'fa-robot'. Anchored on the fa- token so a word like
// 'fabulous' cannot be mistaken for an icon class.
const FONTAWESOME = /(^|\s)fa-[a-z0-9-]+/i;

/**
 * Emoji, pictographs, and the dingbats/symbols the picker also offers.
 *
 * Deliberately NOT "any non-empty string". A stray label like 'robot' is not
 * an icon, and rendering it as a text node would put the word "robot" in a
 * 16px circle. Anything that fails every rung falls through to the initial,
 * which always looks intentional.
 */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|[\u2190-\u21FF\u2600-\u27BF\u2B00-\u2BFF]/u;

/**
 * @typedef {{ kind: 'image', src: string }
 *         | { kind: 'fontawesome', className: string }
 *         | { kind: 'emoji', glyph: string }
 *         | { kind: 'initial', letter: string, hue: number }} ResolvedAvatar
 */

/**
 * A stable hue for an agent with no icon, so the same agent is the same colour
 * on every surface and across reloads. FNV-1a over the most durable
 * identifier available — id first, because a rename must not recolour an
 * agent the user already recognises by colour.
 *
 * THE FINALIZER IS NOT OPTIONAL. FNV-1a alone moves mostly LOW bits when its
 * input changes in the last character, and real agent ids are near-identical
 * strings that differ exactly there — sequential ids, shared prefixes. Taking
 * `% 360` straight off that hash collapsed twenty ids onto eleven colours
 * (measured), which is visible as a wall of avatars in the same few hues. The
 * xorshift-multiply finalizer below avalanches those low bits across the whole
 * word first, so a one-character difference lands anywhere in the range.
 *
 * @param {string} seed
 * @returns {number} 0-359
 */
export function hueOf(seed) {
  let hash = 0x811c9dc5;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x21f0aaad);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0xd35a2d97);
  hash ^= hash >>> 15;

  // >>> 0 rather than Math.abs: the hash is a signed int32 here, and abs()
  // maps two distinct hashes onto one value at every negative/positive pair.
  return (hash >>> 0) % 360;
}

/**
 * The letter for the initial rung. Takes the first character of the first
 * word that starts with a letter or digit, so 'Swarm · Palette Engineer'
 * gives 'S' rather than a separator, and '  scout' gives 'S'.
 *
 * @param {string} name
 * @returns {string}
 */
export function initialOf(name) {
  const text = String(name || '').trim();
  if (!text) return '?';
  const match = text.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : '?';
}

/**
 * Resolve one agent to something renderable. Total: every input produces a
 * drawable result, so no caller ever has to handle "nothing to show".
 *
 * @param {{ id?: string|null, name?: string|null, icon?: string|null }} agent
 * @returns {ResolvedAvatar}
 */
export function resolveAvatar(agent = {}) {
  const icon = typeof agent.icon === 'string' ? agent.icon.trim() : '';
  const name = agent.name || '';

  if (icon) {
    if (IMAGE_PREFIX.test(icon)) return { kind: 'image', src: icon };
    // Emoji BEFORE FontAwesome: the FA branch is a catch-all that renders an
    // empty <i> for anything it does not understand, so it must go last
    // among the icon rungs.
    if (PICTOGRAPHIC.test(icon)) return { kind: 'emoji', glyph: icon };
    if (FONTAWESOME.test(icon)) return { kind: 'fontawesome', className: icon };
  }

  return { kind: 'initial', letter: initialOf(name), hue: hueOf(agent.id || name) };
}

/**
 * ANNIE. The orchestrator is in every conversation by definition and is never
 * stored in a roster, so every surface needs the same literal for her. Her
 * avatar is a real asset, not a letter.
 */
export const ANNIE_ID = '__annie__';
export const ANNIE_NAME = 'Annie';

/**
 * Build the render list for a conversation: Annie first, then the agents in
 * join order, with anything past `max` reported as an overflow count rather
 * than drawn.
 *
 * Annie leads because she is the constant — the eye should land on the same
 * face in every row and read the DIFFERENCE, which is who else is there.
 *
 * @param {Array<{id?: string|null, name?: string|null, icon?: string|null}>} participants
 * @param {{ max?: number, annieIcon?: string|null }} [options]
 * @returns {{ shown: Array<object>, overflow: number, total: number }}
 */
export function buildRoster(participants = [], { max = 3, annieIcon = null } = {}) {
  const agents = Array.isArray(participants) ? participants.filter(Boolean) : [];
  const annie = { id: ANNIE_ID, name: ANNIE_NAME, icon: annieIcon, isAnnie: true };

  // `max` counts every face drawn, Annie included, so a row's width is
  // predictable no matter who is in it.
  const roomForAgents = Math.max(0, max - 1);
  const shown = [annie, ...agents.slice(0, roomForAgents)];
  const overflow = Math.max(0, agents.length - roomForAgents);

  return { shown, overflow, total: agents.length + 1 };
}
