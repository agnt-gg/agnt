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

/** True inside a shell that asked for plain words (AGNT One). */
export function usePlainShell() {
  return inject(PLAIN_WORDS_KEY, false) === true;
}

/** Each metered service in plain words: what it is, and what happens at its limit. */
export const PLAIN_SERVICES = Object.freeze({
  models: { name: 'AI credits', what: 'What Annie uses to think and write', atLimit: 'At the limit, Annie switches to your own AI accounts, or pauses until it resets.' },
  search: { name: 'Web searches', what: 'Looking things up on the web for you', atLimit: 'At the limit, Annie stops searching the web until it resets.' },
  sandbox: { name: 'Computer time', what: 'Time Annie spends running tasks for you', atLimit: 'At the limit, tasks that need a computer pause until it resets.' },
  mail: { name: 'Emails sent', what: 'Emails Annie sends on your behalf', atLimit: 'At the limit, Annie drafts emails instead of sending them.' },
  webhooks: { name: 'Web triggers', what: 'Times another app started one of your automations', atLimit: 'At the limit, new web triggers wait until it resets.' },
  mobile: { name: 'Text Annie', what: 'Texts between you and Annie on your phone', atLimit: 'At the limit, Annie replies in the app instead.' },
});
