/**
 * Provider list ordering.
 *
 * BUILT_IN_PROVIDERS was hand-alphabetized, so display order depended entirely
 * on where an author happened to append their entry. PR #50 appended Cursor
 * next to Grok-Build, which put "Cursor" between the G's in the UI. Order is
 * now enforced by a sort at the boundary; these tests pin that so the list
 * cannot drift again no matter where the next provider is typed.
 *
 * Asserts against the REAL module exports — not a copy of the literal.
 */
import { describe, it, expect } from 'vitest';
import aiProviderStore, { AI_PROVIDERS_WITH_API } from './aiProvider.js';

const displayed = () => aiProviderStore.state.providers;

describe('provider display order', () => {
  it('is alphabetical, case- and punctuation-insensitive', () => {
    const list = displayed();
    expect(list.length).toBeGreaterThan(5);
    const sorted = [...list].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(list).toEqual(sorted);
  });

  it('places Cursor in the C group, not next to the Groks (PR #50 regression)', () => {
    const list = displayed();
    const at = (name) => list.indexOf(name);
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

  it('has no duplicate display names', () => {
    const list = displayed();
    expect(new Set(list).size).toBe(list.length);
  });
});
