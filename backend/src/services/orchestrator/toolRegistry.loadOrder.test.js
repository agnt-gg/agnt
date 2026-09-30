import { it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import toolRegistry from './toolRegistry.js';

/**
 * Library tools are now loaded concurrently (sequential loading cost 30 s at
 * boot on 2026-09-30). Tool lists are observable, so registration must still
 * follow the manifest exactly: loading in parallel may not reorder anything.
 */
it('registers library tools in manifest order, however their imports finish', async () => {
  await toolRegistry.ensureInitialized();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(path.join(here, '../../tools/toolLibrary.json'), 'utf8'));
  const manifestOrder = ['actions', 'utilities', 'custom']
    .flatMap((category) => (Array.isArray(manifest[category]) ? manifest[category] : []))
    .map((toolDef) => toolDef.type);

  const registered = [...toolRegistry.tools.keys()];
  expect(registered.length).toBeGreaterThan(10);
  // Every registered tool is in the manifest, in the manifest's relative order.
  const positions = registered.map((type) => manifestOrder.indexOf(type));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});
