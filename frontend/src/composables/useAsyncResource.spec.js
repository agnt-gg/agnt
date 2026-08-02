import { describe, it, expect, beforeEach } from 'vitest';
import { useAsyncResource, clearAsyncResourceCache } from './useAsyncResource.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncResource', () => {
  beforeEach(() => clearAsyncResourceCache());

  it('is unmeasured, not false, before the first response', () => {
    const { data, ready, state } = useAsyncResource(() => new Promise(() => {}));
    expect(data.value).toBe(null);
    expect(ready.value).toBe(false);
    expect(state.value).toBe('loading');
  });

  it('becomes ready only once a real value has been observed', async () => {
    const d = deferred();
    const { data, ready, refresh } = useAsyncResource(() => d.promise);
    const pending = refresh();
    expect(ready.value).toBe(false);
    d.resolve({ lanEnabled: true });
    await pending;
    expect(ready.value).toBe(true);
    expect(data.value).toEqual({ lanEnabled: true });
  });

  it('reports an error instead of an endless skeleton when the first load fails', async () => {
    const { data, error, ready, state, refresh } = useAsyncResource(() =>
      Promise.reject(new Error('boom')),
    );
    await refresh();
    expect(ready.value).toBe(false);
    expect(data.value).toBe(null); // still nothing measured — nothing claimed
    expect(state.value).toBe('error');
    expect(error.value).toBe('boom');
  });

  it('maps errors through the supplied handler', async () => {
    const { error, refresh } = useAsyncResource(() => Promise.reject(new Error('raw')));
    await refresh({ onError: () => 'Session expired — sign in again.' });
    expect(error.value).toBe('Session expired — sign in again.');
  });

  it('keeps the last good value when a later poll fails', async () => {
    let mode = 'ok';
    const { data, error, refresh } = useAsyncResource(() =>
      mode === 'ok' ? Promise.resolve({ n: 1 }) : Promise.reject(new Error('offline')),
    );
    await refresh();
    mode = 'fail';
    await refresh();
    expect(data.value).toEqual({ n: 1 }); // a failed poll must not blank the panel
    expect(error.value).toBe('offline');
  });

  it('ignores a superseded in-flight response', async () => {
    const first = deferred();
    const second = deferred();
    const queue = [first.promise, second.promise];
    const { data, refresh } = useAsyncResource(() => queue.shift());

    const a = refresh();
    const b = refresh();
    second.resolve({ n: 'second' });
    await b;
    first.resolve({ n: 'first (stale)' });
    await a;

    expect(data.value).toEqual({ n: 'second' });
  });

  it('patches a measured resource', async () => {
    const { data, refresh, patch } = useAsyncResource(() => Promise.resolve({ a: 1, b: 2 }));
    await refresh();
    patch({ b: 99 });
    expect(data.value).toEqual({ a: 1, b: 99 });
  });

  it('refuses to fabricate a resource by patching an unmeasured one', () => {
    const { data, ready, patch } = useAsyncResource(() => new Promise(() => {}));
    patch({ restartRequired: true });
    // Patching null would flip `ready` on an object that is undefined
    // everywhere else — precisely the claim-without-measurement this prevents.
    expect(data.value).toBe(null);
    expect(ready.value).toBe(false);
  });

  it('paints last-known-good immediately on the next mount when cached', async () => {
    const { refresh } = useAsyncResource(() => Promise.resolve({ n: 1 }), { cacheKey: 'k' });
    await refresh();

    const remount = useAsyncResource(() => new Promise(() => {}), { cacheKey: 'k' });
    expect(remount.ready.value).toBe(true); // no second skeleton
    expect(remount.data.value).toEqual({ n: 1 });
  });

  it('does not share state between different cache keys', async () => {
    const { refresh } = useAsyncResource(() => Promise.resolve({ n: 1 }), { cacheKey: 'a' });
    await refresh();
    expect(useAsyncResource(() => new Promise(() => {}), { cacheKey: 'b' }).ready.value).toBe(false);
  });

  it('hands each consumer its own copy, so a patch cannot leak sideways', async () => {
    const one = useAsyncResource(() => Promise.resolve({ n: 1 }), { cacheKey: 'k' });
    await one.refresh();
    const two = useAsyncResource(() => new Promise(() => {}), { cacheKey: 'k' });
    two.patch({ n: 2 });
    expect(one.data.value).toEqual({ n: 1 });
  });
});
