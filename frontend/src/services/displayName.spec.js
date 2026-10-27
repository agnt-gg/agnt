import { describe, it, expect, vi } from 'vitest';
import { saveDisplayName, DISPLAY_NAME_MAX } from './displayName.js';

// Reported on the 2026-10-27 call: a new account's display name, typed at
// onboarding, never saved (the step only logged it), on desktop and cloud.
const storeWith = (token = 'old-token') => ({ state: { userAuth: { token } }, commit: vi.fn() });
const answer = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('saveDisplayName', () => {
  it('saves to the server, stores the name, and keeps the session the server re-issues', async () => {
    const store = storeWith();
    const fetchImpl = answer(200, { success: true, token: 'renewed-token' });
    await expect(saveDisplayName(store, '  Amber G  ', { fetchImpl })).resolves.toBe('Amber G');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/referrals\/update-pseudonym$/);
    expect(init.headers.Authorization).toBe('Bearer old-token');
    expect(JSON.parse(init.body)).toEqual({ newPseudonym: 'Amber G' });
    expect(store.commit).toHaveBeenCalledWith('userAuth/SET_PSEUDONYM', 'Amber G');
    expect(store.commit).toHaveBeenCalledWith('userAuth/ADOPT_RENEWED_TOKEN', 'renewed-token');
  });

  it('shows the name exactly as the server keeps it (first 32 characters)', async () => {
    const store = storeWith();
    const long = 'x'.repeat(DISPLAY_NAME_MAX + 8);
    await expect(saveDisplayName(store, long, { fetchImpl: answer(200, { success: true }) })).resolves.toBe('x'.repeat(DISPLAY_NAME_MAX));
  });

  it('a refusal is an error with the server\'s reason, and nothing is stored', async () => {
    const store = storeWith();
    await expect(saveDisplayName(store, 'Taken', { fetchImpl: answer(400, { success: false, message: 'This pseudonym is already taken' }) }))
      .rejects.toThrow('This pseudonym is already taken');
    expect(store.commit).not.toHaveBeenCalled();
  });

  it('an empty name is refused before any request', async () => {
    const fetchImpl = vi.fn();
    await expect(saveDisplayName(storeWith(), '   ', { fetchImpl })).rejects.toThrow(/cannot be empty/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
