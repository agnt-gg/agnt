/**
 * Provider list ordering.
 *
 * TWO BUGS, ONE CAUSE
 * -------------------
 * BUILT_IN_PROVIDERS was hand-alphabetized, so display order depended entirely
 * on where an author happened to append their entry. PR #50 appended Cursor
 * next to Grok-Build, which put "Cursor" between the G's in the UI. That was
 * fixed by sorting at the boundary — but the sort key was `displayName`, an
 * IDENTIFIER, while the UI renders a LABEL. The two matched, so it looked
 * correct.
 *
 * The moment `openai-codex` was labelled "ChatGPT", they stopped matching and
 * the entry sorted under O, between the OpenAI providers, where nobody
 * scanning for a C would look. Alphabetical means alphabetical by what is on
 * screen, so the list now sorts by `providerLabel`.
 *
 * These assert against the REAL module exports — not a copy of the literal.
 */
import { describe, it, expect } from 'vitest';
import aiProviderStore, {
  AI_PROVIDERS_WITH_API,
  PROVIDER_DISPLAY_NAMES,
  providerLabel,
  byProviderLabel,
  connectableAiProviders,
} from './aiProvider.js';

/** What state.providers holds: the identifiers. */
const displayed = () => aiProviderStore.state.providers;
/** What the user actually reads, in the order they read it. */
const labels = () => displayed().map((p) => providerLabel(p));

