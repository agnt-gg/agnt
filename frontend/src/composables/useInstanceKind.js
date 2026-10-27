import { ref } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

/**
 * Is this app talking to a hosted (cloud) AGNT instance or a desktop one?
 *
 * `null` until the backend has answered, so callers can hold back anything
 * that only makes sense on one kind: rendering it on a guess is exactly how a
 * cloud member saw a desktop-only panel fail with "Tenant administrator
 * required". Fetched once per page load and shared (it never changes while
 * the page is open). An unreachable backend reports desktop, the historical
 * default.
 */
const isHostedInstance = ref(null);
let pending = null;

export async function loadInstanceKind(fetchImpl = fetch) {
  if (isHostedInstance.value !== null) return isHostedInstance.value;
  if (!pending) {
    pending = (async () => {
      try {
        const data = await (await fetchImpl(`${API_CONFIG.BASE_URL}/version`)).json();
        isHostedInstance.value = data?.hosted === true;
      } catch {
        isHostedInstance.value = false;
      }
      return isHostedInstance.value;
    })().finally(() => { pending = null; });
  }
  return pending;
}

export function useInstanceKind() {
  loadInstanceKind();
  return { isHostedInstance };
}

/** Test seam. */
export function __resetInstanceKindForTests() {
  isHostedInstance.value = null;
  pending = null;
}
