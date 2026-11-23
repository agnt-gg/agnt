import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

/** Every runner label a workflow names: `runs-on: x`, and matrix `os: x` / `runner: x` entries. */
function runnerLabels() {
  const labels = [];
  for (const file of fs.readdirSync(WORKFLOWS_DIR).filter((name) => /\.ya?ml$/.test(name))) {
    const lines = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(?:-\s+)?(runs-on|os|runner):\s*([^\s#]+)/);
      if (match && !match[2].startsWith('${{')) labels.push({ file, line: index + 1, label: match[2].replace(/^['"]|['"]$/g, '') });
    });
  }
  return labels;
}

// ubuntu-latest moved from 24.04 to 26.04 between two releases, and the Linux
// installer build and the browser suite both stopped working with no commit.
describe('CI runner images', () => {
  const labels = runnerLabels();

  it('ANTI-VACUITY: finds the runners the release is built on', () => {
    expect(labels.length).toBeGreaterThanOrEqual(10);
    const release = labels.filter((l) => l.file === 'electron-build.yml').map((l) => l.label);
    expect(release).toEqual(expect.arrayContaining(['windows-2022', 'macos-15', 'macos-15-intel', 'ubuntu-24.04']));
  });

  it('names a pinned image everywhere, never a moving -latest label', () => {
    const moving = labels.filter((l) => /-latest$/.test(l.label)).map((l) => `${l.file}:${l.line} ${l.label}`);
    expect(moving).toEqual([]);
  });
});
