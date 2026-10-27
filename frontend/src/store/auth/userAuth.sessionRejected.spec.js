import { describe, it, expect } from 'vitest';
import { sessionRejectedMessage } from './userAuth.js';

// Measured on a customer's team instance: a teammate's code was accepted, the
// instance refused them (not yet a member), the screen said "Restart AGNT",
// and they re-entered the now-spent code and were told it was invalid.
describe('a sign-in the backend refused', () => {
  it('says to ask the owner when the person is not on the workspace yet', () => {
    const text = sessionRejectedMessage({ reason: 'wrong_instance', status: 403 });
    expect(text).toMatch(/don\u2019t have access to this workspace yet/);
    expect(text).toMatch(/new code/);
    expect(text).not.toMatch(/Restart/);
  });
  it('keeps the restart advice for a genuinely broken local session', () => {
    expect(sessionRejectedMessage({ reason: 'http_401' })).toMatch(/Restart AGNT/);
    expect(sessionRejectedMessage(null)).toMatch(/Restart AGNT/);
  });
});
