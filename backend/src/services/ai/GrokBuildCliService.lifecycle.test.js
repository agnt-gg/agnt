/**
 * Lifecycle hygiene for the Grok Build connector (PR #50 hardening).
 *
 * 1. Importing the module must NOT touch the filesystem. tools.js imports it
 *    unconditionally, so an import-time mkdir wrote to the user's home
 *    directory on every backend boot and in every test run — same defect
 *    class as the import-time DB init isolated in 9d9d5db. Verified with a
 *    child process so this test cannot be fooled by modules already cached
 *    in the vitest worker.
 *
 * 2. GrokBuildCliSessionManager.init() must only adopt rows explicitly
 *    tagged grok-build. CodexThreadModel treats a missing provider as
 *    'openai-codex' (legacy rows predate the column); the original guard
 *    pair let those untagged rows through and resumed Codex threads as
 *    Grok sessions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('GrokBuildCliService import purity', () => {
  it('does not create the workdir at import time', () => {
    const probeDir = path.join(os.tmpdir(), `agnt-grok-import-probe-${Date.now()}`);
    expect(fs.existsSync(probeDir)).toBe(false);

    const serviceUrl = new URL('./GrokBuildCliService.js', import.meta.url).href;
    execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(serviceUrl)});`], {
      env: { ...process.env, AGNT_GROK_WORKDIR: probeDir },
      stdio: 'pipe',
      timeout: 60000,
    });

    expect(fs.existsSync(probeDir)).toBe(false);
  });
});

describe('GrokBuildCliSessionManager provider filter', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadWithRows(rows) {
    vi.doMock('../../models/CodexThreadModel.js', () => ({
      default: {
        listAll: vi.fn(async () => rows),
        upsert: vi.fn(async () => {}),
        findThreadId: vi.fn(async () => null),
      },
    }));
    const { default: manager } = await import('./GrokBuildCliSessionManager.js');
    return manager;
  }

  it('adopts rows explicitly tagged grok-build', async () => {
    const manager = await loadWithRows([
      { user_id: 'u1', provider: 'grok-build', scope: 'conversation', conversation_id: 'c1', thread_id: 't-grok', updated_at: new Date().toISOString() },
    ]);
    await manager.init();
    const key = manager.getSessionKey({ userId: 'u1', provider: 'grok-build', scope: 'conversation', conversationId: 'c1' });
    expect(await manager.getThreadId(key)).toBe('t-grok');
  });

  it('skips codex-tagged rows AND untagged legacy rows', async () => {
    const manager = await loadWithRows([
      { user_id: 'u1', provider: 'openai-codex', scope: 'conversation', conversation_id: 'c1', thread_id: 't-codex', updated_at: new Date().toISOString() },
      // Legacy row: provider column empty. normalizeProvider reads this as
      // openai-codex — it must NOT be resumed as a Grok session.
      { user_id: 'u1', provider: null, scope: 'conversation', conversation_id: 'c2', thread_id: 't-legacy', updated_at: new Date().toISOString() },
    ]);
    await manager.init();
    const codexKey = manager.getSessionKey({ userId: 'u1', provider: 'grok-build', scope: 'conversation', conversationId: 'c1' });
    const legacyKey = manager.getSessionKey({ userId: 'u1', provider: 'grok-build', scope: 'conversation', conversationId: 'c2' });
    expect(await manager.getThreadId(codexKey)).toBeFalsy();
    expect(await manager.getThreadId(legacyKey)).toBeFalsy();
  });
});
