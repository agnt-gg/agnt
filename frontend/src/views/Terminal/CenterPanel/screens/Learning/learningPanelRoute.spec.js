/**
 * Learning shares the Settings nav. Every row in it must lead somewhere from
 * the Learning page. 'settings-nav' (a Settings section row) used to be
 * dropped, so the whole sidebar did nothing there: reproduced in a real
 * browser as /learning staying put after clicking AI Models.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { learningPanelRoute } from './learningPanelRoute.js';
import { settingsDirectory } from '@/mobile/sectionDirectories.js';

const DIR = dirname(fileURLToPath(import.meta.url));

describe('a Settings nav click on the Learning page', () => {
  it('a Settings section row opens Settings on that section', () => {
    expect(learningPanelRoute('settings-nav', 'providers')).toEqual({ screen: 'SettingsScreen', opts: { section: 'providers' } });
  });

  it('every row in the Settings nav leads somewhere', () => {
    for (const item of settingsDirectory.flatMap((g) => g.items)) {
      const target = item.screen ? learningPanelRoute('settings-goto', item.screen) : learningPanelRoute('settings-nav', item.id);
      expect(target, item.label).not.toBeNull();
    }
  });

  it('screen rows and generic navigation still work', () => {
    expect(learningPanelRoute('settings-goto', 'LearningScreen')).toEqual({ screen: 'LearningScreen' });
    expect(learningPanelRoute('navigate', 'ChatScreen')).toEqual({ screen: 'ChatScreen' });
    expect(learningPanelRoute('navigate', { screen: 'ConnectorsScreen', opts: { section: 'webhooks' } })).toEqual({ screen: 'ConnectorsScreen', opts: { section: 'webhooks' } });
  });

  it('ignores what it cannot route', () => {
    for (const [a, p] of [['settings-nav', ''], ['settings-nav', null], ['navigate', {}], ['refresh', 'x'], [undefined, undefined]]) expect(learningPanelRoute(a, p)).toBeNull();
  });

  it('Learning forwards the section, and its screen-change keeps the options', () => {
    const src = readFileSync(join(DIR, 'Learning.vue'), 'utf8');
    expect(src).toMatch(/learningPanelRoute\(action,payload\)/);
    expect(src).toMatch(/@screen-change="\(screen, opts\) => \$emit\('screen-change', screen, opts\)"/);
  });
});
