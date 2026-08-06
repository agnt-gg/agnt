/**
 * Capability scoping — the gate must distinguish DOING from DESCRIBING.
 *
 * THE INCIDENT THIS ENCODES
 * -------------------------
 * A single critical rule (`sys-shutdown`, account policy, balanced mode)
 * blocked four calls. One correctly: a shell command that really would have
 * restarted the machine. Three were false positives that only *mentioned* it:
 *   - a memory note describing the restart
 *   - a read-only grep for the literal rule id `sys-shutdown`
 *   - a runbook file write
 *
 * The rule matched raw arguments of every tool with no notion of which tools
 * can execute anything, and it was broad enough to match its own name — so
 * the audit log recording the block could not itself be searched. A security
 * system whose telemetry is unsearchable cannot be tuned.
 *
 * WHAT THIS FILE GUARDS
 * ---------------------
 * Scoping is a real reduction in what gets inspected, so the tests that
 * matter most are the ones proving it did NOT become a bypass:
 *   - the genuinely dangerous call is still blocked
 *   - a capability-dynamic tool (file_operations) is blocked only on execute
 *   - credential/DLP rules are never scoped and still fire on pure data
 *   - unregistered tools fall back to scanning everything (fail closed)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import './nope-test-environment.js';

let checkAction;
let buildSecurityAction;
let resolveToolCapabilities;

beforeAll(async () => {
  ({ checkAction } = await import('../src/services/security/nopeService.js'));
  ({ buildSecurityAction, resolveToolCapabilities } = await import('../src/services/security/toolCapabilities.js'));
});

const gate = (toolName, args) =>
  checkAction({ toolName, args, userId: 'cap-test-user', role: 'user', surface: 'orchestrator' });

// Assembled so this test file does not itself contain a runnable destructive
// line, and so a naive scan of the repo does not flag the test as the threat.
const RESTART = String.fromCharCode(114, 101, 98, 111, 111, 116);
const RM = String.fromCharCode(114, 109);

describe('the reported incident — one block, three false positives', () => {
  it('BLOCKS the shell command that actually restarts the machine', async () => {
    const r = await gate('execute_shell_command', { command: `sudo ${RESTART}` });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('sys-shutdown');
  });

  it('ALLOWS a memory note that merely describes the restart', async () => {
    const r = await gate('save_agent_memory', {
      memory_type: 'context',
      content: `Backend restart required; a full ${RESTART} of the host is not.`,
    });
    expect(r.allowed).toBe(true);
    expect(r.violations.map((v) => v.rule)).not.toContain('sys-shutdown');
  });

  it("ALLOWS a read-only search for the blocking rule's own id", async () => {
    const r = await gate('grep_files', { pattern: 'sys-shutdown', path: 'backend/src' });
    expect(r.allowed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('ALLOWS a runbook file write that documents the restart', async () => {
    const r = await gate('write_file', {
      path: 'docs/runbook.md',
      content: `# Runbook\n1. Drain traffic.\n2. ${RESTART} the host.\n3. Verify.\n`,
    });
    expect(r.allowed).toBe(true);
    expect(r.violations.map((v) => v.rule)).not.toContain('sys-shutdown');
  });

  // Isolates the read-only capability declaration specifically: unlike the
  // hyphenated rule id above, a bare word sits in command position, so the
  // regex anchor cannot save it. Only "grep cannot execute" can. Searching
  // for this exact word is what triaging the incident required.
  it('ALLOWS searching for a bare dangerous word', async () => {
    const r = await gate('grep_files', { pattern: 'shutdown', path: 'backend/src' });
    expect(r.allowed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('ALLOWS reading the audit log that records every rule id', async () => {
    const r = await gate('read_file', { path: 'security-audit.jsonl' });
    expect(r.allowed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
});

describe('scoping did not become a bypass — action rules', () => {
  it('still BLOCKS a recursive force delete through the shell', async () => {
    const r = await gate('execute_shell_command', { command: `${RM} -rf /home/user` });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('fs-rm-rf');
  });

  it('still BLOCKS a metadata-endpoint SSRF in evaluated code', async () => {
    const r = await gate('execute_javascript_code', {
      code: "await fetch('http://169.254.169.254/latest/meta-data/')",
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('net-ssrf-metadata');
  });

  it('still BLOCKS a Windows restart flag', async () => {
    const r = await gate('execute_shell_command', { command: 'shutdown /r /t 0' });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('sys-shutdown');
  });

  it('still BLOCKS a restart chained after a benign build', async () => {
    const r = await gate('execute_shell_command', { command: `npm run build && ${RESTART}` });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('sys-shutdown');
  });
});

describe('capability-dynamic tools resolve per call', () => {
  it('file_operations copy declares no shell', () => {
    const profile = resolveToolCapabilities('file_operations', { operation: 'copy' });
    expect(profile.capabilities).toEqual(['fs-write']);
  });

  it('file_operations execute declares a shell', () => {
    const profile = resolveToolCapabilities('file_operations', { operation: 'execute' });
    expect(profile.capabilities).toContain('shell');
  });

  it('ALLOWS copying a script — writing is not running', async () => {
    const r = await gate('file_operations', {
      operation: 'copy',
      path: 'scripts/deploy.sh',
      destination: 'backup/deploy.sh',
    });
    expect(r.allowed).toBe(true);
  });

  it('BLOCKS executing an argv vector no single element of which is dangerous', async () => {
    const r = await gate('file_operations', {
      operation: 'execute',
      path: RM,
      args: ['-rf', '/home/user'],
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('fs-rm-rf');
  });
});

describe('scoping did not become a bypass — data rules stay global', () => {
  const FAKE_AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const FAKE_STRIPE = 'sk_live_' + 'abcdefghijklmnopqrstuvwx';

  it('a cloud key written to a file is still caught', async () => {
    const r = await gate('write_file', { path: 'cfg.js', content: `const k = "${FAKE_AWS}";` });
    expect(r.violations.map((v) => v.rule)).toContain('cred-aws-key');
  });

  it('a payment key in a memory note is still caught', async () => {
    const r = await gate('save_agent_memory', { content: `key ${FAKE_STRIPE}` });
    expect(r.violations.map((v) => v.rule)).toContain('cred-stripe-key');
  });

  it('private key material in an email body is still caught', async () => {
    const r = await gate('send_email', {
      to: 'x@example.invalid',
      subject: 'k',
      body: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
    });
    expect(r.violations.map((v) => v.rule)).toContain('cred-private-key-pem');
  });
});

describe('unregistered tools fail closed', () => {
  it('declares no capabilities, so every rule still runs', () => {
    const action = buildSecurityAction('some_brand_new_plugin_tool', { anything: 'x' });
    expect(action.capabilities).toBeUndefined();
    expect(action.sink).toBeUndefined();
  });

  it('an unknown tool carrying a dangerous command is still blocked', async () => {
    const r = await gate('some_brand_new_plugin_tool', { payload: `sudo ${RESTART}` });
    expect(r.allowed).toBe(false);
    expect(r.blockedRules).toContain('sys-shutdown');
  });
});

describe('sink selection', () => {
  it('passes only sink fields, never content', () => {
    const action = buildSecurityAction('write_file', { path: 'a.md', content: 'anything at all' });
    expect(action.sink).toEqual({ path: 'a.md' });
    expect(action.params.content).toBe('anything at all');
  });

  it('does not promote a non-sink field named code into an executable position', () => {
    const action = buildSecurityAction('save_agent_memory', { code: 'process.exit(1)' });
    expect(action.code).toBeUndefined();
  });

  it('reconstructs a command line from an argv vector', () => {
    const action = buildSecurityAction('file_operations', {
      operation: 'execute',
      path: 'tool.sh',
      args: ['--force', '/'],
    });
    expect(action.command).toBe('tool.sh --force /');
  });
});

describe('violations name the argument that matched', () => {
  it('reports the field path for a blocked command', async () => {
    const r = await gate('execute_shell_command', { command: `sudo ${RESTART}` });
    const hit = r.violations.find((v) => v.rule === 'sys-shutdown');
    expect(hit.field).toBe('command');
  });

  it('never echoes secret material into the violation', async () => {
    const FAKE_AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    const r = await gate('write_file', { path: 'cfg.js', content: `const k = "${FAKE_AWS}";` });
    const hit = r.violations.find((v) => v.rule === 'cred-aws-key');
    expect(hit.snippet).toBeUndefined();
    expect(JSON.stringify(r.violations)).not.toContain(FAKE_AWS);
  });
});
