/**
 * Every background call to api.agnt.gg carries a credential.
 *
 * WHY THIS IS A SOURCE SCAN
 * -------------------------
 * The property is "no call site was MISSED". A behavioural test proves the
 * calls it happens to exercise; it says nothing about the seventh one somebody
 * adds next month. Enumerating the call sites from the source is the only way
 * to assert completeness, so that is what this does — and the anti-vacuity test
 * at the bottom proves the scanner can still see a bare call.
 *
 * These are the exact calls that made the remote endpoints impossible to guard:
 * while they went out anonymously, the server had to serve anonymous callers,
 * which is why /auth/valid-token identified people by query parameter and why
 * /webhooks/register needed no token at all.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendSrc = path.resolve(here, '..', '..');

/** Files that talk to REMOTE_URL from a context with no request in scope. */
const CALLERS = [
  'tools/triggers/EmailReceiver.js',
  'tools/triggers/WebhookReceiver.js',
  'tools/library/actions/send-email.js',
  'services/auth/AuthManager.js',
];

/** Strip comments so documentation of the old shape cannot satisfy a check. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function read(rel) {
  return stripComments(fs.readFileSync(path.join(backendSrc, rel), 'utf8'));
}

/**
 * Find every axios call to the remote and report whether it passes a header
 * bag. Deliberately brace-counting rather than regexing the whole call: these
 * calls span multiple lines and a single-line regex would silently match none
 * of them and pass.
 */
function remoteCalls(source) {
  const calls = [];
  const re = /axios\.(get|post|put|delete)\s*\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (let i = end; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const text = source.slice(match.index, end + 1);
    // Only calls aimed at the remote API matter here.
    if (!/remoteUrl|REMOTE_URL/.test(text)) continue;
    calls.push(text);
  }
  return calls;
}

describe('background calls to api.agnt.gg identify themselves', () => {
  for (const rel of CALLERS) {
    it(`${rel}: every remote call passes an auth header`, () => {
      const source = read(rel);
      const calls = remoteCalls(source);

      expect(calls.length, `no remote axios calls found in ${rel} — the scanner is broken, not the file`).toBeGreaterThan(0);

      const bare = calls.filter((call) => !/authHeader\(\)|Authorization/.test(call));
      expect(
        bare,
        `${bare.length} remote call(s) in ${rel} go out with no credential:\n` +
          bare.map((c) => '  ' + c.replace(/\s+/g, ' ').slice(0, 160)).join('\n')
      ).toEqual([]);
    });
  }

  it('the orchestrator send_email tool authenticates too', () => {
    // fetch(), not axios, so it is checked separately rather than bent into the
    // scanner above.
    const source = read('services/orchestrator/tools.js');
    const index = source.indexOf('/email/send');
    expect(index, '/email/send call not found in tools.js').toBeGreaterThan(-1);
    const call = source.slice(index, index + 700);
    expect(call).toMatch(/Authorization|authHeader\(\)/);
  });

  it('every caller imports the token cache', () => {
    for (const rel of CALLERS) {
      expect(read(rel), `${rel} does not import the session token cache`).toMatch(/sessionTokenCache\.js/);
    }
  });

  it('anti-vacuity: the scanner flags a call with no header', () => {
    // If the brace matching or the filter ever broke, every test above would
    // pass against an empty list. Prove it still catches the shape it exists for.
    const sample = `
      const response = await axios.post(\`\${this.remoteUrl}/webhooks/register\`, {
        workflowId,
        authToken,
      });
    `;
    const found = remoteCalls(sample);
    expect(found).toHaveLength(1);
    expect(/authHeader\(\)|Authorization/.test(found[0])).toBe(false);
  });

  it('anti-vacuity: the scanner accepts a call WITH a header', () => {
    const sample = `
      const response = await axios.post(
        \`\${this.remoteUrl}/webhooks/register\`,
        { workflowId },
        { headers: authHeader() }
      );
    `;
    const found = remoteCalls(sample);
    expect(found).toHaveLength(1);
    expect(/authHeader\(\)/.test(found[0])).toBe(true);
  });
});
