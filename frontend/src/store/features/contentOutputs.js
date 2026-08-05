import { API_CONFIG } from '@/tt.config.js';

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

import { toServerDate } from '@/utils/serverTime.js';
import { unreadIdSet, triageRail } from '@/utils/conversationAttention.js';

/**
 * Fields an attention write owns, and which a stale snapshot may therefore
 * not overwrite. See snapshotIsStaleForAttention.
 *
 * `updated_at` is in this list because marking a conversation unread MOVES it
 * (the row's last activity becomes the moment the user queued it). Withholding
 * only the watermark would be worse than withholding nothing: a stale snapshot
 * would restore the OLD updated_at while keeping the NEW last_read_at, leaving
 * updated_at < last_read_at — which derives as READ. The user's click would
 * undo itself.
 */
const ATTENTION_OWNED_FIELDS = ['last_read_at', 'archived_at', 'updated_at'];

/**
 * Should an incoming snapshot's attention-owned fields be ignored in favour of
 * what this client already has?
 *
 * THE RACE THIS CLOSES: the user clicks "Mark as Unread"; a list snapshot
 * whose data was read BEFORE that PATCH committed arrives AFTER the
 * optimistic flip, and silently un-marks it. With saves broadcasting row
 * metadata every few seconds during streaming, that race was near-certain —
 * it is why marked conversations would not STAY unread.
 *
 * A snapshot is stale for a row iff an attention write was in flight when the
 * snapshot was taken, or settled after it was taken. Snapshots carry the time
 * they were STARTED (fetchStartedAt / snapshotStartedAt); writes bracket
 * themselves with ATTENTION_WRITE_STARTED / _SETTLED. Only the fields above
 * are ever withheld, and only inside that window — titles and group moves
 * from the same snapshot still apply.
 */
function snapshotIsStaleForAttention(state, id, snapshotStartedAt) {
  if ((state.attentionInFlight[id] || 0) > 0) return true;
  const settledAt = state.attentionSettledAt[id];
  return !!settledAt && snapshotStartedAt <= settledAt;
}

/** Copy the attention-owned fields from `local` onto `row`, in place. */
function keepLocalAttention(row, local) {
  for (const field of ATTENTION_OWNED_FIELDS) row[field] = local[field];
  return row;
}

function convertRowDates(output) {
  return {
    ...output,
    created_at: toServerDate(output.created_at),
    updated_at: toServerDate(output.updated_at),
    last_read_at: toServerDate(output.last_read_at),
    archived_at: toServerDate(output.archived_at),
  };
}

