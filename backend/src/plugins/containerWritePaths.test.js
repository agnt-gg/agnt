import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dockerfile = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf8');
const entrypoint = fs.readFileSync(path.join(REPO, 'scripts', 'docker-entrypoint.sh'), 'utf8');

/**
 * The container must not be able to rewrite the product it is serving.
 *
 * A tenant agent hand-edited the minified frontend entry bundle inside its own
 * running container, saved it under a new filename, and repointed index.html.
 * The 160 lazily-imported route chunks still carried the ORIGINAL entry
 * filename, so the browser instantiated the entry graph twice and Vue threw at
 * the root mount. Blank page, HTTP 200 everywhere, nothing alerted.
 *
 * Ownership is the enforcement point because a policy check inside the app
 * would have to defend against code running as the app. These tests pin that
 * arrangement in the two files that create it.
 */

/** Strip comments so prose describing a rule can't satisfy a check for it. */
function dockerfileInstructions(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

const instructions = dockerfileInstructions(dockerfile);

describe('the application tree is not writable by the app user', () => {
  it('chowns /app to root', () => {
    expect(instructions).toMatch(/chown\s+-R\s+root:root\s+\/app\b/);
  });

  it('does the chown AFTER the last COPY that populates the tree', () => {
    // A hardening step that runs before the code is copied in hardens an empty
    // directory: every later COPY --chown=node:node puts it straight back.
    const lastCopy = instructions.lastIndexOf('COPY --chown=node:node');
    const harden = instructions.search(/chown\s+-R\s+root:root\s+\/app\b/);
    expect(lastCopy).toBeGreaterThan(-1);
    expect(harden).toBeGreaterThan(lastCopy);
  });

  it('restores node ownership on the three runtime write paths', () => {
    // Root-owning these too would break the app on first boot rather than
    // protect anything: they are exactly where user work is supposed to land.
    const restore = instructions.match(/chown\s+-R\s+node:node\s+([^\n\\]+)/g) || [];
    const joined = restore.join(' ');
    expect(joined).toContain('/app/data');
    expect(joined).toContain('/app/logs');
    expect(joined).toContain('/app/unfirehose');
  });

  it('keeps /app itself traversable and readable', () => {
    expect(instructions).toMatch(/chmod\s+755\s+\/app\b/);
  });

  it('still runs the app as a non-root user', () => {
    // The whole scheme rests on the process not being root. su-exec in the
    // entrypoint is what drops it.
    expect(entrypoint).toMatch(/su-exec\s+node/);
  });
});

describe('the entrypoint keeps the runtime write paths usable', () => {
  it('chowns each mounted path back to node at boot', () => {
    // Bind mounts arrive with the HOST directory's ownership, which the image
    // cannot predict. Without this, root-owning /app would make a fleet mount
    // unwritable and the app would fail to open its own database.
    for (const dir of ['/app/data', '/app/logs', '/app/unfirehose']) {
      expect(entrypoint, dir).toContain(dir);
    }
    expect(entrypoint).toMatch(/chown\s+-R\s+node:node\s+\/app\/data/);
    expect(entrypoint).toMatch(/chown\s+-R\s+node:node\s+\/app\/logs/);
    expect(entrypoint).toMatch(/chown\s+-R\s+node:node\s+\/app\/unfirehose/);
  });

  it('creates the plugin directories the installer writes into', () => {
    // PluginInstaller resolves every write path from USER_DATA_PATH (/app/data
    // in the fleet), including the cwd it runs `npm install` in. If these moved
    // under the app tree, root ownership would break plugin installs.
    expect(entrypoint).toContain('/app/data/plugins/installed');
    expect(entrypoint).toContain('/app/data/plugins/.temp');
  });
});

describe('plugin write paths stay outside the application tree', () => {
  const installer = fs.readFileSync(
    path.join(REPO, 'backend', 'src', 'plugins', 'PluginInstaller.js'),
    'utf8'
  );

  it('derives pluginsDir from USER_DATA_PATH, not from the app path', () => {
    expect(installer).toMatch(/pluginsDir\s*=\s*path\.join\(\s*userDataPath\s*,/);
  });

  it('derives tempDir and the registry from USER_DATA_PATH too', () => {
    expect(installer).toMatch(/tempDir\s*=\s*path\.join\(\s*userDataPath\s*,/);
    expect(installer).toMatch(/registryPath\s*=\s*path\.join\(\s*userDataPath\s*,/);
  });

  it('reads bundled .agnt packages from the app tree but never writes there', () => {
    // Read-only use of the app tree is fine and expected; this asserts the
    // bundled dir is only ever a source.
    expect(installer).toMatch(/bundledPluginsDir\s*=\s*path\.join\(\s*unpackedPath\s*,/);
  });
});
