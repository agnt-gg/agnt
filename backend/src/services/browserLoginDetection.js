/**
 * Recognise a page that needs the PERSON, not the agent: a sign-in form, an
 * identity provider refusing the automated browser, or an app asking to be
 * granted access to the person's account.
 *
 * WHY: a login wall used to come back as an ordinary page. The agent filled
 * what it could, then asked the user — in prose — to "type your password in
 * the Chrome window". There was no window: the browser is headless. Trace
 * 64eeeb9c (2026-10-28) reached Google's password page ("Hi Nathan",
 * /v3/signin/challenge/pwd) and ended with exactly that instruction, and the
 * user spent three turns looking for a window that did not exist.
 *
 * A named sign-in wall turns that into one move: the agent calls
 * browser action="signin", which brings the page to the person (browserSignIn.js).
 *
 * Sibling of browserBlockDetection.js, and deliberately separate from it: a
 * bot wall means "stop, this site will not serve you"; a login wall means
 * "hand this to the person, then carry on". Conflating them would teach the
 * agent to abandon every site that merely wants a login.
 *
 * FALSE POSITIVES COST NOISE, FALSE NEGATIVES COST THE OLD FAILURE. Every rule
 * needs a strong signal: a known identity provider's sign-in path, or a
 * visible password / one-time-code field on a page that says it is a sign-in.
 * A signup form (two password fields, or a "sign up" title) is not a login wall.
 */

/** Text read from the page; enough for every phrase below, short enough to be cheap. */
const PROBE_TEXT_CHARS = 2000;

/**
 * Identity providers. `window: true` marks the ones that refuse sign-in inside
 * a browser started for automation (--remote-debugging-port), even a visible
 * one, so a sign-in there must use a plain window on the same profile.
 * MEASURED for Google (Hermes #96993, latchkey docs, and this repo's trace
 * 5522237d reaching "Verify it's you" with no way through). Microsoft and Apple
 * run the same class of browser-integrity checks, so they take the safe path.
 */
const IDENTITY_PROVIDERS = [
  { provider: 'Google', host: /^accounts\.google\.com$/i, window: true },
  { provider: 'Microsoft', host: /^(login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|account\.live\.com)$/i, window: true },
  { provider: 'Apple', host: /^(appleid\.apple\.com|idmsa\.apple\.com|account\.apple\.com)$/i, window: true },
  { provider: 'GitHub', host: /^github\.com$/i, path: /^\/(login|session|sessions\/two-factor)/i },
  { provider: 'Facebook', host: /^(www\.|m\.)?facebook\.com$/i, path: /^\/(login|dialog\/oauth)/i },
  { provider: 'X', host: /^(www\.)?(x|twitter)\.com$/i, path: /^\/(i\/flow\/login|login)/i },
  { provider: 'LinkedIn', host: /^(www\.)?linkedin\.com$/i, path: /^\/(login|checkpoint|uas\/login)/i },
  { provider: 'Amazon', host: /^(www\.)?amazon\.[a-z.]+$/i, path: /^\/ap\/(signin|mfa|cvf)/i },
];

