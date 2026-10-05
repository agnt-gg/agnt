/**
 * Every app frame that mounts a screen gives fullscreen a box to fill.
 *
 * The live browser card's fullscreen moves into the nearest
 * [data-fullscreen-host] around it — the frame's screen box, below the top bar
 * and beside the sidebar. With no host it falls back to the whole window
 * (position: fixed, above everything), which over app chrome covers the top
 * bar and sidebar with no way out.
 *
 * Only Studio (CanvasScreen) had a host; the Focused frame was added without
 * one, so fullscreen in Focused chat covered the entire app. A frame added to
 * Terminal's `frames` map must declare its host, or this fails.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '../..');
const terminal = fs.readFileSync(path.join(here, 'Terminal.vue'), 'utf8');

function frameComponents() {
  const map = terminal.match(/const frames\s*=\s*\{([^}]*)\}/);
  if (!map) throw new Error('Terminal.vue no longer declares `const frames = { ... }`; update this contract.');
  const names = [...map[1].matchAll(/:\s*markRaw\((\w+)\)/g)].map((m) => m[1]);
  return names.map((name) => {
    const imp = terminal.match(new RegExp(`import\\s+${name}\\s+from\\s+'([^']+)'`));
    if (!imp) throw new Error(`No import found for frame component ${name}`);
    return { name, file: path.join(srcRoot, imp[1].replace(/^@\//, '')) };
  });
}

const template = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('<template>');
  return source.slice(start, source.lastIndexOf('</template>'));
};

describe('app frames and fullscreen', () => {
  const frames = frameComponents();

  it('finds every frame Terminal can mount', () => {
    expect(frames.map((f) => f.name).sort()).toEqual(['CanvasScreen', 'FocusedShell']);
  });

  it.each(frames)('$name wraps its screen slot in a [data-fullscreen-host]', ({ file }) => {
    // The host must be the element that contains the <slot /> the screen
    // (and so the chat transcript) is rendered into.
    expect(template(file)).toMatch(/<div\b[^>]*\bdata-fullscreen-host\b[^>]*>\s*<slot\s*\/>/);
  });

  it('the Focused host is a containing block for an absolutely positioned card', () => {
    const css = fs.readFileSync(path.join(srcRoot, 'views/Focused/focused.css'), 'utf8');
    const rule = css.match(/\.ui-focused \.focused-screen\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/position:\s*relative/);
  });
});
