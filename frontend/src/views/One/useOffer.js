/**
 * The corner card's state, shared by the card and its rail button: whether
 * this account is offered it right now, whether the card is open, and closing
 * it. Closing is kept per offer (offer.js).
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { useStore } from 'vuex';
import { CURRENT_OFFER, offerApplies, offerDismissedKey, offerLive } from './offer.js';

function wasDismissed(offer) {
  try {
    return localStorage.getItem(offerDismissedKey(offer)) === '1';
  } catch {
    return false;
  }
}

export function useOffer(offer = CURRENT_OFFER) {
  const store = useStore();
  const now = ref(Date.now());
  // Once a minute is enough for "days left", and for ending on time in an open window.
  const timer = offer ? setInterval(() => { now.value = Date.now(); }, 60_000) : null;
  onBeforeUnmount(() => clearInterval(timer));

  const closed = ref(!offer || wasDismissed(offer));
  const shown = computed(() => offerLive(offer, now.value) && offerApplies(store.state.userAuth?.subscription));

  function dismiss() {
    closed.value = true;
    try {
      localStorage.setItem(offerDismissedKey(offer), '1');
    } catch {
      /* storage disabled: closed for this session only */
    }
  }

  /** The rail button: opens the card, or closes it again without forgetting the offer. */
  function toggle() {
    closed.value = !closed.value;
  }

  return reactive({ offer, now, shown, open: computed(() => shown.value && !closed.value), dismiss, toggle });
}
