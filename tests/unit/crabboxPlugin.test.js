import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCrabboxArgs,
  normalizeAllowEnv,
  parseCommandLine,
  parseCrabboxOutput,
} from '../../backend/plugins/dev/crabbox-plugin/crabbox-api.js';

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
      ttl: '120m',
      idleTimeout: '60m',
      command: 'npm run test:e2e',
      allowEnv: 'OPENAI_API_KEY,ANTHROPIC_API_KEY',
      preflight: true,
    });

    assert.deepEqual(args, [
      'run',
      '--provider',
      'aws',
      '--ttl',
      '120m',
      '--idle-timeout',
      '60m',
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

  it('requires a job name for job run', () => {
    assert.throws(() => buildCrabboxArgs({ action: 'JOB_RUN' }), /jobName is required/);
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
