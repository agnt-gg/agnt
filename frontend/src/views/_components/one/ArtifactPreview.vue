<!-- ArtifactPreview — look at a file without leaving the page.

     The chat inspector's Artifacts rows used to navigate to the Outputs
     screen on click. Most of the time you just want to SEE the thing the
     assistant made and stay in the conversation; leaving the page for a
     two-second look is the wrong trade. This is a teleported overlay that
     previews by kind (html/pdf in an iframe, media in the native element,
     text in a <pre>) and offers "Open in Files" / "Open with system" as
     small secondary actions. Esc, the backdrop, or × closes it.

     A message's path is a SNAPSHOT and files move, so the overlay asks the
     server where the bytes actually came from and acts on THAT path — see
     backend/src/utils/localFileResolve.js. When nothing can be recovered it
     says so plainly instead of showing a broken image icon. -->
<template>
  <Teleport to="body">
    <div v-if="open" class="ap-overlay" @click.self="close" tabindex="-1" ref="root">
      <div class="ap-dialog" role="dialog" :aria-label="name">
        <header class="ap-head">
          <i :class="icon" class="ap-icon"></i>
          <span class="ap-name" v-tooltip="effectivePath">{{ name }}</span>
          <span class="ap-kind">{{ kind }}</span>
          <span v-if="relocated" class="ap-moved" v-tooltip="'This message points at ' + absPath">moved</span>
          <span class="ap-spacer"></span>
          <button type="button" class="ap-link" @click="openInFiles"><i class="fas fa-cube"></i> Open in Files</button>
          <button type="button" class="ap-link" @click="openWithSystem"><i class="fas fa-external-link-alt"></i> Open with system</button>
          <button type="button" class="ap-x" aria-label="Close" @click="close"><i class="fas fa-times"></i></button>
        </header>

        <div class="ap-body">
          <!-- A loaded iframe takes focus; key events then go to ITS document
               and Esc never reaches ours. Hand focus back to the overlay on
               load so Esc works until the user deliberately clicks inside. -->
          <div v-if="status === 'missing'" class="ap-none">
            <i class="fas fa-unlink"></i>
            <p><strong>{{ name }}</strong> is no longer where this message recorded it.</p>
            <p class="ap-path">{{ absPath }}</p>
            <p>I looked for it nearby and could not find it. It was most likely deleted or moved outside this folder.</p>
          </div>
          <PdfFrame v-else-if="kind === 'pdf'" :src="url" class="ap-frame" :label="name" tabindex="-1" @load="root?.focus()" />
          <iframe v-else-if="kind === 'html'" :src="url" class="ap-frame" sandbox="allow-scripts allow-same-origin" :aria-label="name" tabindex="-1" @load="root?.focus()"></iframe>
          <img v-else-if="kind === 'image'" :src="url" :alt="name" class="ap-media" />
          <video v-else-if="kind === 'video'" :src="url" controls class="ap-media"></video>
          <audio v-else-if="kind === 'audio'" :src="url" controls class="ap-audio"></audio>
          <pre v-else-if="kind === 'text'" class="ap-text">{{ text === null ? 'Loading…' : text }}</pre>
          <div v-else class="ap-none">
            <i class="fas fa-file"></i>
            <p>No inline preview for <strong>.{{ ext || '?' }}</strong> files.</p>
            <button type="button" class="ap-btn" @click="openWithSystem">Open with system</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { buildLocalFileUrl, absolutePathFromFileUrl } from '@/utils/localFileUrl.js';
import { openLocalPath } from '@/utils/openLocalFile.js';
import PdfFrame from '@/views/_components/common/PdfFrame.vue';

const KIND_BY_EXT = {
  html: 'html', htm: 'html',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', bmp: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogg: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio',
  md: 'text', txt: 'text', json: 'text', csv: 'text', js: 'text', mjs: 'text', cjs: 'text', ts: 'text', py: 'text', css: 'text', yaml: 'text', yml: 'text', xml: 'text', log: 'text', sh: 'text', ps1: 'text', sql: 'text', vue: 'text', toml: 'text', ini: 'text', env: 'text',
};
const ICON_BY_KIND = { html: 'fas fa-file-code', pdf: 'fas fa-file-pdf', image: 'fas fa-image', video: 'fas fa-film', audio: 'fas fa-music', text: 'fas fa-file-alt', other: 'fas fa-file' };
const TEXT_LIMIT = 200_000;

