/**
 * Deleting a chat that is already gone must not resurrect it.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The sidebar delete is optimistic: remove the row, fire the DELETE, and on
 * failure put the row back and show an error. That rollback is right for a
 * network fault or a 500 — the chat still exists on the server, so the sidebar
 * would be lying if it stayed hidden.
 *
 * It is exactly wrong for 404. A 404 means the server has no such row, which
 * is the state the user asked for. Restoring the row does not recover
 * anything; it re-displays a chat that cannot be opened and cannot be removed,
 * and every subsequent attempt takes the same path. The row becomes
 * permanently undeletable, which is what a user reports as "this chat won't
 * delete at all".
 *
 * Observed live (2026-08-13): a sidebar row whose conversation had a
 * conversation_logs row but no content_outputs row. DELETE answered 404 every
 * time, the client restored the row every time, and the ghost survived
 * everything except a reload.
 *
 * DELETE is idempotent by definition: the postcondition is "this resource does
 * not exist". A server that says it never existed has satisfied that
 * postcondition. So 404 is success here, and only a genuine failure — one that
 * leaves the row in place — may roll back.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from 'vuex';
import contentOutputs from './contentOutputs.js';

const GHOST = 'ghost-output-id';

const makeStore = () => createStore({ modules: { contentOutputs } });

const seed = (store) => store.commit('contentOutputs/SET_OUTPUTS', {
  outputs: [
    { id: GHOST, title: 'hey hey hey', created_at: '2026-08-13 03:13:07', updated_at: '2026-08-13 03:13:07' },
    { id: 'real-output', title: 'a chat that exists', created_at: '2026-08-13 03:15:17', updated_at: '2026-08-13 03:15:17' },
  ],
  totalCount: 2,
});

const respond = (status) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  });
};

let store;

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  store = makeStore();
  seed(store);
});

describe('deleting a chat the server does not have', () => {
  it('resolves instead of throwing, so the caller does not roll back', async () => {
    respond(404);

    // The rollback lives in the caller's .catch. A rejection here IS the bug:
    // it is what puts the ghost row back on screen.
    await expect(store.dispatch('contentOutputs/deleteOutput', GHOST)).resolves.toBe(true);
  });

  it('removes the row locally, so the ghost leaves the sidebar', async () => {
    respond(404);

    await store.dispatch('contentOutputs/deleteOutput', GHOST);

    const ids = store.state.contentOutputs.outputs.map((o) => o.id);
    expect(ids).toEqual(['real-output']);
  });
});

describe('a real failure still rolls back', () => {
  it('throws on a server error, because the chat is still there', async () => {
    respond(500);

    await expect(store.dispatch('contentOutputs/deleteOutput', GHOST)).rejects.toThrow();
  });

  it('throws on a network fault, for the same reason', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(store.dispatch('contentOutputs/deleteOutput', GHOST)).rejects.toThrow();
  });

  it('leaves local state alone when the delete genuinely failed', async () => {
    respond(500);

    await store.dispatch('contentOutputs/deleteOutput', GHOST).catch(() => {});

    // The optimistic removal is the caller's; this action must not additionally
    // commit a removal it could not achieve.
    expect(store.state.contentOutputs.outputs.map((o) => o.id)).toContain(GHOST);
  });
});

describe('the ordinary path is unchanged', () => {
  it('deletes a row that exists', async () => {
    respond(200);

    await expect(store.dispatch('contentOutputs/deleteOutput', GHOST)).resolves.toBe(true);
    expect(store.state.contentOutputs.outputs.map((o) => o.id)).toEqual(['real-output']);
  });

  it('still sends the DELETE to the right place', async () => {
    respond(200);

    await store.dispatch('contentOutputs/deleteOutput', GHOST);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain(`/content-outputs/${GHOST}`);
    expect(options.method).toBe('DELETE');
  });
});
