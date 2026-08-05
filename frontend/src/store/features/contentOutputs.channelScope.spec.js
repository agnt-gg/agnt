// The conversation list never grows an embedded chat, by any route.
//
// The server excludes channel-scoped rows from the list QUERY, but that is
// only one of the two ways a row enters this list. The other is
// UPSERT_OUTPUT_META, which every save response and every realtime broadcast
// flows through — including saves made by workspace, artifact and widget
// chats. Guarding only the query would fix the sidebar on load and let a
// workspace chat insert itself live on its next turn, disappearing again on
// refresh: the most confusing possible version of the bug.
//
// Same rule on both paths, or the two disagree.
import { describe, it, expect, beforeEach } from 'vitest';
import contentOutputs from './contentOutputs.js';

let state;
const commit = (type, payload) => contentOutputs.mutations[type](state, payload);

const row = (id, extra = {}) => ({
  id,
  user_id: 'u1',
  title: id,
  content_type: 'conversation',
  updated_at: '2026-08-05 10:00:00',
  ...extra,
});

beforeEach(() => {
  state = {
    outputs: [],
    totalCount: 0,
    manuallyUnread: {},
    attentionInFlight: {},
    attentionSettledAt: {},
  };
});

describe('UPSERT_OUTPUT_META', () => {
  it('adds a main-chat conversation', () => {
    commit('UPSERT_OUTPUT_META', { output: row('out-main') });

    expect(state.outputs.map((o) => o.id)).toEqual(['out-main']);
    expect(state.totalCount).toBe(1);
  });

  it('ignores a row owned by a chat channel', () => {
    commit('UPSERT_OUTPUT_META', { output: row('out-ws', { channel_key: 'workspace:ws-1' }) });

    expect(state.outputs).toEqual([]);
    expect(state.totalCount).toBe(0);
  });

  it('ignores the camelCase spelling too', () => {
    // The save RESPONSE and the socket broadcast do not have to agree on
    // casing, and a guard that only knows one of them is not a guard.
    commit('UPSERT_OUTPUT_META', { output: row('out-widget', { channelKey: 'widget:w-1' }) });

    expect(state.outputs).toEqual([]);
  });

  it('does not resurrect a scoped row that is already out of the list', () => {
    // The repair sweep scoped this row; a later save from that same chat must
    // not put it back.
    commit('UPSERT_OUTPUT_META', { output: row('out-ws', { channel_key: 'workspace:ws-1' }) });
    commit('UPSERT_OUTPUT_META', { output: row('out-ws', { channel_key: 'workspace:ws-1', title: 'newer turn' }) });

    expect(state.outputs).toEqual([]);
  });

  it('still updates a real conversation in place', () => {
    commit('UPSERT_OUTPUT_META', { output: row('out-main') });
    commit('UPSERT_OUTPUT_META', { output: row('out-main', { title: 'renamed' }) });

    expect(state.outputs).toHaveLength(1);
    expect(state.outputs[0].title).toBe('renamed');
    expect(state.totalCount).toBe(1);
  });
});
