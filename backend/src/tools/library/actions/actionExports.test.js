import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * NodeExecutor runs `toolModule.default.execute(...)`. A module that exports
 * the class instead of an instance passes every unit test that constructs it
 * and fails every workflow that uses it with "Invalid action for node type".
 * This reads the source rather than importing, because several actions drag in
 * the auth stack and database at import time.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe('action modules export something the loader can execute', () => {
  const files = fs.readdirSync(here).filter((f) => f.endsWith('.js') && !f.includes('.test.') && !f.startsWith('_'));
  it('found the library', () => expect(files.length).toBeGreaterThan(20));
  for (const file of files) {
    it(file, () => {
      const source = fs.readFileSync(path.join(here, file), 'utf8');
      const match = source.match(/^export default (.+);\s*$/m);
      if (!match) return; // helper modules with named exports only
      const value = match[1].trim();
      // An instance (`new X()`), an object literal, or a plain function are all callable-ish; a bare class name is the bug.
      const bareClass = /^[A-Z][A-Za-z0-9]*$/.test(value) && new RegExp('class ' + value + '\\b').test(source);
      expect(bareClass, `${file} exports the class ${value}; export \`new ${value}()\` so NodeExecutor can call .execute`).toBe(false);
    });
  }
});
