import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenHasFrame, FRAMELESS_SCREENS, SCREEN_DEFAULTS } from '@/views/Terminal/CenterPanel/screenRegistry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const canvasSrc = fs.readFileSync(path.join(here, 'CanvasScreen.vue'), 'utf8');

describe('PanelBackdrop — exists only where the three-panel frame does', () => {
  // REGRESSION (2026-09-02): the backdrop painted under Workspace, filling the
  // gutters between widgets that are meant to show the wallpaper.
  it('Workspace is frameless: it draws its own gutters and gets no backdrop', () => {
    expect(FRAMELESS_SCREENS.has('WorkspaceScreen')).toBe(true);
    expect(screenHasFrame('WorkspaceScreen')).toBe(false);
    // Frameless screens never mount <BaseScreen>, so they must not be in the
    // registry table (its guard rejects orphans and rightPanel:false).
    expect('WorkspaceScreen' in SCREEN_DEFAULTS).toBe(false);
  });

  it('frame screens (and unknown screens) get the backdrop', () => {
    for (const s of ['ChatScreen', 'AgentsScreen', 'TracesScreen', 'ProvidersScreen', 'SomeNewScreen']) {
      expect(screenHasFrame(s), s).toBe(true);
    }
  });

  it('the component and the body class are driven by ONE predicate, and custom pages are excluded', () => {
    expect(canvasSrc).toMatch(/<PanelBackdrop v-if="showPanelBackdrop"/);
    expect(canvasSrc).toMatch(/classList\.toggle\('has-panel-backdrop', showPanelBackdrop\.value\)/);
    expect(canvasSrc).toMatch(/showPanelBackdrop = computed\(\(\) => !onCustomPage\.value && screenHasFrame\(props\.screenName\)\)/);
  });
});
