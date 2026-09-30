/**
 * EVERY AGENT PORTRAIT GOES THROUGH agentAvatarSrc.
 *
 * An agent's `avatar` is its free-form `icon`: usually an emoji, sometimes a
 * data-URL. Binding it as `:src="agent.avatar || DEFAULT"` keeps the emoji
 * (it is truthy) and renders a broken image. That pattern was copied into
 * every Agents surface, so this reads the templates and fails on any portrait
 * binding that feeds `avatar` to an <img> without the helper.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Cut at <script>, not the first </template>: these files nest <template>s.
const templateOf = (file) => {
  const sfc = fs.readFileSync(path.join(here, file), 'utf8');
  return sfc.slice(0, sfc.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
};

// [file, portrait bindings expected]
const PORTRAIT_SITES = [
  ['Agents.vue', 1],
  ['components/AgentList.vue', 2],
  ['components/AgentDetails/tabs/OverviewTab.vue', 1],
  ['components/AgentDetails/tabs/ConfigureTab.vue', 1],
  ['components/AgentDetails/tabs/ChatTab.vue', 1],
  ['../../../RightPanel/types/AgentsPanel/AgentsPanel.vue', 1],
];

const avatarBindings = (template) =>
  [...template.matchAll(/:(src|avatar-url)="([^"]*)"/g)].map((m) => m[2].trim()).filter((value) => /avatar/i.test(value));

describe('agent portraits', () => {
  it.each(PORTRAIT_SITES)('%s binds every portrait through agentAvatarSrc', (file, expected) => {
    const bindings = avatarBindings(templateOf(file));
    expect(bindings).toHaveLength(expected);
    for (const value of bindings) expect(value).toMatch(/^agentAvatarSrc\(/);
  });
});
