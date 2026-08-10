/**
 * The mirror is a COPY, so the only thing worth testing is that it is still a
 * copy.
 *
 * Backend and frontend cannot import each other at runtime — neither tree is
 * shipped to the other (see the header of chatStreamReducer.mirror.js) — so
 * the transcript conversion exists twice. Duplication is tolerable only while
 * the two copies are provably identical; the moment someone "just tweaks" one,
 * the server starts storing a different transcript from the one the client
 * renders, and that divergence is invisible until a user sees a mangled
 * conversation.
 *
 * Byte equality is deliberately chosen over behavioural sampling. A parity
 * test over example transcripts can only cover the shapes its author imagined,
 * which is exactly how the two bugs quoted in that header shipped. Byte
 * equality has no blind spot.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SENTINEL = '// --- MIRRORED SOURCE BELOW - DO NOT EDIT BY HAND ---------------------------\n';

const mirrorPath = fileURLToPath(new URL('./chatStreamReducer.mirror.js', import.meta.url));
const sourcePath = fileURLToPath(
  new URL('../../../../frontend/src/services/chatStreamReducer.js', import.meta.url),
);

const RECOPY = [
  'The mirror has drifted from its source.',
  'Do not hand-edit below the sentinel. Regenerate it:',
  '',
  '  cat <the header block> frontend/src/services/chatStreamReducer.js \\',
  '    > backend/src/services/orchestrator/chatStreamReducer.mirror.js',
].join('\n');

describe('chatStreamReducer.mirror.js', () => {
  it('carries the sentinel that separates header from mirrored source', () => {
    expect(fs.readFileSync(mirrorPath, 'utf8')).toContain(SENTINEL);
  });

  it('is byte-identical to frontend/src/services/chatStreamReducer.js', () => {
    const mirror = fs.readFileSync(mirrorPath, 'utf8');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const mirrored = mirror.slice(mirror.indexOf(SENTINEL) + SENTINEL.length);

    expect(mirrored === source ? 'identical' : RECOPY).toBe('identical');
    expect(mirrored).toBe(source);
  });

  it('exports everything the projection depends on', async () => {
    const mod = await import('./chatStreamReducer.mirror.js');
    expect(typeof mod.serverMessagesToUi).toBe('function');
    expect(typeof mod.transcriptSubstance).toBe('function');
  });

  it('exposes the same public surface as its source', async () => {
    const [mirror, source] = await Promise.all([
      import('./chatStreamReducer.mirror.js'),
      import('../../../../frontend/src/services/chatStreamReducer.js'),
    ]);
    expect(Object.keys(mirror).sort()).toEqual(Object.keys(source).sort());
  });
});
