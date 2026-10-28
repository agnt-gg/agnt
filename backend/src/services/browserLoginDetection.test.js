import { describe, it, expect } from 'vitest';
import {
  classifyLoginPage, signInHint, identityProviderForHost, LOGIN_PROBE_EXPRESSION,
} from './browserLoginDetection.js';

const page = (overrides = {}) => ({
  host: 'example.com', path: '/', title: '', text: '', passwordFields: 0, identifierFields: 0, oneTimeCodeFields: 0, ...overrides,
});

describe('classifyLoginPage', () => {
  // The exact page trace 64eeeb9c stopped on, 2026-10-28.
  it('Google\'s password challenge is a sign-in that needs a plain window', () => {
    const login = classifyLoginPage(page({
      host: 'accounts.google.com', path: '/v3/signin/challenge/pwd', title: 'Hi Nathan', text: 'Hi Nathan\nEnter your password', passwordFields: 1,
    }));
    expect(login).toMatchObject({ kind: 'sign-in', provider: 'Google', window: true });
  });

  it('Google\'s account chooser is not a wall — the agent picks the listed account', () => {
    expect(classifyLoginPage(page({
      host: 'accounts.google.com', path: '/v3/signin/accountchooser', title: '\u{1F434} Sign in - Google Accounts', text: 'Choose an account\nNathan Wilbanks',
    }))).toBeNull();
  });

  it('a lapsed session on the chooser path still asks for the password', () => {
    expect(classifyLoginPage(page({
      host: 'accounts.google.com', path: '/v3/signin/accountchooser', passwordFields: 1,
    }))).toMatchObject({ kind: 'sign-in', provider: 'Google' });
  });

  it('Google refusing the automated browser is named, so the window is used', () => {
    const login = classifyLoginPage(page({
      host: 'accounts.google.com', path: '/v3/signin/rejected', text: 'Couldn’t sign you in\nThis browser or app may not be secure. Learn more',
    }));
    expect(login).toMatchObject({ kind: 'rejected-browser', provider: 'Google', window: true });
    expect(signInHint(login)).toMatch(/mode="window"/);
  });

  it('an OAuth consent screen is the person\'s decision, not a sign-in', () => {
    const login = classifyLoginPage(page({
      host: 'accounts.google.com', path: '/signin/oauth/id', text: 'Deepgram wants access to your Google Account\nnathan@bizop.io',
    }));
    expect(login).toMatchObject({ kind: 'consent', provider: 'Google' });
    expect(signInHint(login)).toMatch(/confirm before you approve/);
  });

  it('a Microsoft sign-in takes the window path too', () => {
    expect(classifyLoginPage(page({
      host: 'login.microsoftonline.com', path: '/common/oauth2/v2.0/authorize', title: 'Sign in to your account', identifierFields: 1,
    }))).toMatchObject({ kind: 'sign-in', provider: 'Microsoft', window: true });
  });

  it('GitHub\'s login is a sign-in that works in the live view', () => {
    expect(classifyLoginPage(page({
      host: 'github.com', path: '/login', title: 'Sign in to GitHub · GitHub', passwordFields: 1, identifierFields: 1,
    }))).toMatchObject({ kind: 'sign-in', provider: 'GitHub', window: false });
  });

  it('a GitHub repository page is not a login wall', () => {
    expect(classifyLoginPage(page({ host: 'github.com', path: '/agnt-gg/agnt', title: 'agnt-gg/agnt' }))).toBeNull();
  });

  it('any site\'s login form is a sign-in, named by its host', () => {
    expect(classifyLoginPage(page({
      host: 'app.partnerstack.com', path: '/login', title: 'Log in | PartnerStack', passwordFields: 1, identifierFields: 1,
    }))).toMatchObject({ kind: 'sign-in', provider: 'app.partnerstack.com', window: false });
  });

  it('an identifier-first login (email, then Next) is a sign-in', () => {
    expect(classifyLoginPage(page({ host: 'dash.example.io', path: '/auth', title: 'Sign in', identifierFields: 1 }))).toMatchObject({ kind: 'sign-in' });
  });

  it('a signup form is not a login wall', () => {
    expect(classifyLoginPage(page({ title: 'Sign up — Example', passwordFields: 1, identifierFields: 1 }))).toBeNull();
    expect(classifyLoginPage(page({ title: 'Welcome', passwordFields: 2, identifierFields: 1, text: 'Log in instead' }))).toBeNull();
  });

  it('an article that talks about logging in is not a login wall', () => {
    expect(classifyLoginPage(page({ title: 'How to log in to your router', text: 'Sign in with the admin password printed on the label.' }))).toBeNull();
  });

  it('tolerates junk', () => {
    expect(classifyLoginPage(null)).toBeNull();
    expect(classifyLoginPage('nope')).toBeNull();
    expect(classifyLoginPage({})).toBeNull();
  });
});

describe('identityProviderForHost', () => {
  it('knows which providers need the plain window', () => {
    expect(identityProviderForHost('accounts.google.com')?.window).toBe(true);
    expect(identityProviderForHost('appleid.apple.com')?.window).toBe(true);
    expect(identityProviderForHost('github.com')?.window).toBeFalsy();
    expect(identityProviderForHost('example.com')).toBeNull();
  });
});

describe('LOGIN_PROBE_EXPRESSION', () => {
  it('is a self-contained expression that never reads a field value', () => {
    expect(LOGIN_PROBE_EXPRESSION).toMatch(/^\(\(\) => \{/);
    expect(LOGIN_PROBE_EXPRESSION).not.toMatch(/\.value\b/);
  });
});
