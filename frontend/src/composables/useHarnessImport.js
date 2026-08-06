import { computed, reactive, ref } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

/**
 * Find what the user already built in other AI agent tools, and bring it over.
 *
 * DETECTION MUST NEVER BLOCK ONBOARDING. It runs alongside the provider and
 * workspace lookups on mount, and every failure path here resolves to "nothing
 * found" rather than rejecting. A user whose disk is slow, or whose token is
 * momentarily stale, sees one fewer step — not an error on their first launch.
 */
export function useHarnessImport() {
  const loading = ref(false);
  const sources = ref([]);
  const totals = ref({ sources: 0, skillsSeen: 0, skillsImportable: 0, personas: 0, memories: 0 });

  const running = ref(false);
  const result = ref(null);
  const error = ref('');

  /** What the user has ticked, keyed by harness id. */
  const selection = reactive({ skills: new Set(), personas: new Set(), memories: new Set() });

  const headers = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  /**
   * Anything at all worth showing a step for.
   *
   * Note this is NOT `sources.length`: having Claude Code installed with every
   * one of its skills already in AGNT is a real and common state, and it has
   * nothing to offer. Showing a step to say so would be a step that wastes the
   * user's only first run.
   */
  const hasAnythingToImport = computed(
    () => totals.value.skillsImportable > 0 || totals.value.personas > 0 || totals.value.memories > 0,
  );

  /** Sources that can actually contribute something. */
  const offerable = computed(() =>
    sources.value.filter(
      (s) => s.skills.importable > 0 || s.persona.available || s.memories.count > 0,
    ),
  );

  const selectedCount = computed(
    () => selection.skills.size + selection.personas.size + selection.memories.size,
  );

  const detect = async () => {
    loading.value = true;
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/import/detect`, { headers: headers() });
      if (!res.ok) return;
      const data = await res.json();
      sources.value = Array.isArray(data?.sources) ? data.sources : [];
      totals.value = data?.totals || totals.value;

      // Pre-tick what is safe and additive. Skills cannot overwrite anything —
      // the importer skips a name that already exists — so defaulting them on
      // makes the common case a single click. Personas create a new agent and
      // memories change what the assistant believes about the user; both are
      // opinions about the user rather than files, so they stay opt-in.
      for (const source of sources.value) {
        if (source.skills.importable > 0) selection.skills.add(source.id);
      }
    } catch {
      // Nothing found is the correct answer to "I could not look".
    } finally {
      loading.value = false;
    }
  };

  const toggle = (kind, sourceId) => {
    const set = selection[kind];
    if (!set) return;
    if (set.has(sourceId)) set.delete(sourceId);
    else set.add(sourceId);
  };

  const isSelected = (kind, sourceId) => selection[kind]?.has(sourceId) === true;

  const run = async () => {
    if (running.value || selectedCount.value === 0) return null;
    running.value = true;
    error.value = '';
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/import/run`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          skills: [...selection.skills],
          personas: [...selection.personas],
          memories: [...selection.memories],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        error.value = data?.error || 'Import failed';
        return null;
      }
      result.value = data;
      return data;
    } catch (err) {
      error.value = err?.message || 'Import failed';
      return null;
    } finally {
      running.value = false;
    }
  };

  return {
    loading, sources, totals, running, result, error,
    hasAnythingToImport, offerable, selectedCount,
    detect, toggle, isSelected, run,
  };
}