describe('provider display order', () => {
  it('is alphabetical BY LABEL, case- and punctuation-insensitive', () => {
    const list = labels();
    expect(list.length).toBeGreaterThan(5);
    const sorted = [...list].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(list).toEqual(sorted);
  });

  it('places ChatGPT in the C group, not down among the OpenAIs', () => {
    // The reported bug: "it's showing in the O's instead of the C's".
    const list = labels();
    const at = (label) => list.indexOf(label);
    expect(at('ChatGPT')).toBeGreaterThan(-1);
    expect(at('ChatGPT')).toBeGreaterThan(at('Cerebras'));
    expect(at('ChatGPT')).toBeLessThan(at('Claude-Code'));
    expect(at('ChatGPT')).toBeLessThan(at('OpenAI'));
  });

  it('places Cursor in the C group, not next to the Groks (PR #50 regression)', () => {
    const list = labels();
    const at = (label) => list.indexOf(label);
    expect(at('Cursor')).toBeGreaterThan(-1);
    expect(at('Cursor')).toBeGreaterThan(at('Claude-Code'));
    expect(at('Cursor')).toBeLessThan(at('DeepSeek'));
    expect(at('Cursor')).toBeLessThan(at('Grok-Build'));
  });

  it('keeps the API-key key list in the same order as the display list', () => {
    // Both derive from BUILT_IN_PROVIDERS; a future refactor that sorts only
    // one of them would desynchronize the settings UI from the fetch actions.
    const withoutLocal = displayed().filter((n) => n !== 'Local');
    expect(AI_PROVIDERS_WITH_API.length).toBe(withoutLocal.length);
  });

  it('orders the API-key list by label too, not by its own key', () => {
    // AI_PROVIDERS_WITH_API is a list of KEYS. It must still be ordered by the
    // label, or the settings screen disagrees with every other provider list.
    const list = AI_PROVIDERS_WITH_API.map((k) => providerLabel(k));
    const sorted = [...list].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(list).toEqual(sorted);
  });

  it('has no duplicate display names', () => {
    const list = displayed();
    expect(new Set(list).size).toBe(list.length);
  });

  it('has no duplicate LABELS either', () => {
    // Two providers rendering the same text is indistinguishable to a user, and
    // an override is the easy way to cause it.
    const list = labels();
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('providerLabel resolves every shape a call site might hold', () => {
  /**
   * Provider objects arrive in two shapes — `{ key, displayName }` from this
   * module and `{ id, name }` from the auth API — and plain strings arrive as
   * both keys and display names. All four must resolve to one label, or the
   * same provider gets two different names on two different screens.
   */
  it.each([
    ['a key', 'openai-codex'],
    ['a display name', 'OpenAI-Codex'],
  ])('resolves %s', (_label, input) => {
    expect(providerLabel(input)).toBe('ChatGPT');
  });

  it.each([
    ['a built-in entry', { key: 'openai-codex', displayName: 'OpenAI-Codex' }],
    ['an auth-API entry', { id: 'openai-codex', name: 'OpenAI Codex' }],
  ])('resolves %s', (_label, input) => {
    expect(providerLabel(input)).toBe('ChatGPT');
  });

  it('falls back to the identifier for a provider with no override', () => {
    expect(providerLabel('Anthropic')).toBe('Anthropic');
    expect(providerLabel({ id: 'my-custom', name: 'My Custom LLM' })).toBe('My Custom LLM');
  });

  it('never returns undefined for junk input', () => {
    // This feeds localeCompare inside the comparator; undefined would throw and
    // take out the whole provider grid.
    for (const junk of [null, undefined, '', {}]) {
      expect(typeof providerLabel(junk)).toBe('string');
    }
  });
});

describe('byProviderLabel', () => {
  it('sorts mixed shapes together by what they render', () => {
    const list = [
      { id: 'openai', name: 'OpenAI' },
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'openai-codex', name: 'OpenAI Codex' },
    ].sort(byProviderLabel);
    expect(list.map(providerLabel)).toEqual(['Anthropic', 'ChatGPT', 'OpenAI']);
  });

  it('ignores punctuation, so Grok-Build and GrokAI order by their letters', () => {
    const list = ['Groq', 'GrokAI', 'Grok-Build'].sort(byProviderLabel);
    expect(list).toEqual(['Grok-Build', 'GrokAI', 'Groq']);
  });

  it('ignores CASE, which is what custom provider names actually vary in', () => {
    // A naive `a < b` agrees with localeCompare on every built-in label, so the
    // built-ins alone cannot prove this option is doing anything. Custom
    // providers are user-named and arrive in any casing: with a raw comparison
    // every capitalised name sorts before every lowercase one, so 'zeta' would
    // land after 'Zeta' but also after 'OpenAI'.
    const list = ['zeta', 'Antigravity', 'anthropic', 'OpenAI'].sort(byProviderLabel);
    expect(list).toEqual(['anthropic', 'Antigravity', 'OpenAI', 'zeta']);
  });

  it('does not throw on an unknown provider', () => {
    expect(() => ['zzz-unknown', 'openai'].sort(byProviderLabel)).not.toThrow();
  });
});

describe('connectableAiProviders — one list for every setup grid', () => {
  /**
   * The onboarding modal and the chat's provider setup card both ask "which AI
   * providers do we offer, in what order?" and used to answer it with two
   * copies of the same twelve lines. They drifted: the ChatGPT ordering and
   * labelling fix landed on the modal, and the chat card kept sorting by the
   * auth API's `name` and rendering it raw — so the same provider was
   * "OpenAI Codex" filed under O on one screen and "ChatGPT" under C on the
   * other. These pin the shared answer.
   */
  const AI = (id, name, extra = {}) => ({ id, name, categories: ['AI'], ...extra });

  it('orders by the LABEL, so ChatGPT lands in the C group', () => {
    const list = connectableAiProviders([
      AI('openai', 'OpenAI'),
      AI('cerebras', 'Cerebras'),
      AI('openai-codex', 'OpenAI Codex'),
      AI('chutes', 'Chutes'),
      AI('anthropic', 'Anthropic'),
    ]);
    expect(list.map(providerLabel)).toEqual([
      'Anthropic',
      'Cerebras',
      'ChatGPT',
      'Chutes',
      'OpenAI',
    ]);
  });

  it('keeps only AI-category providers', () => {
    const list = connectableAiProviders([
      AI('openai', 'OpenAI'),
      { id: 'slack', name: 'Slack', categories: ['Communication'] },
      { id: 'stripe', name: 'Stripe', categories: [] },
    ]);
    expect(list.map((p) => p.id)).toEqual(['openai']);
  });

  it('accepts categories as a JSON string, which is how the API sends them', () => {
    const list = connectableAiProviders([{ id: 'openai', name: 'OpenAI', categories: '["AI"]' }]);
    expect(list).toHaveLength(1);
  });

  it('matches the category case-insensitively', () => {
    expect(connectableAiProviders([{ id: 'x', name: 'X', categories: ['ai'] }])).toHaveLength(1);
    expect(connectableAiProviders([{ id: 'y', name: 'Y', categories: ['Ai'] }])).toHaveLength(1);
  });

  it('survives malformed categories instead of taking out the whole grid', () => {
    // One bad record used to throw from JSON.parse inside the filter, which
    // renders an empty setup screen and leaves the user with no way in.
    const list = connectableAiProviders([
      { id: 'broken', name: 'Broken', categories: '{not json' },
      AI('openai', 'OpenAI'),
    ]);
    expect(list.map((p) => p.id)).toEqual(['openai']);
  });

  describe('the ChatGPT tile is hidden only when its own service says so', () => {
    const providers = [AI('openai-codex', 'OpenAI Codex'), AI('openai', 'OpenAI')];
    const ids = (codexStatus) => connectableAiProviders(providers, { codexStatus }).map((p) => p.id);

    it('shows it when the Codex service is usable', () => {
      expect(ids({ available: true, apiUsable: true })).toContain('openai-codex');
    });

    it('hides it when connected but genuinely unusable', () => {
      expect(ids({ available: true, apiUsable: false })).not.toContain('openai-codex');
    });

    it('shows it when NOT connected — which is every provider on this screen', () => {
      // The whole point of the setup grid is offering providers the user has
      // not connected. Hiding this one for being unconnected would make it
      // impossible to ever connect.
      expect(ids({ available: false })).toContain('openai-codex');
    });

    it('shows it before the status has loaded', () => {
      // `available` is undefined on first paint. Treating that as unusable
      // would blink the tile out of existence at the start of every session.
      expect(ids(undefined)).toContain('openai-codex');
      expect(ids({})).toContain('openai-codex');
    });
  });

  it('returns an empty list for junk input rather than throwing', () => {
    // This feeds a v-for. A throw here blanks the only screen that can fix it.
    for (const junk of [null, undefined, 'nope', 42, {}]) {
      expect(connectableAiProviders(junk)).toEqual([]);
    }
  });

  it('does not mutate the caller\'s array', () => {
    // It is called from a computed over Vuex state; sorting in place would
    // reorder the store and re-trigger the computed.
    const input = [AI('openai', 'OpenAI'), AI('anthropic', 'Anthropic')];
    connectableAiProviders(input);
    expect(input.map((p) => p.id)).toEqual(['openai', 'anthropic']);
  });
});

describe('the label layer stays separate from the identifier layer', () => {
  it('PROVIDER_DISPLAY_NAMES still answers for both spellings', () => {
    // OnboardingModal used to inline `[id] || [name] || name`; providerLabel
    // replaced that, but other screens still index this map directly.
    expect(PROVIDER_DISPLAY_NAMES['openai-codex']).toBe('ChatGPT');
    expect(PROVIDER_DISPLAY_NAMES['OpenAI-Codex']).toBe('ChatGPT');
  });
});
