// innerSection — which inner view a shared screen is currently showing.
//
// Most sidebar rows own a screen outright, so the active row is just "the
// section whose screens include the current screen". CONNECT breaks that
// assumption: six rows share ConnectorsScreen and differ only by which inner
// section they open. Without a shared value, the sidebar would highlight the
// first of the six no matter which one you clicked, and clicking a row while
// already on ConnectorsScreen would navigate nowhere.
//
// This is deliberately a plain module-level ref rather than vuex state: it is
// ephemeral view position, not application data — nothing persists it, nothing
// syncs it across tabs, and it resets to null the moment you leave the screen
// that owns it. Both the sidebar (which writes on click) and the screen (which
// writes when its own inner nav is used) read the same ref, so the two can not
// disagree about what is showing.

import { ref } from 'vue';

export const activeInnerSection = ref(null);

export function setInnerSection(value) {
  activeInnerSection.value = value ?? null;
}

export function clearInnerSection() {
  activeInnerSection.value = null;
}