/** An identity provider refusing the automated browser. Fixed strings on the providers' own pages. */
const REJECTED_BROWSER = /this browser or app may not be secure|couldn[’']t sign you in[\s\S]{0,80}browser/i;

/** An app asking to be granted access to the person's account. */
const CONSENT_TEXT = /wants (?:additional )?access to your (?:google )?account|wants to access your (?:google |microsoft )?account|permissions requested|is requesting access to your/i;

/** Pages on a provider host that are NOT a sign-in step. */
const GOOGLE_NOT_SIGN_IN = /^\/(signin\/oauth\/consent|o\/oauth2\/.*consent)/i;
const GOOGLE_SIGN_IN_PATH = /^\/(v3\/)?signin|^\/ServiceLogin|^\/InteractiveLogin|\/challenge\//i;

/** A page that says it is a sign-in, read from its title and the top of its text. */
const SIGN_IN_WORDS = /\b(sign[\s-]?in|log[\s-]?in|enter your password|verify it[’']s you|2-step verification|two-factor|verification code)\b/i;
const SIGN_UP_TITLE = /\b(sign[\s-]?up|register|create (?:an |your )?account|join)\b/i;

/**
 * In-page probe, evaluated with Runtime.evaluate (no Runtime.enable needed).
 * Returns a JSON string so the result survives returnByValue unchanged.
 * Field VALUES are never read — only whether visible fields exist.
 */
export const LOGIN_PROBE_EXPRESSION = `(() => {
  const visible = (el) => {
    if (!el || el.disabled) return false;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  const count = (selector) => [...document.querySelectorAll(selector)].filter(visible).length;
  const text = (document.body && document.body.innerText) || '';
  return JSON.stringify({
    probe: 'agnt-login-probe',
    host: location.hostname,
    path: location.pathname,
    title: document.title || '',
    text: text.slice(0, ${PROBE_TEXT_CHARS}),
    passwordFields: count('input[type="password"]'),
    identifierFields: count('input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[name="identifier"], input[name="username"], input[name="login"], input[name="email"]'),
    oneTimeCodeFields: count('input[autocomplete="one-time-code"]'),
  });
})()`;

function identityProviderFor(host, path) {
  for (const entry of IDENTITY_PROVIDERS) {
    if (!entry.host.test(host)) continue;
    if (entry.path && !entry.path.test(path)) continue;
    return entry;
  }
  return null;
}

/** The provider an identity host belongs to, ignoring path. Used to pick the sign-in surface. */
export function identityProviderForHost(host) {
  const value = String(host || '').toLowerCase();
  return IDENTITY_PROVIDERS.find((entry) => entry.host.test(value)) || null;
}

/** Strip the 🐴 marker browser-harness prepends to the tab it drives. */
function cleanTitle(title) {
  return String(title || '').replace(/^\u{1F434}\s*/u, '').trim();
}

/**
 * @param {{ host?: string, path?: string, title?: string, text?: string,
 *           passwordFields?: number, identifierFields?: number, oneTimeCodeFields?: number }} probe
 * @returns {{ kind: 'sign-in'|'rejected-browser'|'consent', provider: string, host: string,
 *             evidence: string, window: boolean } | null}
 */
export function classifyLoginPage(probe) {
  if (!probe || typeof probe !== 'object') return null;
  const host = String(probe.host || '').toLowerCase();
  const path = String(probe.path || '/');
  const title = cleanTitle(probe.title);
  const text = String(probe.text || '');
  const passwords = Number(probe.passwordFields) || 0;
  const identifiers = Number(probe.identifierFields) || 0;
  const oneTimeCodes = Number(probe.oneTimeCodeFields) || 0;
  const idp = identityProviderFor(host, path);
  const anyIdp = identityProviderForHost(host);
  const head = `${title}\n${text.slice(0, 600)}`;

  // 1. The provider refused this browser. Only the person, in a plain window, gets past it.
  const refused = REJECTED_BROWSER.exec(text);
  if (refused && anyIdp) {
    return { kind: 'rejected-browser', provider: anyIdp.provider, host, evidence: `page says "${refused[0]}"`, window: true };
  }

  // 2. Granting an app access to the account is the person's decision, never the agent's.
  const consent = anyIdp ? CONSENT_TEXT.exec(text) : null;
  if (consent || (anyIdp?.provider === 'Google' && GOOGLE_NOT_SIGN_IN.test(path))) {
    return {
      kind: 'consent',
      provider: anyIdp.provider,
      host,
      evidence: consent ? `page says "${consent[0]}"` : `consent page ${path}`,
      window: false,
    };
  }

  // 3. An identity provider's sign-in step.
  if (idp) {
    if (idp.provider === 'Google') {
      // The account chooser is not a wall: the agent picks the listed account,
      // and Google only then asks for a password if the session has lapsed.
      const chooser = /accountchooser|SignOutOptions/i.test(path) && passwords === 0;
      if (!chooser && (GOOGLE_SIGN_IN_PATH.test(path) || passwords > 0)) {
        return { kind: 'sign-in', provider: 'Google', host, evidence: title ? `Google sign-in page "${title}"` : `Google sign-in ${path}`, window: true };
      }
      return null;
    }
    if (passwords > 0 || identifiers > 0 || oneTimeCodes > 0 || SIGN_IN_WORDS.test(head)) {
      return { kind: 'sign-in', provider: idp.provider, host, evidence: `${idp.provider} sign-in page ${path}`, window: Boolean(idp.window) };
    }
    return null;
  }

  // 4. Any site's own login form. A signup form is not a login wall.
  if (passwords >= 2 || SIGN_UP_TITLE.test(title)) return null;
  const saysSignIn = SIGN_IN_WORDS.test(head);
  if (passwords === 1 && (identifiers >= 1 || saysSignIn)) {
    return { kind: 'sign-in', provider: host, host, evidence: 'a password field on a sign-in page', window: false };
  }
  // Identifier-first logins ("Enter your email" → Next → password) and 2FA steps.
  if (passwords === 0 && (identifiers >= 1 || oneTimeCodes >= 1) && SIGN_IN_WORDS.test(title)) {
    return { kind: 'sign-in', provider: host, host, evidence: `page title "${title.slice(0, 80)}"`, window: false };
  }
  return null;
}

/** What the agent is told when a page needs the person. */
export function signInHint(login) {
  if (login.kind === 'consent') {
    return `${login.provider} is asking the user to grant an app access to their account. `
      + 'Ask the user to confirm before you approve it, and say which app and which account.';
  }
  if (login.kind === 'rejected-browser') {
    return `${login.provider} refused to sign in inside the automated browser. `
      + 'Call browser action="signin" with mode="window": it opens a normal browser window on the same profile for the user.';
  }
  return `This page needs the user to sign in (${login.provider}). Call browser action="signin" — it shows the user `
    + 'the page and waits while they sign in. Never ask for or type their password, and never tell them to sign in '
    + 'somewhere without calling it.';
}