export default {
  namespaced: true,
  // A FACTORY, not an object literal. A plain object is shared by every store
  // this module is ever registered into — harmless-looking until state gains
  // long-lived bookkeeping (the attention maps below), at which point two
  // stores silently share and corrupt it. Bit us in tests, where every
  // createStore() in a spec file was mutating the same maps.
  state: () => ({
    outputs: [],
    totalCount: 0,
    lastFetched: null,
    isFetching: false,
    hasLoadedAll: false,
    // Conversations the user explicitly marked unread (3-dot menu). The
    // watermark itself lives server-side; this set records INTENT, and it
    // exists because intent has a different lifetime than the derived flag:
    // a manual unread must survive autosaves of the conversation the user is
    // still viewing (each of which would otherwise re-stamp it read) and only
    // clears when the user actually re-opens the conversation. id -> true.
    manuallyUnread: {},
    // Attention-write bookkeeping for snapshotIsStaleForAttention. id -> count
    // of in-flight PATCHes / id -> ms timestamp of the last settle.
    attentionInFlight: {},
    attentionSettledAt: {},
  }),
  mutations: {
    SET_OUTPUTS(state, { outputs, totalCount, append = false, fetchStartedAt = 0 }) {
      // Boundary conversion. Server timestamps are naive UTC strings from
      // SQLite's CURRENT_TIMESTAMP; `new Date()` would read them as local time
      // and place every row hours in the future. See utils/serverTime.js.
      //
      // Attention fields are kept from LOCAL state for rows with an
      // unsettled/just-settled attention write — this snapshot predates the
      // write and would revert it. See snapshotIsStaleForAttention.
      const localById = new Map(state.outputs.map((o) => [o.id, o]));
      const mappedOutputs = outputs.map((output) => {
        const row = convertRowDates(output);
        const local = localById.get(row.id);
        if (local && snapshotIsStaleForAttention(state, row.id, fetchStartedAt)) {
          keepLocalAttention(row, local);
        }
        return row;
      });

      if (append) {
        // Append new outputs, avoiding duplicates
        const existingIds = new Set(state.outputs.map((o) => o.id));
        const newOutputs = mappedOutputs.filter((o) => !existingIds.has(o.id));
        state.outputs = [...state.outputs, ...newOutputs];
      } else {
        state.outputs = mappedOutputs;
      }

      state.totalCount = totalCount;
      state.lastFetched = Date.now();
    },
    SET_HAS_LOADED_ALL(state, value) {
      state.hasLoadedAll = value;
    },
    SET_FETCHING(state, value) {
      state.isFetching = value;
    },
    ADD_OUTPUT(state, output) {
      state.outputs.unshift(convertRowDates(output));
    },
    /**
     * Merge ONE row's authoritative list metadata — the payload a save
     * response / realtime broadcast carries. This replaces the old behaviour
     * of refetching the ENTIRE list on every save event: during streaming a
     * conversation autosaves every ~5s, and with a long history those
     * full-list refetches (two per save — socket plus window event) were a
     * permanent fetch storm that starved actual conversation loads.
     *
     * Same staleness rule as SET_OUTPUTS for the attention fields.
     */
    UPSERT_OUTPUT_META(state, { output, snapshotStartedAt = 0 }) {
      if (!output || !output.id) return;
      // A transcript owned by an embedded chat channel (workspace, artifact,
      // widget, workflow) is not an item in this list. The server already
      // excludes them from the list QUERY, but every save also broadcasts its
      // row here — so without this guard a workspace chat would insert itself
      // into the sidebar live, on the next turn, and only disappear on
      // refresh. Same rule on both paths or the two disagree.
      if (output.channel_key || output.channelKey) return;
      const row = convertRowDates(output);
      const idx = state.outputs.findIndex((o) => o.id === row.id);
      if (idx === -1) {
        state.outputs.unshift(row);
        state.totalCount += 1;
        return;
      }
      const local = state.outputs[idx];
      if (snapshotIsStaleForAttention(state, row.id, snapshotStartedAt)) {
        keepLocalAttention(row, local);
      }
      // Merge over local: meta payloads carry no content column, and any
      // fields this client alone knows about must survive.
      state.outputs[idx] = { ...local, ...row };
    },
    SET_MANUAL_UNREAD(state, { id, on }) {
      if (on) state.manuallyUnread = { ...state.manuallyUnread, [id]: true };
      else if (state.manuallyUnread[id]) {
        const next = { ...state.manuallyUnread };
        delete next[id];
        state.manuallyUnread = next;
      }
    },
    ATTENTION_WRITE_STARTED(state, id) {
      state.attentionInFlight = {
        ...state.attentionInFlight,
        [id]: (state.attentionInFlight[id] || 0) + 1,
      };
    },
    ATTENTION_WRITE_SETTLED(state, id) {
      const count = Math.max(0, (state.attentionInFlight[id] || 0) - 1);
      state.attentionInFlight = { ...state.attentionInFlight, [id]: count };
      state.attentionSettledAt = { ...state.attentionSettledAt, [id]: Date.now() };
    },
    /**
     * Patch a single output in-place (e.g. after a rename) without reordering.
     */
    PATCH_OUTPUT(state, { id, updates }) {
      const idx = state.outputs.findIndex((o) => o.id === id);
      if (idx === -1) return;
      state.outputs[idx] = { ...state.outputs[idx], ...updates };
    },
    REMOVE_OUTPUT(state, outputId) {
      state.outputs = state.outputs.filter((output) => output.id !== outputId);
    },
    INVALIDATE_CACHE(state) {
      state.lastFetched = null;
    },
  },
  getters: {
    outputs: (state) => state.outputs,
    // Derived attention state — see utils/conversationAttention.js for the
    // model. Server columns are the single source of truth; there is no
    // client-side unread bookkeeping to drift out of sync.
    unreadOutputIdSet: (state) => unreadIdSet(state.outputs),
    triageRail: (state) => triageRail(state.outputs),
    isManuallyUnread: (state) => (id) => !!state.manuallyUnread[id],
    visibleOutputs: (state) => state.outputs.filter((o) => !o.archived_at),
    archivedOutputs: (state) => state.outputs.filter((o) => !!o.archived_at),
    totalCount: (state) => state.totalCount,
    isFetching: (state) => state.isFetching,
    hasLoadedAll: (state) => state.hasLoadedAll,
    hasMore: (state) => state.outputs.length < state.totalCount,
    isCacheValid: (state) => {
      if (!state.lastFetched) return false;
      return Date.now() - state.lastFetched < CACHE_DURATION;
    },
  },
  actions: {
    async fetchOutputs({ commit, getters, state }, { force = false, limit = null, offset = 0, loadAll = true } = {}) {
      // If cache is valid and not forcing, return cached data
      // Skip cache when loadAll is requested or when fetching additional pages (offset > 0)
      if (!force && !loadAll && getters.isCacheValid && state.outputs.length > 0 && offset === 0) {
        return state.outputs;
      }

      // If already fetching, don't fetch again
      if (state.isFetching) {
        return state.outputs;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        return [];
      }

      commit('SET_FETCHING', true);

      // Taken BEFORE the request leaves: everything in the response reflects
      // server state no later than this instant, which is what the attention
      // staleness check in SET_OUTPUTS compares against.
      const fetchStartedAt = Date.now();

      try {
        // Build URL with pagination params
        const url = new URL(`${API_CONFIG.BASE_URL}/content-outputs`);
        if (!loadAll) {
          url.searchParams.append('limit', limit);
          url.searchParams.append('offset', offset);
        }

        const response = await fetch(url.toString(), {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        commit('SET_OUTPUTS', {
          outputs: data.outputs,
          totalCount: data.totalCount || data.outputs.length,
          append: offset > 0,
          fetchStartedAt,
        });

        if (loadAll || data.outputs.length >= (data.totalCount || data.outputs.length)) {
          commit('SET_HAS_LOADED_ALL', true);
        }

        return data.outputs;
      } catch (error) {
        console.error('Error fetching outputs:', error);
        return [];
      } finally {
        commit('SET_FETCHING', false);
      }
    },

    async loadMore({ commit, state, dispatch }) {
      if (state.isFetching || state.hasLoadedAll) {
        return;
      }

      const offset = state.outputs.length;
      await dispatch('fetchOutputs', { limit: 20, offset, force: true });
    },

    async loadAll({ commit, state, dispatch }) {
      if (state.isFetching || state.hasLoadedAll) {
        return;
      }

      await dispatch('fetchOutputs', { loadAll: true, force: true });
    },

    async deleteOutput({ commit }, outputId) {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        throw new Error('No authentication token');
      }

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        commit('REMOVE_OUTPUT', outputId);
        return true;
      } catch (error) {
        console.error('Error deleting output:', error);
        throw error;
      }
    },

    /**
     * Shared shape for the two attention PATCHes: optimistic local flip,
     * fire the request, revert the exact fields on failure. The optimistic
     * timestamps use the client clock — close enough for a derived boolean,
     * and the next refetch replaces them with server truth.
     */
    async _patchAttention({ commit, state }, { outputId, path, body, updates }) {
      // The output may not be in local state yet (e.g. a direct
      // /chat?content-id=… open before the sidebar list has fetched). The
      // server PATCH must still go out — only the optimistic flip is skipped.
      const original = state.outputs.find((o) => o.id === outputId);
      const revert = original
        ? Object.fromEntries(Object.keys(updates).map((k) => [k, original[k]]))
        : null;

      if (original) commit('PATCH_OUTPUT', { id: outputId, updates });

      // Bracket the write so concurrent snapshots (full fetches, save-meta
      // upserts) can tell they predate it — see snapshotIsStaleForAttention.
      commit('ATTENTION_WRITE_STARTED', outputId);

      const token = localStorage.getItem('token');
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}/${path}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      } catch (error) {
        if (revert) commit('PATCH_OUTPUT', { id: outputId, updates: revert });
        console.error(`Error patching ${path} on output ${outputId}:`, error);
        throw error;
      } finally {
        commit('ATTENTION_WRITE_SETTLED', outputId);
      }
    },

    /**
     * Merge one row's authoritative metadata from a save response or a
     * realtime broadcast — the event-carried alternative to refetching the
     * whole list.
     */
    applyOutputMeta({ commit }, { output, snapshotStartedAt }) {
      commit('UPSERT_OUTPUT_META', { output, snapshotStartedAt });
    },

    markRead({ commit, dispatch, state }, outputId) {
      // Re-opening (or explicitly clearing) a conversation ends any manual
      // "keep this unread" intent — that is the email-client contract.
      commit('SET_MANUAL_UNREAD', { id: outputId, on: false });
      // Optimistic watermark = the row's own updated_at, NOT the client
      // clock. "Read" means "seen everything up to the last change", and
      // updated_at IS the last change — so this is exact and immune to
      // client/server clock skew (a skewed client clock behind the server's
      // updated_at would otherwise leave a phantom unread dot until the
      // next refetch). The server stamps its own CURRENT_TIMESTAMP as truth.
      const row = state.outputs.find((o) => o.id === outputId);
      return dispatch('_patchAttention', {
        outputId,
        path: 'read',
        body: { read: true },
        updates: { last_read_at: row?.updated_at || new Date() },
      });
    },

    markUnread({ commit, dispatch, state }, outputId) {
      // Record INTENT first: until the user re-opens this conversation,
      // nothing may silently clear it — in particular the viewing:true
      // autosaves of the currently-open conversation (see chat.js), which is
      // exactly how a manual mark-unread of the active chat was being wiped
      // within seconds.
      commit('SET_MANUAL_UNREAD', { id: outputId, on: true });
      // Mirrors the server's write exactly (ContentOutputModel.setReadState):
      // the conversation's last activity becomes NOW, because queueing it for
      // later IS activity, with the watermark one second behind so it derives
      // as unread.
      //
      // Moving updated_at is what keeps the row where the user just put it.
      // Writing only the watermark left it sorted by its original date, so
      // reading it dropped it back down the list — out from under the cursor
      // that had just reached it.
      //
      // The watermark is NOT null: null means "no watermark was ever
      // recorded", the state of every conversation predating the column, and
      // that is explicitly NOT unread. Writing null here would show the dot
      // and then have it vanish on the next refetch when server truth landed.
      const now = Date.now();
      return dispatch('_patchAttention', {
        outputId,
        path: 'read',
        body: { read: false },
        updates: {
          updated_at: new Date(now),
          last_read_at: new Date(now - 1000),
        },
      });
    },

    /**
     * Clear many conversations at once — the rail's "mark all read" button.
     *
     * ONE request, not one per row: the user pressed one button, and N
     * parallel PATCHes can half-apply and leave the rail in a state no single
     * refetch explains. Optimism is applied only to rows already in local
     * state, but every requested id is still sent — same contract as
     * _patchAttention. On failure every optimistic flip is rolled back.
     */
    async markAllRead({ commit, state }, outputIds) {
      const ids = (outputIds || []).filter(Boolean);
      if (ids.length === 0) return { cleared: 0 };

      ids.forEach((id) => {
        commit('SET_MANUAL_UNREAD', { id, on: false });
        commit('ATTENTION_WRITE_STARTED', id);
      });

      const revert = [];
      for (const id of ids) {
        const row = state.outputs.find((o) => o.id === id);
        if (!row) continue;
        revert.push({ id, updates: { last_read_at: row.last_read_at } });
        // Watermark = the row's own updated_at, not the client clock — see
        // markRead for why this is skew-proof.
        commit('PATCH_OUTPUT', { id, updates: { last_read_at: row.updated_at || new Date() } });
      }

      const token = localStorage.getItem('token');
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/read-all`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ ids }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        revert.forEach((r) => commit('PATCH_OUTPUT', r));
        console.error('Error marking conversations read:', error);
        throw error;
      } finally {
        ids.forEach((id) => commit('ATTENTION_WRITE_SETTLED', id));
      }
    },

    setArchived({ dispatch }, { outputId, archived }) {
      return dispatch('_patchAttention', {
        outputId,
        path: 'archive',
        body: { archived },
        updates: { archived_at: archived ? new Date() : null },
      });
    },

    invalidateCache({ commit }) {
      commit('INVALIDATE_CACHE');
      commit('SET_HAS_LOADED_ALL', false);
    },

    refreshOutputs({ dispatch, commit }) {
      commit('SET_HAS_LOADED_ALL', false);
      return dispatch('fetchOutputs', { force: true, loadAll: true });
    },
  },
};
