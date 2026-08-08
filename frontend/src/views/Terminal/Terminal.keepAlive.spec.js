import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const terminalPath = path.resolve(process.cwd(), 'src/views/Terminal/Terminal.vue');
const source = fs.readFileSync(terminalPath, 'utf8');

describe('Terminal KeepAlive screen identity', () => {
  it('warms lazy screen chunks without replacing registered component identities', () => {
    const replacements = [
      ...source.matchAll(/screenComponents\s*\[[^\]]+\]\s*=\s*markRaw\(mod\.default\)/g),
    ];

    expect(
      replacements,
      'Replacing an async wrapper after it has entered <KeepAlive> can crash Vue deactivation and prevent overlays such as onboarding from closing.',
    ).toHaveLength(0);
  });
});
