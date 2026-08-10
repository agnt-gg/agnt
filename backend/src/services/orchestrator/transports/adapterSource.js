import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The adapter layer's source, as one string.
 *
 * Several tests assert things about the adapter code itself rather than its
 * behaviour — that a helper is not merely defined but actually CALLED, that a
 * merge happens at both request sites, that a guard is not sitting behind a
 * dead `if (false && ...)`. Those checks are worth having: a source-contract
 * test is the only thing that catches wiring which exists but is unreachable.
 *
 * They used to read `llmAdapters.js` directly. When that 7,100-line module was
 * split into per-transport files, all of them silently stopped seeing the code
 * they were guarding — the tests failed loudly here, but a test that quietly
 * scanned an emptied file would have been worse: green, and guarding nothing.
 *
 * So the concept they actually want is "the adapter layer", not "that one
 * file". This exports exactly that, and picks up any transport added later
 * without an edit.
 */
export function readAdapterSource() {
  const parts = [
    fs.readFileSync(path.join(__dirname, '..', 'llmAdapters.js'), 'utf8'),
  ];
  for (const file of fs.readdirSync(__dirname).sort()) {
    if (!file.endsWith('.js')) continue;
    if (file === 'adapterSource.js') continue;
    parts.push(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  }
  return parts.join('\n');
}

/** The transport files only, keyed by filename — for per-transport assertions. */
export function readTransportSources() {
  const out = {};
  for (const file of fs.readdirSync(__dirname).sort()) {
    if (!file.endsWith('.js') || file === 'adapterSource.js') continue;
    out[file] = fs.readFileSync(path.join(__dirname, file), 'utf8');
  }
  return out;
}
