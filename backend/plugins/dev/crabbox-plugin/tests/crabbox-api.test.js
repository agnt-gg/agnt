import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendBounded,
  buildChildEnv,
  buildCrabboxArgs,
  clampNumber,
  composeResult,
  normalizeAllowEnv,
  parseCommandLine,
  parseCrabboxOutput,
  resolveBinary,
  shouldStopLease,
} from '../crabbox-api.js';

describe('Crabbox plugin command parsing', () => {
  it('parses quoted argv commands without using a local shell', () => {
    assert.deepEqual(parseCommandLine('npm run "test:e2e" -- --project chromium'), [
      'npm',
      'run',
      'test:e2e',
      '--',
      '--project',
      'chromium',
    ]);
  });

  it('rejects unclosed quotes', () => {
    assert.throws(() => parseCommandLine('npm run "test:e2e'), /Unclosed/);
  });

  it('preserves Windows-style paths unless the backslash escapes syntax', () => {
    assert.deepEqual(parseCommandLine('node C:\\temp\\script.js "hello world"'), [
      'node',
      'C:\\temp\\script.js',
      'hello world',
    ]);
  });

  it('normalizes comma-separated env allowlists', () => {
    assert.deepEqual(normalizeAllowEnv(['OPENAI_API_KEY, ANTHROPIC_API_KEY', 'GITHUB_TOKEN']), [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GITHUB_TOKEN',
    ]);
  });
});

describe('Crabbox plugin arg builder', () => {
  it('builds a safe argv-style run command with timing JSON enabled by default', () => {
    const args = buildCrabboxArgs({
      action: 'RUN',
      provider: 'aws',
      ttl: '90m',
      idleTimeout: '30m',
      command: 'npm run test:e2e',
      allowEnv: 'OPENAI_API_KEY,ANTHROPIC_API_KEY',
      preflight: true,
    });

    assert.deepEqual(args, [
      'run',
      '--provider',
      'aws',
      '--ttl',
      '90m',
      '--idle-timeout',
      '30m',
      '--preflight',
      '--timing-json',
      '--allow-env',
      'OPENAI_API_KEY',
      '--allow-env',
      'ANTHROPIC_API_KEY',
      '--',
      'npm',
      'run',
      'test:e2e',
    ]);
  });

  it('accepts Yes/No select values for boolean toggles', () => {
    const args = buildCrabboxArgs({
      action: 'RUN',
      shell: 'Yes',
      preflight: 'No',
      timingJson: 'No',
      command: 'npm install && npm test',
    });

    assert.deepEqual(args, ['run', '--shell', '--', 'npm install && npm test']);
  });

  it('builds a shell run when explicitly requested', () => {
    const args = buildCrabboxArgs({
      action: 'RUN',
      shell: true,
      command: 'npm install && npm test',
      timingJson: false,
    });

    assert.deepEqual(args, ['run', '--shell', '--', 'npm install && npm test']);
  });

  it('keeps warmup flags scoped to lease creation', () => {
    const args = buildCrabboxArgs({
      action: 'WARMUP',
      provider: 'aws',
      className: 'beast',
      stopAfter: 'always',
      envFromProfile: '.env',
      noSync: true,
      keepOnFailure: true,
    });

    assert.deepEqual(args, ['warmup', '--provider', 'aws', '--class', 'beast', '--timing-json']);
  });

  it('builds Crabbox init with detected job generation', () => {
    const args = buildCrabboxArgs({
      action: 'INIT',
      detect: true,
      configPath: '.crabbox.yaml',
      workflowPath: '.github/workflows/crabbox.yml',
      skillPath: '.agents/skills/crabbox/SKILL.md',
    });

    assert.deepEqual(args, [
      'init',
      '--config',
      '.crabbox.yaml',
      '--workflow',
      '.github/workflows/crabbox.yml',
      '--skill',
      '.agents/skills/crabbox/SKILL.md',
      '--detect',
    ]);
  });

  it('builds Crabbox job run with dry-run and stop overrides', () => {
    const args = buildCrabboxArgs({
      action: 'JOB_RUN',
      jobName: 'detected',
      leaseId: 'swift-crab',
      dryRun: true,
      noHydrate: true,
      stop: 'never',
    });

    assert.deepEqual(args, ['job', 'run', '--id', 'swift-crab', '--no-hydrate', '--dry-run', '--stop', 'never', 'detected']);
  });

  it('applies advanced args to inspection-style commands', () => {
    const args = buildCrabboxArgs({
      action: 'SYNC_PLAN',
      extraArgs: '--limit 5',
    });

    assert.deepEqual(args, ['sync-plan', '--limit', '5']);
  });

  it('rejects extra args that try to own command separation', () => {
    assert.throws(
      () => buildCrabboxArgs({ action: 'RUN', command: 'npm test', extraArgs: '-- --whoops' }),
      /extraArgs must not include --/
    );
  });

  it('requires a lease id for stop', () => {
    assert.throws(() => buildCrabboxArgs({ action: 'STOP' }), /leaseId is required/);
  });

  it('rejects positional values that would be parsed as flags', () => {
    assert.throws(() => buildCrabboxArgs({ action: 'STOP', leaseId: '--all' }), /unsupported characters/);
    assert.throws(() => buildCrabboxArgs({ action: 'JOB_RUN', jobName: '../danger' }), /unsupported characters/);
  });

  it('requires a job name for job run', () => {
    assert.throws(() => buildCrabboxArgs({ action: 'JOB_RUN' }), /jobName is required/);
  });
});

