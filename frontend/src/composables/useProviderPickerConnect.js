/**
 * Connect an AI provider straight from a provider picker.
 *
 * A picker lists every provider; the ones without an account connected used
 * to be dead rows. Clicking one now runs the SAME connect flow the Connectors
 * page runs (useProviderConnection: API key prompt, OAuth, device login,
 * Google sign-in — chosen by what the backend says the provider supports),
 * then hands the provider back to the picker to select in its own scope:
 * the account default, one conversation, or one tool's local choice.
 *
 * Deliberately not useAiProviderConnect (onboarding's pipeline): that one
 * always writes the account default, which is wrong for a conversation's
 * picker, and it has no path for the local CLI seats the Connectors flow
 * already signs in.
 */
import { resolveProviderKey } from '@/store/app/aiProvider.js';
import { useProviderConnection } from '@/composables/useProviderConnection.js';

/**
 * @param {import('vue').Ref} modalRef  a SimpleModal ref the flow prompts in
 * @param {object} options
 * @param {(option: object) => unknown} options.select  the picker's own
 *   selection handler, called with the clicked option once it is connected
 * @param {() => unknown} options.currentSelection  the picker's current
 *   provider; if it changes while a sign-in is in flight, the user chose
 *   something else and the late connection must not replace it
 */
export function useProviderPickerConnect(modalRef, { select, currentSelection }) {
  const { isProviderConnected, handleProviderToggle } = useProviderConnection(modalRef);
  let inFlight = null;

  const run = async (option) => {
    const providerId = resolveProviderKey(String(option?.value || ''));
    if (!providerId) return;
    const selectionAtClick = currentSelection();

    // handleProviderToggle DISCONNECTS a connected provider. A row can say
    // "Connect" from a list that has since refreshed, so never hand it one.
    if (!isProviderConnected(providerId)) {
      await handleProviderToggle(providerId);
      // Cancelled, failed, or a browser sign-in still finishing on its own.
      if (!isProviderConnected(providerId)) return;
    }

    if (currentSelection() !== selectionAtClick) {
      console.info(`[provider picker] ${providerId} connected; not switching to it, another provider was chosen meanwhile.`);
      return;
    }
    await select({ ...option, connect: false });
  };

  /** One sign-in at a time; a second click while one is open is the same request. */
  const connectFromPicker = (option) => {
    if (!inFlight) inFlight = run(option).finally(() => { inFlight = null; });
    return inFlight;
  };

  return { connectFromPicker };
}
