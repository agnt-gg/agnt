/**
 * The words AGNT One uses for each kind of thing. Studio keeps the builder's
 * names (agent, workflow, tool…); One's shell provides PLAIN_WORDS so the
 * shared pieces it draws (the Market shelf and its cards) speak One's words.
 * Only display text: the data names (asset_type, routes) never change.
 */
import { inject } from 'vue';

export const PLAIN_WORDS_KEY = 'agnt:plainWords';

export const PLAIN_WORDS = Object.freeze({
  agent: ['assistant', 'assistants', 'Assistant'],
  workflow: ['automation', 'automations', 'Automation'],
  tool: ['action', 'actions', 'Action'],
  skill: ['playbook', 'playbooks', 'Playbook'],
  widget: ['dashboard card', 'dashboard cards', 'Dashboard card'],
  plugin: ['add-on', 'add-ons', 'Add-on'],
});

/** The plain words for `type` when the surrounding shell asks for them, else null. */
export function usePlainWords() {
  const on = inject(PLAIN_WORDS_KEY, false);
  return (type) => (on && PLAIN_WORDS[String(type || '').toLowerCase()]) || null;
}
