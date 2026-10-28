/**
 * The top-bar capsule asking the empty chat to open the first-run setup at a
 * step. OneShell sets it and takes the person to a blank chat; OneWelcome
 * shows FirstRunSetup at that step and clears it once the setup finishes.
 * A module ref, because the two sit in different branches of the tree.
 */
import { ref } from 'vue';

/** 'ai' | 'google' | 'phone', or null when nothing has been asked for. */
export const setupRequest = ref(null);

export function requestSetup(step) {
  setupRequest.value = step || 'ai';
}

export function clearSetupRequest() {
  setupRequest.value = null;
}
