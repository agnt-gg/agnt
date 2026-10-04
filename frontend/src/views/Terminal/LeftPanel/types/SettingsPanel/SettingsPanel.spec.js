/**
 * The Settings nav renders sectionDirectories.js exactly, and Settings opens on
 * its first row (AI Models).
 *
 * The panel used to read the directory by position ([0]..[4]) with one
 * hand-written block per group, so a regroup meant editing two files and a
 * sixth group silently never rendered on desktop.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import SettingsPanel from './SettingsPanel.vue';
import { settingsDirectory, DEFAULT_SETTINGS_SECTION } from '@/mobile/sectionDirectories.js';

const settingsSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../CenterPanel/screens/Settings/Settings.vue'), 'utf8');

describe('Settings nav', () => {
  it('renders every group and row of the directory, in order', () => {
    const w = mount(SettingsPanel);
    expect(w.findAll('h4').map((h) => h.text())).toEqual(settingsDirectory.map((g) => g.label));
    expect(w.findAll('.nav-item').map((b) => b.attributes('data-nav'))).toEqual(settingsDirectory.flatMap((g) => g.items.map((i) => i.id)));
  });

  it('opens on AI Models, the first row', () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe('providers');
    expect(mount(SettingsPanel).findAll('.nav-item.active').map((b) => b.attributes('data-nav'))).toEqual(['providers']);
    expect(settingsSrc).toMatch(/const activeSection = ref\(DEFAULT_SETTINGS_SECTION\)/);
    expect(settingsSrc).not.toMatch(/activeSection = ref\('profile'\)/);
  });

  it('a section row swaps the page; a screen row navigates', async () => {
    const w = mount(SettingsPanel, { props: { activeSection: 'billing' } });
    await w.get('[data-nav="usage"]').trigger('click');
    await w.get('[data-nav="learning"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([
      ['settings-nav', 'usage'],
      ['settings-goto', 'LearningScreen'],
    ]);
  });

  it('sign in / out is a row of Account, not a stray footer', () => {
    const w = mount(SettingsPanel);
    expect(w.find('.nav-footer').exists()).toBe(false);
    const account = w.findAll('.nav-section').find((s) => s.find('h4').text() === 'Account');
    expect(account.findAll('.nav-item').map((b) => b.text())).toContain('Sign in / out');
  });

  it('Settings follows ?section= even while cached, so other screens can open a section', () => {
    expect(settingsSrc).toMatch(/watch\(\s*\(\) => route\?\.query\?\.section,\s*\(section\) => \{[\s\S]{0,200}activeSection\.value = section;\s*\},\s*\{ immediate: true \}/);
  });
});
