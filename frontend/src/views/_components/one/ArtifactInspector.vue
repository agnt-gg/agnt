<template>
  <section class="artifact-inspector" aria-label="Artifact preview">
    <header><strong>{{ artifact.name || 'Artifact' }}</strong><button type="button" @click="$emit('expand')" aria-label="Expand artifact inspector"><i class="fas fa-expand"></i></button><button type="button" @click="$emit('close')" aria-label="Close artifact preview"><i class="fas fa-times"></i></button></header>
    <nav aria-label="Artifact views"><button v-for="mode in modes" :key="mode" :class="{active:tab===mode}" @click="tab=mode">{{ mode }}</button></nav>
    <div class="artifact-body" :class="{'markdown-body':artifact.kind==='markdown' && tab==='Preview'}">
      <p v-if="loading" role="status">Loading preview…</p>
      <div v-else-if="error" role="alert"><p>{{ error }}</p><button @click="load">Retry</button></div>
      <dl v-else-if="tab==='Details'"><dt>Type</dt><dd>{{ artifact.kind }}</dd><dt>Location</dt><dd>{{ effectivePath || 'This conversation' }}</dd><dt v-if="artifact.messageId">Message</dt><dd v-if="artifact.messageId">{{ artifact.messageId }}</dd></dl>
      <ArtifactFileCover v-else-if="['archive','file'].includes(artifact.kind)" :item="artifact" />
      <pre v-else-if="tab==='Source' || artifact.kind==='text'">{{ source }}</pre>
      <iframe v-else-if="artifact.kind==='html'" :key="artifact.id" :src="url || undefined" :srcdoc="url ? undefined : inlineHtml" sandbox="allow-scripts" referrerpolicy="no-referrer" :aria-label="artifact.name"></iframe>
      <iframe v-else-if="artifact.kind==='pdf'" :src="url" sandbox="" :aria-label="artifact.name"></iframe>
      <img v-else-if="artifact.kind==='image'" :src="url" :alt="artifact.name" @error="mediaError" />
      <video v-else-if="artifact.kind==='video'" :src="url" controls @error="mediaError"></video>
      <audio v-else-if="artifact.kind==='audio'" :src="url" controls @error="mediaError"></audio>
      <div v-else-if="artifact.kind==='markdown'" class="markdown-preview ce-markdown-preview" v-html="markdown"></div>
      <div v-else-if="artifact.kind==='csv'" class="table-wrap"><table><tbody><tr v-for="(row,i) in table" :key="i"><td v-for="(cell,j) in row" :key="j">{{ cell }}</td></tr></tbody></table><p v-if="table.length>=201">Preview limited to 200 data rows.</p></div>
      <p v-else>No preview available. Open the original file.</p>
      <p v-if="truncated" class="muted">Preview limited to 200 KB. Open the original for the full content.</p>
    </div>
    <footer><button v-if="artifact.href" @click="openOriginal">Open file</button><button v-if="!artifact.href && textual" @click="download" :disabled="loading || !!error">Download</button><button v-if="!artifact.href && textual" @click="copy" :disabled="loading">{{ copied ? 'Copied' : 'Copy source' }}</button></footer>
  </section>
</template>
<script setup>
import ArtifactFileCover from './ArtifactFileCover.vue';
import '@/styles/components/artifactMarkdown.css';
import {
  computed,
  onBeforeUnmount,
  ref,
  watch
} from 'vue';
import DOMPurify from 'dompurify';
import {
  renderMarkdown
} from '@/utils/markdownPipeline.js';
import {
  parseCsv
} from '@/utils/chatArtifacts.js';
import {
  buildLocalFileUrl,
  absolutePathFromFileUrl,
  rewriteLocalFileURLsInHTML
} from '@/utils/localFileUrl.js';
import {
  openLocalPath
} from '@/utils/openLocalFile.js';
const props = defineProps({
  artifact: {
    type: Object,
    required: true
  }
});
defineEmits(['close', 'expand']);
const tab = ref('Preview'),
  source = ref(''),
  loading = ref(false),
  error = ref(''),
  resolvedPath = ref(''),
  truncated = ref(false),
  copied = ref(false);
let controller = null,
  epoch = 0;
