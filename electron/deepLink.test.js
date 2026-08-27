/**
 * `agnt://` links, as they arrive from an operating system.
 *
 * The interesting half of this file is the refusals. This string reaches us
 * because a web page asked the OS to launch us with it, so every test below
 * that asserts a rejection is describing something a hostile page will
 * eventually try.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDeepLink,
  deepLinkFromArgv,
  looksLikeDeepLink,
  intentToUrl,
  ACTION_NAMES,
  SCREENS,
} from './deepLink.js';

describe('the link a use-case page emits', () => {
  it('opens a marketplace listing by asset id', () => {
    const r = parseDeepLink('agnt://marketplace?item=agnt-usecase-email-triage');
    expect(r.ok).toBe(true);
    expect(r.action).toBe('marketplace');
    expect(r.params.item).toBe('agnt-usecase-email-triage');
    expect(r.path).toBe('/marketplace?item=agnt-usecase-email-triage');
  });

  it('opens the marketplace with no item at all', () => {
    expect(parseDeepLink('agnt://marketplace')).toMatchObject({ ok: true, path: '/marketplace' });
  });

  it('carries a referral token through', () => {
    // The sharing story: a creator posts their own agent and gets credited.
    const r = parseDeepLink('agnt://marketplace?item=my-agent&ref=nathan');
    expect(r.params).toEqual({ item: 'my-agent', ref: 'nathan' });
    expect(r.path).toBe('/marketplace?item=my-agent&ref=nathan');
  });

  it('drops a malformed ref rather than failing the whole link', () => {
    // Losing an attribution stat is cheap. Losing the click is not.
    const r = parseDeepLink('agnt://marketplace?item=my-agent&ref=' + encodeURIComponent('../../etc'));
    expect(r.ok).toBe(true);
    expect(r.params.item).toBe('my-agent');
    expect(r.params.ref).toBeUndefined();
  });
});

describe('shapes an OS actually delivers', () => {
  it('accepts the authority form and the opaque form identically', () => {
    // Windows hands over agnt://x, some launchers hand over agnt:x.
    expect(parseDeepLink('agnt://marketplace?item=a').path).toBe(parseDeepLink('agnt:marketplace?item=a').path);
  });

  it('is case-insensitive about the scheme and the verb', () => {
    // A URL lowercases a host but not a path, so agnt:Marketplace only works
    // if the verb is folded explicitly.
    for (const raw of ['AGNT://MARKETPLACE?item=a', 'Agnt://Marketplace?item=a', 'agnt:Marketplace?item=a']) {
      expect(parseDeepLink(raw), raw).toMatchObject({ ok: true, action: 'marketplace' });
    }
  });

  it('tolerates a trailing slash, which is what Windows actually sends', () => {
    // NOT hypothetical. Measured end to end through the Windows shell: a link
    // written `agnt://marketplace?item=x` is delivered to the app as
    // `agnt://marketplace/?item=x` — the OS normalises the URL and inserts a
    // slash after the authority. Every link would fail without this.
    expect(parseDeepLink('agnt://marketplace/?item=a')).toMatchObject({ ok: true, path: '/marketplace?item=a' });
    expect(parseDeepLink('agnt://marketplace/')).toMatchObject({ ok: true, path: '/marketplace' });
    expect(parseDeepLink('agnt://open/?screen=agents')).toMatchObject({ ok: true, path: '/agents' });
  });

  it('preserves the case of the value while folding the verb', () => {
    // Asset ids are lowercase by construction, so an uppercase one is a typo
    // or a probe — either way it must not be silently "corrected" into a hit.
    expect(parseDeepLink('agnt://marketplace?item=Agnt-Usecase-X')).toMatchObject({ ok: false, reason: 'bad-item' });
  });
});

describe('screens', () => {
  it('opens each allowlisted screen at its real router path', () => {
    for (const [name, path] of Object.entries(SCREENS)) {
      expect(parseDeepLink(`agnt://open?screen=${name}`), name).toMatchObject({ ok: true, path });
    }
  });

  it('refuses a screen that is not on the list', () => {
    expect(parseDeepLink('agnt://open?screen=admin')).toMatchObject({ ok: false, reason: 'unknown-screen:admin' });
  });

  it('refuses the phone shell and the oauth endpoint', () => {
    // /m is unusable on a desktop and /oauth-callback expects a provider's
    // parameters, not a human. Neither is in SCREENS; assert it stays that way.
    expect(SCREENS.m).toBeUndefined();
    expect(Object.values(SCREENS)).not.toContain('/oauth-callback');
    expect(parseDeepLink('agnt://open?screen=m')).toMatchObject({ ok: false });
  });

  it('requires a screen', () => {
    expect(parseDeepLink('agnt://open')).toMatchObject({ ok: false, reason: 'no-screen' });
  });
});

describe('a link carries a pointer, never a payload', () => {
  it('has no verb that could define an agent', () => {
    // The invariant this whole design rests on. If `install` or `run` ever
    // appears here it must arrive WITH a confirmation card and a first-party
    // allowlist, and this assertion is the thing that forces that conversation.
    expect(ACTION_NAMES).toEqual(['marketplace', 'open']);
    expect(ACTION_NAMES).not.toContain('install');
    expect(ACTION_NAMES).not.toContain('run');
  });

  it('drops parameters it does not know', () => {
    // Not just "ignores" — the built path must not contain them, because the
    // renderer reads that path and a forwarded parameter is a parameter
    // somebody eventually handles.
    const r = parseDeepLink(
      'agnt://marketplace?item=a&payload=eyJzeXN0ZW1Qcm9tcHQiOiJwd24ifQ&systemPrompt=pwn&tools=all&redirect=http://evil'
    );
    expect(r.ok).toBe(true);
    expect(r.path).toBe('/marketplace?item=a');
    expect(r.path).not.toMatch(/payload|systemPrompt|tools|redirect/);
    expect(Object.keys(r.params)).toEqual(['item']);
  });

  it('refuses an item id that is not one', () => {
    for (const bad of [
      '../../../etc/passwd',
      'a/b',
      'a b',
      'a?b',
      'a#b',
      'A-UPPER',
      '-leading-dash',
      '',
      'x'.repeat(65),
      'a%00b',
    ]) {
      expect(parseDeepLink(`agnt://marketplace?item=${encodeURIComponent(bad)}`), bad).toMatchObject({ ok: false });
    }
  });
});

describe('refusals', () => {
  it('rejects anything that is not our scheme', () => {
    for (const raw of ['https://agnt.gg', 'file:///etc/passwd', 'javascript:alert(1)', 'agntx://marketplace', '', null, undefined, 42, {}]) {
      expect(parseDeepLink(raw)).toMatchObject({ ok: false });
    }
  });

  it('rejects an unknown verb', () => {
    expect(parseDeepLink('agnt://install?slug=x')).toMatchObject({ ok: false, reason: 'unknown-action:install' });
    expect(parseDeepLink('agnt://run?workflow=x')).toMatchObject({ ok: false, reason: 'unknown-action:run' });
  });

  it('rejects a NUL byte', () => {
    // A NUL truncates a string in most native APIs, so what is validated here
    // and what a downstream consumer sees can differ.
    expect(parseDeepLink('agnt://marketplace?item=a\0evil')).toMatchObject({ ok: false, reason: 'contains-nul' });
  });

  it('rejects an oversized link before parsing it', () => {
    const r = parseDeepLink('agnt://marketplace?item=' + 'a'.repeat(4000));
    expect(r).toMatchObject({ ok: false, reason: 'too-long' });
  });

  it('never throws, whatever it is handed', () => {
    for (const raw of ['agnt://', 'agnt:', 'agnt://?', 'agnt://%', 'agnt://[', 'agnt://marketplace?item']) {
      expect(() => parseDeepLink(raw), raw).not.toThrow();
      expect(parseDeepLink(raw).ok === true || parseDeepLink(raw).ok === false).toBe(true);
    }
  });
});

describe('argv, which is where this arrives on Windows and Linux', () => {
  it('finds the link among Chromium switches and paths', () => {
    const argv = [
      'C:\\Program Files\\AGNT\\AGNT.exe',
      '--allow-file-access-from-files',
      'agnt://marketplace?item=agnt-usecase-code-review',
    ];
    expect(deepLinkFromArgv(argv)).toBe('agnt://marketplace?item=agnt-usecase-code-review');
  });

  it('takes the FIRST link and ignores any others', () => {
    // An appended second argument must not be able to override the one the
    // user clicked.
    expect(deepLinkFromArgv(['app.exe', 'agnt://marketplace?item=real', 'agnt://marketplace?item=injected'])).toBe(
      'agnt://marketplace?item=real'
    );
  });

  it('returns null when there is none, and never throws on junk', () => {
    expect(deepLinkFromArgv(['app.exe', '.'])).toBeNull();
    expect(deepLinkFromArgv([])).toBeNull();
    expect(deepLinkFromArgv(null)).toBeNull();
    expect(deepLinkFromArgv([undefined, 42, {}, null])).toBeNull();
  });
});

describe('looksLikeDeepLink', () => {
  it('is a cheap prefix test, not a validity test', () => {
    expect(looksLikeDeepLink('agnt://anything-at-all')).toBe(true);
    expect(looksLikeDeepLink('AGNT:x')).toBe(true);
    expect(looksLikeDeepLink('agnt-file:///C:/x.png')).toBe(false); // the OTHER scheme this app owns
    expect(looksLikeDeepLink('https://agnt.gg')).toBe(false);
    expect(looksLikeDeepLink(null)).toBe(false);
  });
});

describe('cold start', () => {
  it('builds an absolute URL for a window that does not exist yet', () => {
    const intent = parseDeepLink('agnt://marketplace?item=a');
    expect(intentToUrl('http://localhost:3333', intent)).toBe('http://localhost:3333/marketplace?item=a');
  });

  it('does not double the slash when the origin has a trailing one', () => {
    const intent = parseDeepLink('agnt://open?screen=agents');
    expect(intentToUrl('http://localhost:3333/', intent)).toBe('http://localhost:3333/agents');
  });
});
