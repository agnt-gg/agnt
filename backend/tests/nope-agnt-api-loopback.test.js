/**
 * Strict mode must not stop AGNT from calling its own API.
 *
 * THE INCIDENT THIS ENCODES
 * -------------------------
 * On a cloud instance whose owner chose Strict, every attempt by Annie to
 * install a marketplace plugin through the documented
 * `fetch('http://localhost:3333/api/...')` pattern was refused as
 * `net-ssrf-localhost`. Loopback on the AGNT port IS the AGNT API (and inside
 * the hosted tool sandbox loopback reaches nothing else), so that finding is
 * dropped there, and only there.
 *
 * The tests that matter most prove the exemption is not a bypass: any other
 * loopback port, a bare `localhost`, and a call mixing the API with another
 * loopback target are all still blocked under Strict.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import './nope-test-environment.js';

const USER = 'strict-agnt-api-user';
let checkAction;
let targetsOnlyAgntApi;

beforeAll(async () => {
  ({ checkAction, targetsOnlyAgntApi } = await import('../src/services/security/nopeService.js'));
  const { default: SecurityPolicyService } = await import('../src/services/security/SecurityPolicyService.js');
  const { normalizeSecurityPolicy } = await import('../src/services/security/securityPolicy.js');
  // The exact policy row stored on the bravo instance where this was reported.
  const bravoStrict = { version: 1, mode: 'strict', severityDecisions: { critical: 'block', high: 'block', medium: 'audit', low: 'audit' }, categoryOverrides: {}, ruleOverrides: {}, outputScanning: 'report' };
  vi.spyOn(SecurityPolicyService, 'getEffectivePolicy').mockResolvedValue({ policy: normalizeSecurityPolicy(bravoStrict), revision: 1, scope: 'account' });
});

const gate = (toolName, args) => checkAction({ toolName, args, userId: USER, role: 'user', surface: 'orchestrator' });
const INSTALL = `const r = await fetch('http://localhost:3333/api/plugins/install', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.AGNT_AUTH_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'dice-roller-plugin' }) }); console.log(r.status);`;

describe('Strict policy and the AGNT API on loopback', () => {
  it('ALLOWS code installing a marketplace plugin through the AGNT API', async () => {
    const r = await gate('execute_javascript_code', { code: INSTALL });
    expect(r.violations.map((v) => v.rule)).not.toContain('net-ssrf-localhost');
    expect(r.allowed).toBe(true);
  });

  it('ALLOWS a shell call to the API on 127.0.0.1', async () => {
    const r = await gate('execute_shell_command', { command: 'curl -s -H "Authorization: Bearer $AGNT_AUTH_TOKEN" http://127.0.0.1:3333/api/plugins/marketplace' });
    expect(r.blockedRules).not.toContain('net-ssrf-localhost');
  });

  it('still BLOCKS another loopback port', async () => {
    const r = await gate('execute_javascript_code', { code: "await fetch('http://localhost:8080/admin')" });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('net-ssrf-localhost');
  });

  it('still BLOCKS a call that mixes the API with another loopback target', async () => {
    const r = await gate('execute_javascript_code', { code: "await fetch('http://localhost:3333/api/health'); await fetch('http://127.0.0.1:6379/')" });
    expect(r.blockedRules).toContain('net-ssrf-localhost');
  });

  it('the matcher refuses a bare host, a look-alike port and finds no API in plain text', () => {
    expect(targetsOnlyAgntApi({ command: 'curl http://localhost/' })).toBe(false);
    expect(targetsOnlyAgntApi({ code: "fetch('http://localhost:33330/api')" })).toBe(false);
    expect(targetsOnlyAgntApi({ code: 'console.log(1)' })).toBe(false);
    expect(targetsOnlyAgntApi({ code: "fetch('http://[::1]:3333/api/agents')" })).toBe(true);
  });
});
