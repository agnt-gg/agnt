<template>
  <div v-if="artifacts.length" class="artifact-cards" aria-label="Outputs from this message">
    <article v-for="item in artifacts" :key="item.id" class="artifact-card" :class="{'primary-artifact':item.kind==='html'}">
      <header class="artifact-top"><span class="type-icon"><i :class="icons[item.kind] || 'fas fa-file-code'" aria-hidden="true"></i></span><span class="artifact-format">{{ item.language || item.kind }}</span><span class="artifact-version">{{ item.href ? 'FILE' : 'OUTPUT' }}</span></header>
      <button type="button" class="artifact-preview" :aria-label="'Preview '+title(item)" @click="inspect(item)"><ArtifactThumbnail :item="item" /><span class="preview-arrow" aria-hidden="true">↗</span></button>
      <div class="artifact-info"><h3>{{ title(item) }}</h3><p>{{ descriptions[item.kind] || 'Source code and generated content.' }}</p></div>
      <footer class="artifact-card-actions"><span class="artifact-meta">{{ item.href ? 'Workspace file' : 'Conversation output' }}</span><button class="open-preview" type="button" @click="inspect(item)">Open preview <i class="fas fa-arrow-right" aria-hidden="true"></i></button><button v-if="item.href" type="button" @click="openFile(item)">Open file</button><button v-if="item.kind==='html'" type="button" @click="$emit('share',item)">Share</button></footer>
    </article>
  </div>
</template>
<script setup>
import { computed } from 'vue';
import ArtifactThumbnail from './ArtifactThumbnail.vue';
import {
  useStore
} from 'vuex';
import {
  collectChatArtifacts
} from '@/utils/chatArtifacts.js';
import {
  findMatchingFileOnDisk,
  getBaseDirFromToolCalls
} from '@/utils/htmlBlockFilePairing.js';
import {
  absolutePathFromFileUrl
} from '@/utils/localFileUrl.js';
import {
  openLocalPath
} from '@/utils/openLocalFile.js';
const props = defineProps({
  content: {
    type: String,
    default: ''
  },
  toolCalls: {
    type: Array,
    default: () => []
  },
  messageId: {
    type: String,
    default: ''
  }
});
defineEmits(['share']);
const store = useStore();
const artifacts = computed(() => {
  const found = collectChatArtifacts(props.content, props.messageId);
  return found.map(item => {
    if (item.kind !== 'html' || item.href) return item;
    const path = findMatchingFileOnDisk(item.source, props.toolCalls);
    if (path) return {
      ...item,
      href: 'file:///' + path.replace(/\\/g, '/'),
      name: path.split(/[\\/]/).pop()
    };
    return {
      ...item,
      baseDir: getBaseDirFromToolCalls(props.toolCalls)
    };
  }).filter((item, i, all) => !item.href || all.findIndex(other => other.href === item.href) === i);
});
const descriptions={html:'Interactive page · inspect without leaving the conversation.',markdown:'Document · formatted text and source.',csv:'Table · preview rows and data.',image:'Image · open the full-size output.',video:'Video · open playback in the preview panel.',audio:'Audio · open playback in the preview panel.',pdf:'Document · open the PDF to read it.',archive:'Archive · open the file to explore its contents.',file:'File · open with a compatible app.'};
function title(item){if(item.href)return item.name;const source=item.source||'';if(item.kind==='html'){const match=source.match(/<title[^>]*>([^<]+)<\/title>/i)||source.match(/<h1[^>]*>([^<]+)<\/h1>/i);if(match)return match[1].trim().slice(0,100)}if(item.kind==='markdown'){const match=source.match(/^#\s+(.+)$/m);if(match)return match[1].trim().slice(0,100)}return item.name}
const icons = {
  html: 'fas fa-file-code',
  markdown: 'fas fa-file-alt',
  csv: 'fas fa-table',
  image: 'fas fa-image',
  video: 'fas fa-film',
  audio: 'fas fa-music',
  pdf: 'fas fa-file-pdf',
  archive:'fas fa-file-archive',file:'fas fa-file'
};

function inspect(item) {
  store.dispatch('shell/inspect', {
    kind: 'artifact',
    id: item.id,
    screen: 'ChatScreen',
    payload: item
  });
}

function openFile(item) {
  openLocalPath(absolutePathFromFileUrl(item.href));
}
</script>
<style scoped>
/* Same anatomy and spacing as the approved delivery artifact cards. */
.artifact-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:13px;margin:14px 0 17px;width:100%;min-width:0}
.artifact-card{min-width:0;border:1px solid var(--terminal-border-color-light,var(--terminal-border-color));border-radius:10px;background:var(--color-darker-0);box-shadow:0 5px 13px #0004,inset 0 1px #ffffff06;overflow:hidden;display:flex;flex-direction:column}
.artifact-card:hover{border-color:var(--color-text-muted);box-shadow:0 6px 19px #0005}.artifact-top{padding:11px 13px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--terminal-border-color);min-width:0}.type-icon{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;background:rgba(var(--primary-rgb),.05);color:var(--color-primary);border:1px solid rgba(var(--primary-rgb),.2);flex-shrink:0;font-size:14px}.artifact-format{font:400 9px 'Fira Code',monospace;letter-spacing:.04em;color:var(--color-text-muted);text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artifact-version{font:400 9px 'Fira Code',monospace;margin-left:auto;color:var(--color-text-muted);white-space:nowrap}
.artifact-card .artifact-preview{height:145px;min-height:145px;border:0;border-bottom:1px solid var(--terminal-border-color);border-radius:0;display:block;text-align:initial;width:100%;background:var(--color-background);position:relative;overflow:hidden;padding:0;cursor:pointer;color:inherit}.preview-arrow{position:absolute;right:9px;bottom:9px;display:grid;place-items:center;width:25px;height:25px;border:1px solid var(--terminal-border-color-light);border-radius:6px;background:var(--color-popup);color:var(--color-text);font-size:14px;opacity:0}.artifact-preview:hover .preview-arrow,.artifact-preview:focus-visible .preview-arrow{opacity:1}.artifact-info{padding:13px 14px 12px;flex:1}.artifact-info h3{font-size:15px;font-weight:500;line-height:1.22;letter-spacing:-.01em;margin:0 0 5px;overflow-wrap:anywhere}.artifact-info p{font-size:12px;line-height:1.4;color:var(--color-text-muted);margin:0}.artifact-card-actions{margin:0 13px;padding:11px 0 12px;border-top:1px solid var(--terminal-border-color);display:flex;align-items:center;flex-wrap:wrap;gap:8px}.artifact-meta{font-size:10px;color:var(--color-text-muted);flex:1;min-width:80px}.artifact-card button{font:inherit;font-size:11px;min-height:30px;padding:7px 10px;border:1px solid var(--terminal-border-color-light,var(--terminal-border-color));border-radius:5px;background:var(--color-darker-0);color:var(--color-text);cursor:pointer}.primary-artifact{border-color:rgba(var(--primary-rgb),.3)}.primary-artifact .open-preview{border-color:rgba(var(--primary-rgb),.3);background:rgba(var(--primary-rgb),.06);color:var(--color-primary)}.open-preview i{margin-left:5px;font-size:11px}button:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}@media(max-width:520px){.artifact-top{padding:9px}.artifact-info{padding:11px}.artifact-card-actions{margin-inline:9px}.artifact-meta{flex-basis:100%}.artifact-card button{padding:7px}.artifact-info h3{font-size:14px}}
</style>
