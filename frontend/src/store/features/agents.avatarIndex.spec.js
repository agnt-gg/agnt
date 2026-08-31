/**
 * THE AVATAR LOOKUP THE ROSTER SURFACES DRAW FROM.
 *
 * THE TRAP THIS FILE EXISTS FOR: SET_AGENTS renames the backend's `icon`
 * field to `avatar` on the way into the store —
 *
 *     avatar: agent.icon || null,  // icon from backend is avatar in frontend
 *
 * so a getter that reaches for `agent.icon` gets undefined for every agent
 * and silently blanks every face in the app. That is exactly the bug the
 * sidebar shipped with: real photographs on disk, letters on screen, and no
 * error anywhere.
 *
 * So these tests DO NOT hand-build a store shape. They push a real backend
 * payload through the real mutation and then read the getter, which means the
 * mapping and the lookup cannot drift apart without turning this red.
 */
import { describe, it, expect } from 'vitest';
import agents from './agents.js';
import { attachIcons, resolveAvatar } from '@/utils/agentAvatar.js';

/** A backend row, shaped exactly as GET /api/agents/ returns it. */
const backendAgent = (over = {}) => ({
  id: 'a1',
  name: 'Sol',
  icon: 'data:image/png;base64,SOLPIC',
  status: 'active',
  ...over,
});

/** Run the REAL mutation, then read the REAL getter. */
const indexFrom = (backendAgents) => {
  const state = { agents: [], lastFetched: null };
  agents.mutations.SET_AGENTS(state, backendAgents);
  return { state, index: agents.getters.avatarIndex(state) };
};

describe('agents/avatarIndex', () => {
  it('finds an agent avatar by id after the real mutation has mapped it', () => {
    const { index } = indexFrom([backendAgent()]);
    expect(index.byId.get('a1')).toBe('data:image/png;base64,SOLPIC');
  });

  it('REGRESSION: reads the field SET_AGENTS actually writes, not `icon`', () => {
    // Belt and braces on the rename: prove the stored row carries the picture
    // under `avatar`, and that the getter found it anyway.
    const { state, index } = indexFrom([backendAgent()]);
    expect(state.agents[0].avatar).toBe('data:image/png;base64,SOLPIC');
    expect(state.agents[0].icon).toBeUndefined();
    expect(index.byId.size).toBe(1);
  });

  it('indexes by name as well, for transcripts that recorded no id', () => {
    const { index } = indexFrom([backendAgent()]);
    expect(index.byName.get('Sol')).toBe('data:image/png;base64,SOLPIC');
  });

  it('is first-wins on duplicate names, because names are not unique', () => {
    // This install really has three agents called "Social Media Manager".
    const { index } = indexFrom([
      backendAgent({ id: 'a1', name: 'Social Media Manager', icon: 'FIRST' }),
      backendAgent({ id: 'a2', name: 'Social Media Manager', icon: 'SECOND' }),
    ]);
    expect(index.byName.get('Social Media Manager')).toBe('FIRST');
    // ...but both are still addressable by id, which is what the roster uses.
    expect(index.byId.get('a1')).toBe('FIRST');
    expect(index.byId.get('a2')).toBe('SECOND');
  });

  it('indexes emoji icons too — they are 63 of the 90 agents here', () => {
    const { index } = indexFrom([backendAgent({ id: 'a3', name: 'Palette', icon: '🎨' })]);
    expect(index.byId.get('a3')).toBe('🎨');
  });

  it('skips agents with no icon rather than storing empty entries', () => {
    const { index } = indexFrom([backendAgent({ id: 'a4', name: 'Plain', icon: null })]);
    expect(index.byId.has('a4')).toBe(false);
  });

  it('is empty and harmless before agents have loaded', () => {
    const index = agents.getters.avatarIndex({ agents: [] });
    expect(index.byId.size).toBe(0);
    expect(attachIcons([{ id: 'a1', name: 'Sol' }], index)[0].icon).toBeFalsy();
  });

  it('END TO END: a stored roster entry resolves to an image through the store', () => {
    // The whole path in one assertion: backend payload -> mutation -> getter
    // -> attachIcons -> resolveAvatar. This is what the sidebar does.
    const { index } = indexFrom([backendAgent()]);
    const [participant] = attachIcons([{ id: 'a1', name: 'Sol' }], index);
    expect(resolveAvatar(participant)).toEqual({ kind: 'image', src: 'data:image/png;base64,SOLPIC' });
  });
});
