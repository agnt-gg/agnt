import { describe, it, expect } from 'vitest';
import { buildProviderGreeting, greetingNeedsReplacing, isGreeting, WELCOME_TEXT } from './providerGreeting.js';

const setup = buildProviderGreeting(false, { id: 's' });
const welcome = buildProviderGreeting(true, { id: 'w', version: '1.2.3' });

describe('provider greeting', () => {
  it('builds the welcome when connected and the setup card when not', () => {
    expect(welcome).toMatchObject({ content: WELCOME_TEXT, isGreeting: true });
    expect(welcome.metadata).toContain('Version: 1.2.3');
    expect(setup).toMatchObject({ showProviderSetup: true, contentType: 'html', isGreeting: true });
  });

  // Reported: after signing into another account, the chat said no AI provider
  // was connected until a refresh, because the setup card was never replaced.
  it('replaces the setup card once the provider turns out to be connected', () => {
    expect(greetingNeedsReplacing([setup], true)).toBe(true);
    expect(greetingNeedsReplacing([setup], false)).toBe(false);
  });

  it('replaces the welcome when the provider goes away, and leaves it while connected', () => {
    expect(greetingNeedsReplacing([welcome], false)).toBe(true);
    expect(greetingNeedsReplacing([welcome], true)).toBe(false);
  });

  it('never rewrites a conversation someone has spoken in', () => {
    const user = { id: 'u', role: 'user', content: 'hi' };
    expect(greetingNeedsReplacing([setup, user], true)).toBe(false);
    expect(greetingNeedsReplacing([{ id: 'a', role: 'assistant', content: 'a real answer' }], false)).toBe(false);
    expect(greetingNeedsReplacing([], true)).toBe(false);
  });

  it('recognises greetings saved by older builds, which carried no isGreeting flag', () => {
    expect(isGreeting({ role: 'assistant', content: WELCOME_TEXT })).toBe(true);
    expect(isGreeting({ role: 'assistant', content: '<div/>', showProviderSetup: true })).toBe(true);
    expect(greetingNeedsReplacing([{ role: 'assistant', content: '<div/>', showProviderSetup: true }], true)).toBe(true);
  });
});