export default {
  name: 'ArtifactPreview',
  components: { PdfFrame },
  emits: ['open-in-files'],
  setup(_, { emit, expose }) {
    const open = ref(false);
    const href = ref('');
    const name = ref('');
    const text = ref(null);
    const root = ref(null);
    /** 'loading' until the server confirms the bytes; 'missing' when it cannot. */
    const status = ref('loading');
    /** Where the server actually found the file, which may differ from absPath. */
    const resolvedPath = ref('');

    const absPath = computed(() => absolutePathFromFileUrl(href.value));
    const url = computed(() => (absPath.value ? buildLocalFileUrl(absPath.value) : ''));
    /** The path to ACT on — recovered when the recorded one went stale. */
    const effectivePath = computed(() => resolvedPath.value || absPath.value);
    const relocated = computed(() => Boolean(resolvedPath.value) && resolvedPath.value !== absPath.value);
    const ext = computed(() => (name.value.split('.').pop() || '').toLowerCase());
    const kind = computed(() => KIND_BY_EXT[ext.value] || 'other');
    const icon = computed(() => ICON_BY_KIND[kind.value]);

    const authHeaders = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('token') || '') });

    /**
     * Confirm the file is reachable and learn where it really is, without
     * downloading it: a one-byte Range costs nothing even for a 4 GB video.
     * 416 means the file exists but is empty — still a hit, not a miss.
     */
    async function probe() {
      status.value = 'loading';
      resolvedPath.value = '';
      if (!url.value) {
        status.value = 'missing';
        return;
      }
      const requested = url.value;
      try {
        const res = await fetch(requested, { headers: { ...authHeaders(), Range: 'bytes=0-0' } });
        if (requested !== url.value) return; // superseded by a newer show()
        if (!res.ok && res.status !== 416) {
          status.value = 'missing';
          return;
        }
        const header = res.headers.get('X-Local-File-Path');
        if (header) {
          try {
            resolvedPath.value = decodeURI(header);
          } catch {
            resolvedPath.value = header;
          }
        }
        status.value = 'ok';
      } catch {
        if (requested === url.value) status.value = 'missing';
      }
    }

    async function loadText() {
      text.value = null;
      try {
        const res = await fetch(url.value, { headers: authHeaders() });
        const body = await res.text();
        text.value = body.length > TEXT_LIMIT ? body.slice(0, TEXT_LIMIT) + `\n\n… (${body.length - TEXT_LIMIT} more characters — Open in Files for the whole file)` : body;
      } catch (e) {
        text.value = `Could not load file: ${e?.message || e}`;
      }
    }

    // Only fetch the body once the probe says there IS one, so a stale path
    // renders the missing panel instead of a 404 payload in a <pre>.
    watch([open, kind, url, status], ([isOpen, k, u, s]) => {
      if (isOpen && s === 'ok' && k === 'text' && u) loadText();
    });

    // Esc is listened for on the document, not the overlay: an HTML/PDF
    // preview is an iframe, and once it has focus the overlay never sees the
    // key. Capture phase so the iframe's own handlers cannot swallow it.
    function onKey(e) {
      if (e.key === 'Escape' && open.value) {
        e.stopPropagation();
        close();
      }
    }
    function show(artifact) {
      href.value = artifact?.href || '';
      name.value = artifact?.name || href.value.split(/[\\/]/).pop() || '';
      open.value = true;
      document.addEventListener('keydown', onKey, true);
      nextTick(() => root.value?.focus());
      probe();
    }
    function close() {
      open.value = false;
      text.value = null;
      status.value = 'loading';
      resolvedPath.value = '';
      document.removeEventListener('keydown', onKey, true);
    }
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true));
    function openInFiles() {
      const a = { href: href.value, name: name.value };
      close();
      emit('open-in-files', a);
    }
    function openWithSystem() {
      openLocalPath(effectivePath.value);
    }

    expose({ show, close });
    return { open, name, absPath, effectivePath, relocated, status, url, ext, kind, icon, text, root, close, openInFiles, openWithSystem };
  },
};
</script>

<style scoped>
.ap-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  outline: none;
}
.ap-dialog {
  width: min(1200px, 100%);
  height: min(86vh, 100%);
  display: flex;
  flex-direction: column;
  background: var(--surface-raised);
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.ap-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 8px 14px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 12.5px;
  min-width: 0;
}
.ap-icon { color: var(--color-text-muted); }
.ap-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.ap-kind {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  padding: 1px 5px;
}
.ap-moved {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-yellow);
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 1px 5px;
  opacity: 0.85;
}
.ap-spacer { flex: 1; }
.ap-link,
.ap-x,
.ap-btn {
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 11.5px;
  padding: 5px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.ap-link:hover,
.ap-x:hover { color: var(--color-text); background: var(--surface-hover); border-color: var(--terminal-border-color); }
.ap-link i { margin-right: 4px; font-size: 10.5px; }
.ap-x { padding: 5px 9px; }
.ap-body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background);
}
.ap-frame { width: 100%; height: 100%; border: 0; background: #fff; }
.ap-media { max-width: 100%; max-height: 100%; object-fit: contain; }
.ap-audio { width: min(640px, 90%); }
.ap-text {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 14px 16px;
  overflow: auto;
  font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text);
}
.ap-none {
  text-align: center;
  color: var(--color-text-muted);
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}
.ap-none i { font-size: 34px; }
.ap-none p { margin: 0; max-width: 60ch; }
.ap-path {
  font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 11px;
  word-break: break-all;
  opacity: 0.75;
}
.ap-btn { border-color: var(--terminal-border-color); color: var(--color-text); }
.ap-btn:hover { background: var(--surface-hover); }
</style>
