/**
 * WorkflowProcess.js must be able to start. It initializes itself on import, so
 * a missing import or a reference error takes the whole workflow system down on
 * the first launch, and no unit test that imports only its helpers can see it.
 *
 * This forks the REAL file with an IPC channel and requires the ready signal.
 * It runs with AGNT_SKIP_DB_INIT and a throwaway data dir, exactly as the
 * bridge spawns it, then asks for BUSY_REPORT over the real channel.
 */
import { describe, it, expect } from 'vitest';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('WorkflowProcess boots', () => {
  it('reaches ready and answers BUSY_REPORT over IPC', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-wfboot-'));
    const child = fork(path.join(here, 'WorkflowProcess.js'), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, IS_WORKFLOW_PROCESS: 'true', AGNT_SKIP_DB_INIT: '1', USER_DATA_PATH: dataDir, APP_PATH: dataDir, NODE_ENV: 'test' },
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    try {
      const ready = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no ready in 60s. stderr:\n${stderr.slice(-2000)}`)), 60000);
        child.on('exit', (code) => reject(new Error(`exited ${code} before ready. stderr:\n${stderr.slice(-2000)}`)));
        child.on('message', (m) => {
          if (m?.type === 'READY' || m?.type === 'ready' || m?.ready) {
            clearTimeout(t);
            resolve(m);
          }
        });
      });
      expect(ready).toBeTruthy();

      const reply = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no BUSY_REPORT reply')), 10000);
        child.on('message', (m) => {
          if (m?.id === 'busy-1') {
            clearTimeout(t);
            resolve(m);
          }
        });
        child.send({ id: 'busy-1', type: 'BUSY_REPORT', data: {} });
      });
      expect(reply.success).toBe(true);
      expect(reply.data).toEqual({ running: 0 });
    } finally {
      child.kill('SIGKILL');
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }, 90000);
});
