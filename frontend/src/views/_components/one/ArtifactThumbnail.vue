<template>
  <div class="thumbnail" aria-hidden="true">
    <ArtifactFileCover v-if="error || ['pdf','archive','file'].includes(item.kind)" :item="item" :unavailable="error" />
    <img v-else-if="item.kind==='image'" :src="url" alt="" loading="lazy" @error="error=true" />
    <video v-else-if="item.kind==='video'" :src="url" preload="metadata" muted @error="error=true"></video>
    <div v-else-if="item.kind==='audio'" class="audio"><i class="fas fa-music"></i><span>{{ item.name }}</span></div>
    <iframe v-else-if="item.kind==='html'" :src="url || undefined" :srcdoc="url ? undefined : safeHtml" sandbox="" tabindex="-1" loading="lazy" referrerpolicy="no-referrer" aria-label="HTML thumbnail"></iframe>
    <div v-else-if="loading" class="fallback">Loading preview…</div>
    <ArtifactFileCover v-else-if="!text.trim() && !['image','video','html','audio'].includes(item.kind)" :item="item" />
    <div v-else-if="item.kind==='markdown'" class="document" v-html="markdown"></div>
    <table v-else-if="item.kind==='csv'"><tbody><tr v-for="(row,i) in rows" :key="i"><td v-for="(cell,j) in row" :key="j">{{ cell }}</td></tr></tbody></table>
    <pre v-else>{{ text || item.name }}</pre>
    <span v-if="item.kind==='video' && !error" class="play"><i class="fas fa-play"></i></span>
  </div>
</template>
<script setup>
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import ArtifactFileCover from './ArtifactFileCover.vue';
import DOMPurify from 'dompurify';
import {renderMarkdown} from '@/utils/markdownPipeline.js';
import {parseCsv} from '@/utils/chatArtifacts.js';
import {buildLocalFileUrl,absolutePathFromFileUrl,rewriteLocalFileURLsInHTML} from '@/utils/localFileUrl.js';
const props=defineProps({item:{type:Object,required:true}});
const text=ref(''),loading=ref(false),error=ref(false);let controller,epoch=0;
const url=computed(()=>props.item.href?buildLocalFileUrl(absolutePathFromFileUrl(props.item.href)):props.item.url||'');
const safeHtml=computed(()=>rewriteLocalFileURLsInHTML(props.item.source||'',{baseDir:props.item.baseDir}));
const markdown=computed(()=>DOMPurify.sanitize(renderMarkdown(text.value),{FORBID_TAGS:['iframe','script','object','embed','form','input']}));
const rows=computed(()=>parseCsv(text.value,6,4));
watch(()=>props.item,async item=>{
 controller?.abort();controller=new AbortController();const signal=controller.signal,current=++epoch;error.value=false;loading.value=false;text.value=item.source||'';
 if(!item.href||!['text','markdown','csv'].includes(item.kind))return;
 loading.value=true;
 try{
  const headers={Authorization:'Bearer '+(localStorage.getItem('token')||''),Range:'bytes=0-0'};
  const probe=await fetch(url.value,{headers,signal});if(current!==epoch){await probe.body?.cancel();return}
  if(probe.status===416)return;if(!probe.ok)throw Error('Thumbnail unavailable');
  const size=Number((probe.headers.get('Content-Range')||'').split('/')[1]);await probe.body?.cancel();
  if(!Number.isFinite(size)||size<1)throw Error('Unknown file size');
  const response=await fetch(url.value,{headers:{...headers,Range:'bytes=0-'+Math.min(size-1,11999)},signal});if(!response.ok)throw Error('Thumbnail unavailable');
  const reader=response.body?.getReader();let value='';if(reader){const decoder=new TextDecoder();let bytes=0;try{while(bytes<12000){const chunk=await reader.read();if(chunk.done)break;value+=decoder.decode(chunk.value.subarray(0,12000-bytes),{stream:true});bytes+=chunk.value.length;}value+=decoder.decode();await reader.cancel();}finally{reader.releaseLock()}}else value=(await response.text()).slice(0,12000);
  if(current===epoch){if(/[\x00-\x08\x0e-\x1f]/.test(value))error.value=true;else text.value=value;}
 }catch(e){if(current===epoch&&e.name!=='AbortError')error.value=true}finally{if(current===epoch)loading.value=false}
},{immediate:true});
onBeforeUnmount(()=>{epoch++;controller?.abort()});
</script>
<style scoped>
.thumbnail{height:145px;width:100%;position:relative;overflow:hidden;background:var(--color-background);pointer-events:none;color:var(--color-text)}img,video{display:block;width:100%;height:100%;object-fit:cover}iframe{width:800px;height:460px;border:0;transform:scale(.4);transform-origin:top left;background:white;pointer-events:none}pre{font:10px/1.6 'Fira Code',monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:15px}.document{padding:15px 20px;font-size:10px;line-height:1.6}.document :deep(h1),.document :deep(h2){font-size:18px;line-height:1.2;margin:0 0 9px}.document :deep(img){max-width:100%}table{border-collapse:collapse;width:100%;font-size:10px}td{padding:8px;border:1px solid var(--terminal-border-color);max-width:100px;overflow:hidden;white-space:nowrap}tr:first-child{font-weight:500;background:var(--color-darker-0)}.fallback,.audio{display:flex;align-items:center;justify-content:center;gap:10px;height:100%;padding:20px;color:var(--color-text-muted);font-size:12px}.audio{flex-direction:column}.audio i{font-size:30px;color:var(--color-primary)}.play{position:absolute;inset:0;display:grid;place-items:center;color:var(--color-text);font-size:24px}
</style>
