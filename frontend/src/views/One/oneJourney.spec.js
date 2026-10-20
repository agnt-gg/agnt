/**
 * AGNT One's journey rules, held at the source of every page it frames.
 *
 * The rule: each page leads with the next thing this person needs to do. Two
 * kinds of button kept taking that place, so they are pinned here:
 *   - building (the Forge): only for plugins you built, never a page's lead;
 *   - upgrading: offered where the paid feature is (Routines, the plan's own
 *     row in Settings), never above your own work or in the Chats drawer.
 * And a page that connects something leads with connecting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(DIR, rel), 'utf8');
const templateOf = (rel) => {
  const src = read(rel);
  return src.slice(src.indexOf('<template>'), src.lastIndexOf('</template>'));
};

const PAGES = {
  library: '../Focused/FocusedLibrary.vue',
  settings: '../Focused/FocusedSettings.vue',
  drawer: '../Focused/FocusedSidebar.vue',
  routines: '../Focused/FocusedScheduled.vue',
  account: '../Focused/FocusedConnection.vue',
  pluginDetail: '../Terminal/CenterPanel/screens/Connectors/components/apps/PluginDetail.vue',
  plugins: '../Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue',
};

describe('AGNT One journey: what leads each page', () => {
  it.each(['library', 'settings', 'drawer'])('%s offers no upgrade banner', (page) => {
    expect(templateOf(PAGES[page])).not.toContain('<UpgradePrompt');
  });

  it('Routines is where the paid feature is offered, under one name', () => {
    const t = templateOf(PAGES.routines);
    expect(t).toContain('<UpgradePrompt');
    expect(t).not.toMatch(/Scheduled goals/);
  });

  it('a plugin detail never leads with the Forge, and offers it only on your own build', () => {
    const t = templateOf(PAGES.pluginDetail);
    expect(t).not.toContain('Open in the Forge');
    expect(t).toMatch(/v-if="plugin\.installed && builtByMe"[^>]*>Edit in the Forge/);
  });

  it('the Plugins header offers building, but not as its primary button', () => {
    const t = templateOf(PAGES.plugins);
    const build = t.slice(t.lastIndexOf('<button', t.indexOf('data-action="build"')), t.indexOf('</button>', t.indexOf('data-action="build"')));
    expect(build).not.toMatch(/class="[^"]*\bprimary\b/);
  });

  it('the account page asks you to connect before it lists what connecting turns on', () => {
    const t = templateOf(PAGES.account);
    const signIn = t.indexOf('Needs a sign-in');
    const inside = t.indexOf('What\u2019s inside');
    expect(signIn).toBeGreaterThan(-1);
    expect(inside).toBeGreaterThan(signIn);
  });
});
