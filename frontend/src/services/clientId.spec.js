// Who "this client" is — and why it is answered with an id rather than a guess.
//
// The server announces every started run to ALL of a user's connected clients
// so an already-open browser can attach to a turn begun elsewhere. The client
// that started it is in that audience and must ignore its own announcement.
//
// The obvious discriminator — "do I already know this conversation id?" —
// does not work. For a NEW conversation the sender has no server id yet: its
// slot is keyed by a temp id until conversation_started arrives over SSE,
// while the announcement travels on the socket. Two transports, no ordering
// guarantee. When the announcement wins, the sender does not recognise the id,
// attaches to itself, and MIGRATE_CONVERSATION_ID then overwrites the slot it
// just created — two live streams, one half-attached conversation.
import { describe, it, expect, vi } from 'vitest';
import { getClientId, isOwnAnnouncement } from './clientId.js';

describe('the id', () => {
  it('is stable for the life of the page', () => {
    expect(getClientId()).toBe(getClientId());
  });

  it('is a non-empty string', () => {
    expect(typeof getClientId()).toBe('string');
    expect(getClientId().length).toBeGreaterThan(8);
  });

  it('differs between page loads, so a reloaded tab is a NEW client', async () => {
    // Deliberately not persisted. sessionStorage would survive a reload, and a
    // reloaded tab would then treat a still-running turn as its own and skip
    // attaching to it — exactly the case resume exists to serve.
    const first = getClientId();
    vi.resetModules();
    const { getClientId: reloaded } = await import('./clientId.js');
    expect(reloaded()).not.toBe(first);
  });

  it('still produces an id where crypto.randomUUID is unavailable', async () => {
    // Non-secure contexts and older test environments. Throwing here would
    // break module init for every importer, chat included.
    //
    // stubGlobal rather than assignment: globalThis.crypto is defined with only
    // a getter, so `globalThis.crypto = ...` throws before the code under test
    // is ever reached.
    vi.resetModules();
    vi.stubGlobal('crypto', {});
    try {
      const { getClientId: fallback } = await import('./clientId.js');
      expect(fallback()).toMatch(/^client-/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('recognising your own announcement', () => {
  it('claims an announcement carrying this id', () => {
    expect(isOwnAnnouncement(getClientId())).toBe(true);
  });

  it('disclaims another client\'s', () => {
    expect(isOwnAnnouncement('some-other-client')).toBe(false);
  });

  it('disclaims an unlabelled announcement', () => {
    // Resolves towards attaching: attaching twice is recoverable, never
    // attaching is the bug this path exists to fix.
    expect(isOwnAnnouncement(null)).toBe(false);
    expect(isOwnAnnouncement(undefined)).toBe(false);
    expect(isOwnAnnouncement('')).toBe(false);
  });
});
