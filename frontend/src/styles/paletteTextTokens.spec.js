/**
 * Palette tokens must not be used as TEXT colors.
 *
 * 2026-08-04: the canvas context menu (right-click a sidebar nav icon)
 * rendered white-on-white on light themes. Cause: `.cv-ctx-item { color:
 * var(--color-light-0) }`. `--color-light-0` is a PALETTE token — it aliases
 * --color-dull-white and stays light in every theme — while text needs a
 * SEMANTIC token (--color-text / --color-text-muted / --color-text-secondary)
 * that themes flip with the background. The same misuse existed in 21 places
 * across 10 files (all canvas surfaces, the left-panel nav buttons, and the
 * widget-thumbnail generator); Navigation.vue even declared
 * `color: var(--color-text)` and then clobbered it with the palette token in
 * the same rule.
 *
 * In the dark theme --color-text IS --color-dull-white, so the swap is
 * pixel-identical there and correct everywhere else.
 *
 * This spec walks the whole of src/ so the ban holds for files that do not
 * exist yet. Deliberately NOT banned:
 *   - background/border/outline/etc. uses of palette tokens (that is what
 *     palette tokens are for);
 *   - `color:` on a colored background that is itself theme-invariant
 *     (e.g. white-on-red close buttons use --color-dull-white directly,
 *     not the --color-light-* alias).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_EXTENSIONS = new Set(['.vue', '.css', '.js']);

// `color:` preceded by start/whitespace/;/{ — NOT `background-color:`,
// `border-color:`, `-webkit-text-stroke-color:` etc.
const PALETTE_TEXT_COLOR = /(?<![-\w])color\s*:\s*var\(\s*--color-light-\d/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

describe('palette tokens as text colors', () => {
  it('no file uses --color-light-* as a color: value (use --color-text* semantic tokens)', () => {
    const offenders = [];
    for (const file of walk(SRC_ROOT)) {
      if (file.endsWith('paletteTextTokens.spec.js')) continue;
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        PALETTE_TEXT_COLOR.lastIndex = 0;
        if (PALETTE_TEXT_COLOR.test(line)) {
          offenders.push(`${path.relative(SRC_ROOT, file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'palette tokens (--color-light-*) are theme-invariant and unreadable on light themes; ' +
        'text must use semantic tokens: --color-text, --color-text-muted, --color-text-secondary.\n' +
        offenders.join('\n')
    ).toEqual([]);
  });
});
