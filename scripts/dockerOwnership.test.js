import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

describe('Docker application ownership', () => {
  it('copies runtime application files with final ownership without a full-tree copy-up', () => {
    const runtime = dockerfile.slice(dockerfile.indexOf('# Stage 3:'));
    const copies = runtime.split(/\r?\n/).filter(line => line.startsWith('COPY '));
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) expect(copy).toContain('--chown=root:root');
    expect(runtime).not.toMatch(/chown\s+-R\s+\S+\s+\/app\s*(?:\\|\n|$)/);
    expect(runtime).toContain('chown -R node:node /app/data /app/logs /app/unfirehose');
    expect(runtime).toContain('chmod 755 /app');
  });
});
