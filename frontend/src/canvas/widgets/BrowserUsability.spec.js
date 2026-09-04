import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const here = path.join(process.cwd(), 'src/canvas/widgets');
const stream = fs.readFileSync(path.join(here, 'BrowserStreamView.vue'), 'utf8');
const native = fs.readFileSync(path.join(here, 'BrowserNativeView.vue'), 'utf8');
const toolbar = fs.readFileSync(path.join(here, 'BrowserToolbar.vue'), 'utf8');

describe('Browser surface usability contract', () => {
  it('renders the same visible browser chrome in native and streamed modes', () => {
    expect(stream).toContain("import BrowserToolbar from './BrowserToolbar.vue'");
    expect(native).toContain("import BrowserToolbar from './BrowserToolbar.vue'");
    for (const label of ['Back', 'Forward', 'Reload', 'Address']) {
      expect(toolbar).toContain(`aria-label="${label}"`);
    }
    expect(toolbar).toContain('flex-direction: row');
    expect(toolbar).toContain('flex-wrap: nowrap');
  });

  it('does not hide typing behind a watching-mode gate', () => {
    expect(stream).not.toContain('canInteract');
    expect(stream).not.toContain('interact-toggle');
    expect(stream).toContain("@keydown.prevent=\"onKey\"");
    expect(stream).toContain("text: event.key");
  });

  it('implements native back, forward, reload and address navigation', () => {
    expect(native).toContain('view().goBack()');
    expect(native).toContain('view().goForward()');
    expect(native).toContain('view()?.reload()');
    expect(native).toContain('view()?.loadURL(url)');
  });

  it('implements streamed controls through the authenticated browser route', () => {
    expect(stream).toContain('/browser-agent/control');
    expect(stream).toContain("const goBack = () => command('back')");
    expect(stream).toContain("const goForward = () => command('forward')");
    expect(stream).toContain("const reload = () => command('reload')");
    expect(stream).toContain("const navigate = (url) => command('navigate', url)");
  });
});
