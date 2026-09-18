/**
 * Path canonicalisation for the Jev policy engine.
 *
 * Split out of a module that also held the metamorphic test fixtures. Only
 * these two predicates are reachable from production code (assess.js and
 * secretScan.js); everything else in that file — the prompt matrix, the
 * spelling groups, the drift summaries — is test scaffolding and stays with
 * the tests.
 *
 * Neither function reads a file. They answer "what is this token, and what is
 * its canonical spelling", nothing more.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Tokens that contain "/" but are NOT filesystem paths.
 *
 * Without this, canonicalisation rewrote `https://api.example.test/v1` into
 * `<projectDir>/https:/api.example.test/v1` — the `//` collapse plus the
 * relative-path resolve. Jev was then asked whether a LOCAL FILE exfiltrates
 * data, with the remote host no longer recognisable as a host. That silently
 * weakened the exfil question this gate depends on.
 */
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i; //        https://, file://, s3://
const SCP_LIKE = /^[^/\s]+@[^/\s]+:/; //               git@github.com:owner/repo
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?![\\/])/i; // mailto:, data:, redis:

/** `API=https://host/x` — the URL hides behind an assignment prefix. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function isNonPathToken(token) {
  const t = String(token || '');
  if (!t) return true;
  // A scheme separator ANYWHERE means this token carries a URL. Checking only
  // position 0 missed `API=http://127.0.0.1:3333/api`, which canonicalised to
  // `<projectDir>/API=http:/127.0.0.1:3333/api` — same corruption, one prefix
  // away from the case already fixed.
  if (t.includes('://')) return true;
  if (ASSIGNMENT.test(t)) {
    const value = t.slice(t.indexOf('=') + 1);
    // An assignment whose value is not itself a path is not a path.
    if (!value || URL_LIKE.test(value) || SCP_LIKE.test(value) || OTHER_SCHEME.test(value)) return true;
  }
  return URL_LIKE.test(t) || SCP_LIKE.test(t) || OTHER_SCHEME.test(t);
}

/**
 * Collapse equivalent spellings of one file to a single absolute path.
 * Handles `~`, `$HOME`, `//`, `/./` and `..`. Does not read the file.
 *
 * `projectDir` defaults to the process working directory, which is the natural
 * referent for a relative path in a shell command. It previously defaulted to
 * the module's OWN directory — meaningful where this code used to live, since
 * the fixtures sat beside it, and meaningless here: no user file is ever
 * relative to backend/src/services/security/jev/. Callers that know better
 * (assess.canonicalizeArgs reads the call's own cwd) still pass it explicitly.
 */
export function canonicalPath(filePath, { home = homedir(), projectDir = process.cwd() } = {}) {
  let s = String(filePath || '').trim();
  if (!s) return '';
  if (s.startsWith('~/')) s = `${home}${s.slice(1)}`;
  else if (s === '~') s = home;
  if (s.startsWith('$HOME/')) s = `${home}${s.slice(5)}`;
  else if (s === '$HOME') s = home;
  if (!s.startsWith('/')) s = resolve(projectDir, s);
  s = s.replace(/\/+/g, '/');
  const parts = [];
  for (const part of s.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join('/')}`;
}
