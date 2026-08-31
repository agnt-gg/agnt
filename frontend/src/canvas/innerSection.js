// innerSection — which inner view Connectors is currently showing.
//
// ConnectorsScreen and ConnectorsPanel are two halves of one screen: the panel
// is the nav, the screen is the body. Both read and write THIS ref rather than
// passing the value between them, so the highlighted row and the rendered view
// cannot disagree about what is showing.
//
// Deliberately a plain module-level ref rather than vuex state: it is ephemeral
// view position, not application data — nothing persists it and nothing syncs
// it across tabs. Living at module scope does mean it survives unmounting, so
// leaving Connectors and coming back resumes the view you were on, which is
// the behaviour you want from a screen reached by a single sidebar row.

import { ref } from 'vue';

export const activeInnerSection = ref(null);

export function setInnerSection(value) {
  activeInnerSection.value = value ?? null;
}

export function clearInnerSection() {
  activeInnerSection.value = null;
}
