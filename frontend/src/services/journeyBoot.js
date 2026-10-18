import { syncJourney } from '@/store/user/journeySync.js';

/**
 * The one call the app makes: at boot without a session (reports the install)
 * and at every session start (also claims it for the account). Never rejects.
 */
export async function runJourneySync({ token = null } = {}) {
  let appVersion = '';
  try { appVersion = (await globalThis.window?.electron?.getAppVersion?.()) || ''; } catch { /* version is optional */ }
  return syncJourney({ token, appVersion, storage: globalThis.localStorage, navigator: globalThis.navigator, win: globalThis.window });
}
