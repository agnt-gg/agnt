/**
 * CONTRACT: connecting an app through the remote goes through appAuth, and
 * every screen that does so routes a plugin's own sign-in elsewhere first.
 *
 * WHY THIS EXISTS
 * ---------------
 * A sign-in an installed plugin declares (manifest `auth`) exists only in this
 * install; the remote catalogue answers 404 for it. Seven pieces of code
 * decided how to connect an app, each calling the remote's /auth/connect,
 * /auth/apikeys or /auth/disconnect itself, and only one of them knew plugin
 * sign-ins existed. So Connect, Reconnect and Disconnect on the Connectors
 * screen, the Focused pages and the connection-health panel failed for every
 * plugin sign-in ("HTTP error! status: 404").
 *
 * Now appAuth's three actions are the only remote path and refuse a plugin
 * sign-in, and services/pluginSignIn.js runs plugin sign-ins locally. This
 * guard keeps it that way: a new copy of the remote calls fails here, and so
 * does a screen that reaches the remote without asking about plugins first.
 */
import { describe, it, expect } from 'vitest';
import { sourceFiles } from './sourceScan.js';

const REMOTE_SIGN_IN_PATHS = ['/auth/connect/', '/auth/apikeys/', '/auth/disconnect/'];

/** The files allowed to name those paths, and why each one may. */
const ALLOWED = {
  'store/auth/appAuth.js': 'the one network path for app connections; refuses plugin sign-ins',
  'composables/useAiProviderConnect.js': 'AI model providers only, which the remote catalogue defines',
  'services/localKeyBackfill.js': 'reads keys already saved remotely; connects nothing',
};

const REMOTE_ACTIONS = ['requestOAuthUrl', 'saveApiKey', 'disconnectApp'];
const PLUGIN_CHECK = /\b(isPluginSignIn|findPluginSignIn)\(/;

const appFiles = () => sourceFiles({ includeSpecs: false });
const namesRemotePath = (code) => REMOTE_SIGN_IN_PATHS.some((p) => code.includes(p));

describe('only appAuth talks to the remote about connecting an app', () => {
  it('finds the remote calls at all, so a silent zero cannot pass this suite', () => {
    const sites = appFiles().filter(({ code }) => namesRemotePath(code)).map(({ rel }) => rel);
    expect(sites).toContain('store/auth/appAuth.js');
  });

  it('no other file calls /auth/connect, /auth/apikeys or /auth/disconnect on the remote', () => {
    const outside = appFiles()
      .filter(({ rel, code }) => !ALLOWED[rel] && namesRemotePath(code))
      .map(({ rel }) => rel);
    expect(outside, 'call appAuth\'s requestOAuthUrl / saveApiKey / disconnectApp instead (and route plugin sign-ins through services/pluginSignIn.js)').toEqual([]);
  });

  it('every allowlisted file still exists and still needs its entry', () => {
    const byRel = new Map(appFiles().map((f) => [f.rel, f.code]));
    const stale = Object.keys(ALLOWED).filter((rel) => !byRel.has(rel) || !namesRemotePath(byRel.get(rel)));
    expect(stale, 'remove these from ALLOWED').toEqual([]);
  });

  it('appAuth refuses a plugin sign-in in each remote action, before any request', () => {
    const { code } = appFiles().find(({ rel }) => rel === 'store/auth/appAuth.js');
    for (const action of REMOTE_ACTIONS) {
      const start = code.indexOf(`async ${action}(`);
      expect(start, `appAuth.${action} not found`).toBeGreaterThan(-1);
      const body = code.slice(start, code.indexOf('\n  },', start));
      const guard = body.indexOf('refuseRemoteForPluginSignIn(');
      expect(guard, `appAuth.${action} must call refuseRemoteForPluginSignIn`).toBeGreaterThan(-1);
      expect(guard, `appAuth.${action} must refuse before its fetch`).toBeLessThan(body.indexOf('fetch('));
    }
  });
});

describe('every screen that connects through appAuth asks about plugin sign-ins first', () => {
  const callers = () => appFiles().filter(({ code }) =>
    REMOTE_ACTIONS.some((action) => code.includes(`'appAuth/${action}'`)));

  it('finds the screens at all', () => {
    const sites = callers().map(({ rel }) => rel);
    expect(sites).toEqual(expect.arrayContaining([
      'composables/useProviderConnection.js',
      'views/Focused/useAppSignIn.js',
      'views/Terminal/CenterPanel/screens/Connectors/Connectors.vue',
      'views/Terminal/RightPanel/types/ChatPanel/components/IntegrationHealth.vue',
    ]));
  });

  it('each of them checks for a plugin sign-in (services/pluginSignIn.js)', () => {
    const unchecked = callers().filter(({ code }) => !PLUGIN_CHECK.test(code)).map(({ rel }) => rel);
    expect(unchecked, 'these reach the remote without routing plugin sign-ins locally').toEqual([]);
  });
});
