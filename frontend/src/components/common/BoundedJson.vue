<template>
  <div class="bounded-json" :class="tone">
    <div v-if="showBar" class="bj-bar">
      <span class="bj-meta">{{ sizeLabel }} · {{ lineLabel }}</span>
      <span v-if="isClipped" class="bj-note">showing first {{ shownLabel }}</span>
      <div class="bj-actions">
        <button v-if="canExpand" type="button" class="bj-btn" @click="expanded = !expanded">
          {{ expanded ? 'Collapse' : 'Expand' }}
        </button>
        <button type="button" class="bj-btn" @click="copyFull">{{ copied ? 'Copied' : 'Copy all' }}</button>
        <button type="button" class="bj-btn" @click="downloadFull">Download</button>
      </div>
    </div>
    <pre class="bj-pre">{{ shown }}</pre>
  </div>
</template>

<script>
/**
 * BoundedJson — size cap + expand button for the Traces / Goals payload blocks.
 *
 * Why this exists: trace inputs/outputs, goal task outputs and execution logs are
 * accident-sized. Dumping `JSON.stringify(value, null, 2)` straight into a <pre>
 * put unbounded text in the DOM, which froze layout and made the page scroll
 * forever. The model's copy of a tool result is capped twice on the way through
 * the orchestrator; the browser — the least capable consumer — had no cap at all.
 *
 * Scope discipline: this component changes WHAT is rendered, never how it looks.
 * `.bj-pre` below is a verbatim copy of the `.io-data` rule these blocks already
 * used. (Panel CSS cannot reach in here — a parent's scoped styles only apply to
 * a child component's ROOT element — so the rule has to be restated, not linked.)
 *
 * Invariants, regardless of what it is handed:
 *   1. Text placed in the DOM never exceeds `maxRenderChars`.
 *   2. Copy all / Download always export the FULL payload, computed on click so
 *      it costs nothing until asked for.
 *   3. Content is text-interpolated, so payloads cannot inject markup.
 */
import { computed, ref, watch } from 'vue';

export const PREVIEW_CHARS = 2000;
export const MAX_RENDER_CHARS = 50000;

export function defaultSerialize(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function countLines(str) {
  let n = 1;
  for (let i = 0; i < str.length; i += 1) {
    if (str.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default {
  name: 'BoundedJson',
  props: {
    /** Raw value to display. Any type. */
    value: { default: null },
    /**
     * Optional `(value, { full }) => string`. Called with `full: false` for the
     * on-screen render (cheap/capped) and `full: true` for copy + download.
     */
    serializer: { type: Function, default: null },
    tone: { type: String, default: 'neutral' },
    filename: { type: String, default: 'output.json' },
    previewChars: { type: Number, default: PREVIEW_CHARS },
    maxRenderChars: { type: Number, default: MAX_RENDER_CHARS },
  },
  setup(props) {
    const expanded = ref(false);
    const copied = ref(false);

    const serialize = (full) =>
      props.serializer ? props.serializer(props.value, { full }) : defaultSerialize(props.value);

    // Memoized: recomputes only when `value` changes, not on every parent
    // re-render. The previous inline `formatJSON(...)` template call
    // re-stringified the whole payload on every streaming frame.
    const display = computed(() => {
      const s = serialize(false);
      return typeof s === 'string' ? s : String(s ?? '');
    });

    watch(display, () => {
      expanded.value = false;
      copied.value = false;
    });

    const limit = computed(() => (expanded.value ? props.maxRenderChars : props.previewChars));
    const isClipped = computed(() => display.value.length > limit.value);
    const shown = computed(() =>
      isClipped.value ? `${display.value.slice(0, limit.value)}\n… [clipped for display]` : display.value,
    );
    const canExpand = computed(() => display.value.length > props.previewChars);
    const showBar = computed(() => canExpand.value);

    const sizeLabel = computed(() => formatBytes(display.value.length));
    const lineLabel = computed(() => `${countLines(display.value).toLocaleString()} lines`);
    const shownLabel = computed(() => `${limit.value.toLocaleString()} chars`);

    const copyFull = async () => {
      try {
        await navigator.clipboard.writeText(serialize(true));
        copied.value = true;
        setTimeout(() => {
          copied.value = false;
        }, 1500);
      } catch (e) {
        console.error('[BoundedJson] copy failed', e);
      }
    };

    const downloadFull = () => {
      try {
        const blob = new Blob([serialize(true)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = props.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch (e) {
        console.error('[BoundedJson] download failed', e);
      }
    };

    return {
      expanded,
      copied,
      shown,
      isClipped,
      canExpand,
      showBar,
      sizeLabel,
      lineLabel,
      shownLabel,
      copyFull,
      downloadFull,
    };
  },
};
</script>

<style scoped>
.bounded-json {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.bj-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-duller-navy);
}

.bj-meta {
  font-family: var(--font-family-mono);
}

.bj-note {
  opacity: 0.75;
}

.bj-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.bj-btn {
  padding: 2px 8px;
  font-size: 11px;
  font-family: var(--font-family);
  color: var(--color-text);
  background: rgba(127, 129, 147, 0.12);
  border: 1px solid rgba(127, 129, 147, 0.2);
  border-radius: 4px;
  cursor: pointer;
}

.bj-btn:hover {
  background: rgba(127, 129, 147, 0.22);
}

/* Verbatim copy of the .io-data rule these blocks already used, so the panels
   look exactly as they did. Do not "tidy" this — it is a deliberate duplicate. */
.bj-pre {
  background: var(--color-darker-0);
  padding: 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  max-height: 250px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--font-family-mono);
  line-height: 1.4;
}

.bounded-json.error .bj-pre {
  color: var(--color-red);
}
</style>