const effectivePath = computed(() => resolvedPath.value || absolutePathFromFileUrl(props.artifact.href));
const url = computed(() => props.artifact.href ? buildLocalFileUrl(effectivePath.value) : props.artifact.kind === 'image' && /^https?:/.test(props.artifact.url || '') ? props.artifact.url : '');
const textual = computed(() => ['html', 'markdown', 'csv', 'text'].includes(props.artifact.kind));
const modes = computed(() => textual.value ? ['Preview', 'Source', 'Details'] : ['Preview', 'Details']);
const inlineHtml = computed(() => rewriteLocalFileURLsInHTML(source.value, {
  baseDir: props.artifact.baseDir
}));
const markdown = computed(() => DOMPurify.sanitize(renderMarkdown(source.value), {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input']
}));
const table = computed(() => parseCsv(source.value));
async function load() {
  controller?.abort();
  const current = ++epoch;
  controller = new AbortController();
  const signal = controller.signal;
  source.value = '';
  resolvedPath.value = '';
  error.value = '';
  truncated.value = !!props.artifact.truncated;
  copied.value = false;
  if (!props.artifact.href) {
    source.value = props.artifact.source || '';
    loading.value = false;
    return
  }
  if (!absolutePathFromFileUrl(props.artifact.href)) {
    error.value = 'Invalid file reference.';
    loading.value = false;
    return
  }
  loading.value = true;
  try {
    const headers = {
      Authorization: 'Bearer ' + (localStorage.getItem('token') || ''),
      Range: 'bytes=0-0'
    };
    const response = await fetch(url.value, {
      headers,
      signal
    });
    if (current !== epoch) {
      await response.body?.cancel();
      return
    }
    if (!response.ok && response.status !== 416) throw Error(response.status === 404 ? 'This file is no longer available.' : response.status === 401 || response.status === 403 ? 'You do not have access to this file.' : 'Preview request failed (' + response.status + ').');
    const actual = response.headers.get('X-Local-File-Path');
    let recovered = '';
    if (actual) {
      try {
        recovered = decodeURI(actual)
      } catch {
        recovered = actual
      }
    }
    let content = '';
    if (textual.value && response.status !== 416) {
      const total = Number((response.headers.get('Content-Range') || '').split('/')[1]);
      await response.body?.cancel();
      const readHeaders = {
        Authorization: headers.Authorization
      };
      if (Number.isFinite(total) && total > 0) readHeaders.Range = 'bytes=0-' + Math.min(total - 1, 199999);
      const bodyResponse = await fetch(url.value, {
        headers: readHeaders,
        signal
      });
      if (!bodyResponse.ok) throw Error('Could not read this file (' + bodyResponse.status + ').');
      if (current !== epoch) {
        await bodyResponse.body?.cancel();
        return
      }
      truncated.value = Number.isFinite(total) && total > 200000;
      if (bodyResponse.body?.getReader) {
        const reader = bodyResponse.body.getReader(),
          decoder = new TextDecoder();
        let bytes = 0;
        try {
          while (bytes <= 200000) {
            const {
              done,
              value
            } = await reader.read();
            if (done) break;
            const remaining = 200000 - bytes;
            content += decoder.decode(value.subarray(0, Math.max(0, remaining)), {
              stream: true
            });
            bytes += value.length;
            if (bytes >= 200000) {
              if (current === epoch) truncated.value = !Number.isFinite(total) || total > 200000;
              await reader.cancel();
              break
            }
          }
          content += decoder.decode()
        } finally {
          reader.releaseLock()
        }
      } else content = (await bodyResponse.text()).slice(0, 200000);
    } else await response.body?.cancel();
    if (current !== epoch) return;
    resolvedPath.value = recovered;
    source.value = content;
  } catch (e) {
    if (current === epoch && e.name !== 'AbortError') {
      error.value = e.message;
      console.warn('[ArtifactInspector]', e.message)
    }
  } finally {
    if (current === epoch) loading.value = false
  }
}

function mediaError() {
  error.value = 'The media could not be loaded. Open the original file or retry.'
}

function openOriginal() {
  if (effectivePath.value) openLocalPath(effectivePath.value)
}

function download() {
  if (props.artifact.href) {
    openOriginal();
    return
  }
  const blob = URL.createObjectURL(new Blob([source.value], {
    type: 'text/plain;charset=utf-8'
  }));
  const a = document.createElement('a');
  a.href = blob;
  a.download = (props.artifact.name || 'artifact') + '.' + (props.artifact.language || 'txt');
  a.click();
  setTimeout(() => URL.revokeObjectURL(blob), 1000)
}
async function copy() {
  try {
    await navigator.clipboard.writeText(source.value);
    copied.value = true
  } catch (e) {
    error.value = 'Could not copy: ' + e.message
  }
}
watch(() => props.artifact, () => {
  tab.value = 'Preview';
  load()
}, {
  immediate: true
});
onBeforeUnmount(() => {
  epoch++;
  controller?.abort()
});
</script>
<style scoped>
.artifact-inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--color-popup);
  color: var(--color-text)
}

header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 13px;
  border-bottom: 1px solid var(--terminal-border-color)
}

header strong {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere
}

button {
  font: inherit;
  font-size: 12px;
  padding: 7px 9px;
  background: none;
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
  border-radius: 5px;
  cursor: pointer
}

button:disabled {
  opacity: .5;
  cursor: default
}

button:focus-visible {
  outline: 2px solid var(--color-primary)
}

nav {
  display: flex;
  gap: 10px;
  padding: 8px 13px;
  border-bottom: 1px solid var(--terminal-border-color)
}

nav button {
  border-color: transparent;
  color: var(--color-text-muted)
}

nav .active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary)
}

.artifact-body {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 15px;
  font-size: 13px;
  line-height: 1.6
}

.artifact-body:has(iframe) {
  padding: 0;
  display: flex;
  flex-direction: column
}

iframe {
  border: 0;
  flex: 1;
  width: 100%;
  min-height: 400px;
  background: white
}

img,
video,
audio {
  max-width: 100%;
  display: block;
  margin: auto
}

pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.7 'Fira Code', monospace;
  margin: 0
}

dd {
  margin: 0 0 12px;
  overflow-wrap: anywhere
}

dt,
.muted {
  color: var(--color-text-muted);
  font-size: 11px
}

.table-wrap {
  overflow: auto
}

table {
  border-collapse: collapse;
  width: 100%
}

td {
  padding: 7px 10px;
  border: 1px solid var(--terminal-border-color);
  white-space: pre-wrap
}

.artifact-body.markdown-body {
  padding:20px 24px;
  background:var(--color-darker-1);
  font-size:14px;
  line-height:1.7;
}

.markdown-preview :deep(img) {
  max-width: 100%
}

footer {
  padding: 12px;
  border-top: 1px solid var(--terminal-border-color);
  display: flex;
  gap: 7px;
  flex-wrap: wrap
}
</style>
