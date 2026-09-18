<template>
  <div class="file-cover" :class="'file-cover-'+kind">
    <div class="file-cover-symbol"><i :class="symbol" aria-hidden="true"></i><span>{{ extension }}</span></div>
    <strong>{{ label }}</strong>
    <small>{{ unavailable ? 'Preview unavailable · open the original file' : hint }}</small>
  </div>
</template>
<script setup>
import {computed} from 'vue';
const props=defineProps({item:{type:Object,required:true},unavailable:{type:Boolean,default:false}});
const kind=computed(()=>props.item.kind||'file');
const extension=computed(()=>{const match=String(props.item.name||'').match(/\.([a-z0-9]{1,8})$/i);return match?match[1].toUpperCase():kind.value==='pdf'?'PDF':kind.value==='archive'?'ZIP':kind.value.toUpperCase()});
const symbol=computed(()=>({pdf:'fas fa-file-pdf',archive:'fas fa-file-archive',image:'fas fa-image',video:'fas fa-film',audio:'fas fa-music',markdown:'fas fa-file-alt',csv:'fas fa-table',text:'fas fa-file-code'})[kind.value]||'fas fa-file');
const label=computed(()=>({pdf:'PDF document',archive:'File archive',image:'Image',video:'Video',audio:'Audio',markdown:'Document',csv:'Table',text:'Text document'})[kind.value]||'Downloadable file');
const hint=computed(()=>kind.value==='pdf'?'Open the document to read it':kind.value==='archive'?'Open the file to explore its contents':'Open the original file to view it');
</script>
<style scoped>
.file-cover{height:100%;min-height:145px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:16px;text-align:center;background:linear-gradient(135deg,rgba(var(--primary-rgb),.055),transparent 65%);color:var(--color-text)}.file-cover-symbol{position:relative;display:grid;place-items:center;width:48px;height:53px;border:1px solid var(--terminal-border-color-light,var(--terminal-border-color));border-radius:9px;background:var(--color-darker-0);margin-bottom:5px}.file-cover-symbol i{font-size:24px;color:var(--color-primary)}.file-cover-symbol span{position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);font:500 8px/1.2 'Fira Code',monospace;letter-spacing:.05em;border:1px solid rgba(var(--primary-rgb),.25);background:var(--color-popup);color:var(--color-primary);padding:3px 5px;border-radius:4px;white-space:nowrap}.file-cover strong{font-size:12px;line-height:1.3;font-weight:500}.file-cover small{font-size:10px;line-height:1.45;color:var(--color-text-muted);max-width:100%;overflow-wrap:anywhere}
</style>