describe('Crabbox plugin child environment', () => {
  it('never passes server secrets to the CLI', () => {
    const env = buildChildEnv('tok_123', {
      PATH: '/usr/bin',
      HOME: '/home/agnt',
      OPENAI_API_KEY: 'sk-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      CRABBOX_BIN: '/opt/crabbox',
      CRABBOX_DEBUG: '1',
      CRABBOX_TOKEN: 'ambient-token',
    });

    assert.deepEqual(env, {
      PATH: '/usr/bin',
      HOME: '/home/agnt',
      CRABBOX_BIN: '/opt/crabbox',
      CRABBOX_DEBUG: '1',
      CRABBOX_TOKEN: 'tok_123',
    });
  });

  it('omits the token entry when no credential is supplied', () => {
    const env = buildChildEnv(null, { PATH: '/usr/bin' });
    assert.deepEqual(env, { PATH: '/usr/bin' });
  });
});

describe('Crabbox plugin binary and limits', () => {
  it('resolves CRABBOX_BIN to an absolute executable path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crabbox-plugin-'));
    try {
      const binary = path.join(tmp, process.platform === 'win32' ? 'crabbox.exe' : 'crabbox');
      fs.writeFileSync(binary, '');
      if (process.platform !== 'win32') fs.chmodSync(binary, 0o755);

      assert.equal(resolveBinary({ CRABBOX_BIN: binary }, process.platform), binary);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects missing CRABBOX_BIN paths before spawn', () => {
    assert.throws(() => resolveBinary({ CRABBOX_BIN: '/no/such/crabbox' }), /missing file/);
  });

  it('clamps local timeout and output limits to bounded values', () => {
    assert.equal(clampNumber(undefined, 900000, 1000, 3600000), 900000);
    assert.equal(clampNumber(10, 900000, 1000, 3600000), 1000);
    assert.equal(clampNumber(7200000, 900000, 1000, 3600000), 3600000);
  });

  it('truncates retained output without splitting a UTF-8 character', () => {
    const smile = Buffer.from([0xf0, 0x9f, 0x99, 0x82]).toString('utf8');
    const bounded = appendBounded('', `${'x'.repeat(40)}${smile}`, 30);
    assert.match(bounded, /^\n\[agnt: output truncated\]\n/);
    assert.ok(!bounded.includes('\uFFFD'));
    assert.ok(bounded.endsWith(smile));
  });
});

describe('Crabbox plugin output parser', () => {
  it('extracts final timing JSON proof fields', () => {
    const output = [
      'running remote command',
      '{"provider":"aws","leaseId":"cbx_123","runId":"run_456","slug":"swift-crab","exitCode":0,"totalMs":42,"stopCommand":"crabbox stop cbx_123"}',
    ].join('\n');

    assert.deepEqual(parseCrabboxOutput(output, ''), {
      timing: {
        provider: 'aws',
        leaseId: 'cbx_123',
        runId: 'run_456',
        slug: 'swift-crab',
        exitCode: 0,
        totalMs: 42,
        stopCommand: 'crabbox stop cbx_123',
      },
      provider: 'aws',
      leaseId: 'cbx_123',
      runId: 'run_456',
      slug: 'swift-crab',
      stopCommand: 'crabbox stop cbx_123',
      exitCode: 0,
    });
  });

  it('falls back to textual provider and lease fields', () => {
    const parsed = parseCrabboxOutput('provider=blacksmith-testbox leaseId=tbx_abc', 'crabbox stop tbx_abc');

    assert.equal(parsed.provider, 'blacksmith-testbox');
    assert.equal(parsed.leaseId, 'tbx_abc');
    assert.equal(parsed.stopCommand, 'crabbox stop tbx_abc');
  });
});

describe('Crabbox plugin lease cleanup decisions', () => {
  it('stops failed one-shot run leases acquired by this node', () => {
    assert.deepEqual(
      shouldStopLease({
        action: 'RUN',
        failed: true,
        leaseId: 'cbx_123',
      }),
      { stop: true, reason: null }
    );
  });

  it('also stops failed warmup leases unless explicitly kept', () => {
    assert.deepEqual(
      shouldStopLease({
        action: 'WARMUP',
        failed: true,
        leaseId: 'cbx_warm',
      }),
      { stop: true, reason: null }
    );
  });

  it('leaves caller-supplied and explicitly kept leases running', () => {
    assert.deepEqual(
      shouldStopLease({
        action: 'RUN',
        failed: true,
        callerLeaseId: 'existing-lease',
        leaseId: 'cbx_123',
      }),
      { stop: false, reason: 'caller-supplied lease existing-lease left running' }
    );

    assert.deepEqual(
      shouldStopLease({
        action: 'RUN',
        failed: true,
        keepOnFailure: 'Yes',
        leaseId: 'cbx_123',
      }),
      { stop: false, reason: 'lease cbx_123 kept on request' }
    );
  });

  it('does not let remote timing JSON hide the local CLI exit code', () => {
    const result = composeResult({
      action: 'RUN',
      args: ['run'],
      cwd: '/repo',
      stdout: '',
      stderr: '',
      exitCode: 9,
      signal: null,
      timedOut: false,
      leaseCleanup: null,
      parsed: { exitCode: 0, leaseId: 'cbx_123' },
    });

    assert.equal(result.exitCode, 9);
    assert.equal(result.remoteExitCode, 0);
  });
});
