/**
 * THE AVATAR LADDER.
 *
 * The regression that motivated this file: the chat roster resolved
 * `URL -> else FontAwesome`, so an emoji icon became `<i class="🔬">` — a
 * class attribute made of an emoji, matching no rule, rendering nothing. On
 * this install 63 of 90 agents use an emoji icon, so the MAJORITY of agents
 * drew as blank circles. Emoji must resolve above FontAwesome, because the FA
 * branch is the one that silently swallows anything it cannot render.
 */
import { describe, it, expect } from 'vitest';
import { resolveAvatar, buildRoster, attachIcons, initialOf, hueOf, ANNIE_ID, ANNIE_NAME } from './agentAvatar.js';

describe('resolveAvatar — the four rungs', () => {
  it('resolves an inline data-URL to an image', () => {
    const icon = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveAvatar({ name: 'Sol', icon })).toEqual({ kind: 'image', src: icon });
  });

  it('resolves http(s), blob and app-relative paths to images', () => {
    for (const icon of ['https://x.test/a.png', 'http://x.test/a.png', 'blob:abc', '/assets/a.png', './a.png']) {
      expect(resolveAvatar({ name: 'A', icon }).kind).toBe('image');
    }
  });

  it('REGRESSION: an emoji icon resolves to emoji, never to a FontAwesome class', () => {
    for (const glyph of ['🔬', '🛰', '📄', '⚔️', '✍️', '🎯']) {
      const resolved = resolveAvatar({ name: 'Agent', icon: glyph });
      expect(resolved).toEqual({ kind: 'emoji', glyph });
    }
  });

  it('resolves FontAwesome in every form the app writes it', () => {
    for (const icon of ['fas fa-robot', 'fa-solid fa-robot', 'far fa-user', 'fa-robot']) {
      expect(resolveAvatar({ name: 'A', icon })).toEqual({ kind: 'fontawesome', className: icon });
    }
  });

  it('does NOT mistake an ordinary word for a FontAwesome class', () => {
    // 'fabulous' contains 'fa' but is not an icon; without the fa- anchor it
    // would render as an empty <i>.
    expect(resolveAvatar({ id: 'a1', name: 'Fabulous', icon: 'fabulous' }).kind).toBe('initial');
  });

  it('falls back to an initial rather than printing a stray label in a circle', () => {
    const resolved = resolveAvatar({ id: 'a1', name: 'Scout', icon: 'robot' });
    expect(resolved.kind).toBe('initial');
    expect(resolved.letter).toBe('S');
  });

  it('falls back to an initial when there is no icon at all', () => {
    expect(resolveAvatar({ id: 'a1', name: 'Reviewer' })).toMatchObject({ kind: 'initial', letter: 'R' });
  });

  it('is total — every input produces something drawable', () => {
    for (const agent of [{}, { icon: '' }, { icon: '   ' }, { name: '' }, { icon: null, name: null }]) {
      expect(['image', 'fontawesome', 'emoji', 'initial']).toContain(resolveAvatar(agent).kind);
    }
  });
});

describe('initialOf', () => {
  it('skips separators to the first real character', () => {
    expect(initialOf('Swarm · Palette Engineer')).toBe('S');
    expect(initialOf('  scout')).toBe('S');
    expect(initialOf('· · ·')).toBe('?');
    expect(initialOf('')).toBe('?');
  });

  it('handles non-Latin names', () => {
    expect(initialOf('日本語エージェント')).toBe('日');
  });
});

