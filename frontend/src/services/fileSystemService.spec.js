import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateSettings, getSettings } from './fileSystemService.js';

/**
 * The workspace picker's refusal has to REACH the user.
 *
 * The backend rejects a workspace folder that an AGNT update would delete and
 * returns one sentence explaining why. Before this, the service threw
 * `Failed to update settings: Bad Request` — the status line — and discarded
 * the body. Both call sites (onboarding, file-tree settings) render whatever
 * this function throws, so dropping the reason meant the one warning that
 * would have saved a user's files was replaced with "Bad Request".
 */

const originalFetch = global.fetch;

beforeEach(() => {
  global.localStorage = { getItem: () => 'test-token' };
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('updateSettings — rejection reasons', () => {
  it('surfaces the servers explanation, not the status line', async () => {
    const message =
      "That folder is inside AGNT's install directory (D:\\AGNT). " +
      'Installing an AGNT update deletes everything in that directory, ' +
      'including your files — permanently, with no Recycle Bin. ' +
      'Please choose a folder somewhere else.';

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: message, code: 'workspace_inside_install_dir' }),
    });

    await expect(updateSettings('D:\\AGNT\\projects')).rejects.toThrow(message);
  });

  it('never lets "Bad Request" stand in for a real reason', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'AGNT is installed inside that folder (D:\\AGNT).' }),
    });

    await expect(updateSettings('D:\\')).rejects.not.toThrow(/Bad Request/);
  });

  it('falls back to the status line when the body is not JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(updateSettings('/tmp/ws')).rejects.toThrow(/Internal Server Error/);
  });

  it('falls back to the status line when the body has no error field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({}),
    });

    await expect(updateSettings('/tmp/ws')).rejects.toThrow(/Bad Request/);
  });

  it('resolves normally on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, workspaceRoot: '/tmp/ws' }),
    });

    await expect(updateSettings('/tmp/ws')).resolves.toEqual({
      success: true,
      workspaceRoot: '/tmp/ws',
    });
  });
});

describe('getSettings — unsafeRoot passthrough', () => {
  it('carries the verdict the banner renders', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaceRoot: 'D:\\AGNT\\projects',
        defaultRoot: 'C:\\Users\\x\\AppData\\Roaming\\AGNT\\projects',
        unsafeRoot: {
          code: 'workspace_inside_install_dir',
          installRoot: 'D:\\AGNT',
          workspaceRoot: 'D:\\AGNT\\projects',
          message: 'That folder is inside AGNT install directory.',
        },
      }),
    });

    const data = await getSettings();
    expect(data.unsafeRoot.code).toBe('workspace_inside_install_dir');
    expect(data.unsafeRoot.installRoot).toBe('D:\\AGNT');
  });

  it('reports null for a safe workspace', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspaceRoot: '/home/x/projects', defaultRoot: '/home/x/projects', unsafeRoot: null }),
    });

    const data = await getSettings();
    expect(data.unsafeRoot).toBeNull();
  });
});
