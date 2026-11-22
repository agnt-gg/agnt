/**
 * AGNT One's shell asks the shared pieces it draws to explain themselves in
 * words (labelled buttons, what a limit means). Names never change.
 */
import { inject } from 'vue';

export const PLAIN_WORDS_KEY = 'agnt:plainWords';

/** True inside a shell that asked for plain words (AGNT One). */
export function usePlainShell() {
  return inject(PLAIN_WORDS_KEY, false) === true;
}

/** Each metered service: what it is, and what happens at its limit. */
export const PLAIN_SERVICES = Object.freeze({
  models: { name: 'AGNT Flash', what: 'What Annie uses to think and write', atLimit: 'At the limit, Annie switches to your own AI accounts, or pauses until it resets.' },
  search: { name: 'Search', what: 'Looking things up on the web for you', atLimit: 'At the limit, Annie stops searching the web until it resets.' },
  sandbox: { name: 'Sandbox', what: 'Time Annie spends running tasks for you', atLimit: 'At the limit, tasks that need a computer pause until it resets.' },
  mail: { name: 'Mail', what: 'Emails Annie sends on your behalf', atLimit: 'At the limit, Annie drafts emails instead of sending them.' },
  webhooks: { name: 'Webhooks', what: 'Times another app started one of your workflows', atLimit: 'At the limit, new webhook calls wait until it resets.' },
  mobile: { name: 'Text Annie', what: 'Texts between you and Annie on your phone', atLimit: 'At the limit, Annie replies in the app instead.' },
});
