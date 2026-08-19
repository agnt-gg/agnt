/**
 * Node identity — the guards that matter are about the DEFAULT.
 *
 * Every AGNT install in the field is a single node, and this module is
 * imported into that install's boot path. So the interesting assertions are
 * not "a worker is a worker" but "everything that is not exactly the string
 * `worker` is still a primary" — a typo, an empty string, a half-written
 * compose file. The unsafe role is the one that must be spelled correctly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NODE_ROLES,
  NODE_ROLE_ENV,
  NODE_LABEL_ENV,
  describeNode,
  getNodeId,
  getNodeLabel,
  getNodeRole,
  isPrimary,
  isWorker,
  __resetRoleWarningForTests,
} from './nodeIdentity.js';
import { __resetSecretCacheForTests, secretFilePath } from '../../utils/secretResolver.js';

const ORIGINAL = { role: process.env[NODE_ROLE_ENV], label: process.env[NODE_LABEL_ENV], id: process.env.NODE_ID };

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  delete process.env[NODE_ROLE_ENV];
  delete process.env[NODE_LABEL_ENV];
  __resetRoleWarningForTests();
  __resetSecretCacheForTests();
});

afterEach(() => {
  restore(NODE_ROLE_ENV, ORIGINAL.role);
  restore(NODE_LABEL_ENV, ORIGINAL.label);
  restore('NODE_ID', ORIGINAL.id);
  __resetSecretCacheForTests();
  vi.restoreAllMocks();
});

describe('getNodeRole — the default is the whole safety property', () => {
  it('is primary when nothing is configured', () => {
    expect(getNodeRole()).toBe(NODE_ROLES.PRIMARY);
    expect(isPrimary()).toBe(true);
    expect(isWorker()).toBe(false);
  });

  it('is primary for an empty or whitespace value', () => {
    for (const blank of ['', '   ', '\t']) {
      process.env[NODE_ROLE_ENV] = blank;
      expect(getNodeRole()).toBe(NODE_ROLES.PRIMARY);
    }
  });

  it.each(['wroker', 'workers', 'Worker ', 'primary-node', 'true', '1', 'null'])(
    'falls back to primary for the unrecognised value %j rather than guessing',
    (value) => {
      process.env[NODE_ROLE_ENV] = value;
      // 'Worker ' is trimmed+lowercased to 'worker' by design; assert the rest.
      const expected = value.trim().toLowerCase() === 'worker' ? NODE_ROLES.WORKER : NODE_ROLES.PRIMARY;
      expect(getNodeRole()).toBe(expected);
    }
  );

  it('is a worker only for an exact (case-insensitive, trimmed) match', () => {
    for (const spelling of ['worker', 'WORKER', '  Worker  ']) {
      process.env[NODE_ROLE_ENV] = spelling;
      expect(getNodeRole()).toBe(NODE_ROLES.WORKER);
      expect(isWorker()).toBe(true);
      expect(isPrimary()).toBe(false);
    }
  });

  it('warns once per process about an unrecognised role, not once per call', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[NODE_ROLE_ENV] = 'wroker';

    for (let i = 0; i < 25; i++) getNodeRole();

    // getNodeRole() is called on every claim attempt. An unlatched warning
    // here is a log flood that buries the message it is trying to deliver.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('wroker');
  });
});

describe('getNodeId', () => {
  it('honours an operator-supplied NODE_ID', () => {
    process.env.NODE_ID = 'hetzner-fsn1-a';
    expect(getNodeId()).toBe('hetzner-fsn1-a');
  });

  it('generates a stable 128-bit hex id and reuses it', () => {
    delete process.env.NODE_ID;
    const first = getNodeId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    // Same process: memoised.
    expect(getNodeId()).toBe(first);
    // Cache dropped: must come back from the keyfile, not be regenerated.
    __resetSecretCacheForTests();
    expect(getNodeId()).toBe(first);
  });

  it('persists to the isolated data dir, never to a real one', () => {
    delete process.env.NODE_ID;
    getNodeId();
    expect(secretFilePath('NODE_ID')).toContain(process.env.__AGNT_TEST_DATA_DIR);
  });
});

describe('getNodeLabel', () => {
  it('prefers the configured label', () => {
    process.env[NODE_LABEL_ENV] = 'do-nyc3-worker-2';
    expect(getNodeLabel()).toBe('do-nyc3-worker-2');
  });

  it('falls back to the hostname, and is never empty', () => {
    delete process.env[NODE_LABEL_ENV];
    expect(getNodeLabel().length).toBeGreaterThan(0);
  });
});

describe('describeNode', () => {
  it('reports all three fields together for logs and the fleet view', () => {
    process.env.NODE_ID = 'node-a';
    process.env[NODE_ROLE_ENV] = 'worker';
    process.env[NODE_LABEL_ENV] = 'label-a';
    expect(describeNode()).toEqual({ nodeId: 'node-a', role: 'worker', label: 'label-a' });
  });
});