describe('hueOf', () => {
  it('is deterministic, so an agent keeps its colour across reloads', () => {
    expect(hueOf('agent-1')).toBe(hueOf('agent-1'));
  });

  it('is in range for anything, including empty input', () => {
    for (const seed of ['', 'a', 'agent-1', '🔬', 'x'.repeat(500)]) {
      const hue = hueOf(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it('separates typical ids rather than collapsing them onto one colour', () => {
    const hues = new Set(Array.from({ length: 20 }, (_, i) => hueOf(`agent-${i}`)));
    expect(hues.size).toBeGreaterThan(15);
  });
});

describe('attachIcons', () => {
  // THE REGRESSION: a stored roster is [{id, name}] with NO icon (icons are
  // data-URLs up to ~233KB, far too big to put in a sidebar row). Without
  // this resolution step every agent fell to the initial rung and the
  // sidebar showed letters next to Annie's photograph.
  const index = {
    byId: new Map([['a1', 'data:image/png;base64,SOL']]),
    byName: new Map([['Sol', 'data:image/png;base64,SOL'], ['Fable', 'data:image/png;base64,FABLE']]),
  };

  it('resolves a stored participant to a real image', () => {
    const [participant] = attachIcons([{ id: 'a1', name: 'Sol' }], index);
    expect(participant.icon).toBe('data:image/png;base64,SOL');
    expect(resolveAvatar(participant).kind).toBe('image');
  });

  it('prefers the id over the name', () => {
    // Names are not unique on a real install; the id is the exact handle.
    const collide = {
      byId: new Map([['a2', 'BY-ID']]),
      byName: new Map([['Social Media Manager', 'BY-NAME']]),
    };
    expect(attachIcons([{ id: 'a2', name: 'Social Media Manager' }], collide)[0].icon).toBe('BY-ID');
  });

  it('falls back to the name for a legacy participant with no id', () => {
    expect(attachIcons([{ id: null, name: 'Fable' }], index)[0].icon).toBe('data:image/png;base64,FABLE');
  });

  it('never overwrites an icon the participant already carries', () => {
    // The chat roster derives its list from messages, which record what the
    // agent looked like when it spoke. That answer wins.
    const [participant] = attachIcons([{ id: 'a1', name: 'Sol', icon: 'FROM-MESSAGE' }], index);
    expect(participant.icon).toBe('FROM-MESSAGE');
  });

  it('leaves a deleted agent iconless so it draws its initial', () => {
    const [participant] = attachIcons([{ id: 'gone', name: 'Ghost' }], index);
    expect(participant.icon).toBeFalsy();
    expect(resolveAvatar(participant)).toMatchObject({ kind: 'initial', letter: 'G' });
  });

  it('does not mutate the participants it is given', () => {
    const stored = [{ id: 'a1', name: 'Sol' }];
    attachIcons(stored, index);
    expect(stored[0].icon).toBeUndefined();
  });

  it('degrades to the initial rung when the index is missing or malformed', () => {
    for (const bad of [null, undefined, {}, { byId: 'nope' }, { byId: {}, byName: {} }]) {
      const [participant] = attachIcons([{ id: 'a1', name: 'Sol' }], bad);
      expect(participant.icon).toBeFalsy();
    }
  });

  it('survives junk in the roster', () => {
    expect(attachIcons([null, undefined, { id: 'a1', name: 'Sol' }], index)).toHaveLength(1);
    expect(attachIcons(null, index)).toEqual([]);
  });
});

describe('buildRoster', () => {
  const agents = (n) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}` }));

  it('always puts Annie first, even in a conversation with no agents', () => {
    const { shown, overflow, total } = buildRoster([]);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: ANNIE_ID, name: ANNIE_NAME, isAnnie: true });
    expect(overflow).toBe(0);
    expect(total).toBe(1);
  });

  it('counts Annie against max, so a row is a predictable width', () => {
    const { shown } = buildRoster(agents(10), { max: 3 });
    expect(shown).toHaveLength(3);
    expect(shown[0].isAnnie).toBe(true);
  });

  it('reports the rest as overflow instead of drawing them', () => {
    expect(buildRoster(agents(10), { max: 3 }).overflow).toBe(8);
  });

  it('draws everyone when they fit, with no overflow chip', () => {
    const { shown, overflow } = buildRoster(agents(2), { max: 3 });
    expect(shown).toHaveLength(3);
    expect(overflow).toBe(0);
  });

  it('keeps a truthful total no matter how many are hidden', () => {
    expect(buildRoster(agents(11), { max: 3 }).total).toBe(12);
  });

  it('survives junk in the roster', () => {
    const { shown } = buildRoster([null, undefined, { id: 'a1', name: 'Sol' }], { max: 3 });
    expect(shown.map((s) => s.name)).toEqual([ANNIE_NAME, 'Sol']);
  });

  it('degrades to Annie alone for a missing roster', () => {
    expect(buildRoster(undefined).shown).toHaveLength(1);
    expect(buildRoster(null).shown[0].isAnnie).toBe(true);
  });
});
