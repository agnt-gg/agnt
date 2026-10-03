<template>
  <section class="m-file-browser" data-mobile-view="files-browser">
    <header><div><h1>Files</h1><small>{{ directory || 'Workspace' }}</small></div><button type="button" @click="$emit('manage')"><i class="fas fa-ellipsis-h"></i><span>Manage</span></button></header>
    <label class="m-file-search"><i class="fas fa-search" aria-hidden="true"></i><input v-model="query" placeholder="Search this folder" aria-label="Search this folder" /></label>
    <button v-if="directory" type="button" class="m-folder-back" @click="load(parentDirectory)"><i class="fas fa-arrow-left"></i>Parent folder</button>
    <div v-if="error" class="m-file-error" role="alert"><p>{{ error }}</p><button @click="load(directory)">Retry</button></div>
    <p v-else-if="loading" role="status">Loading files…</p>
    <div v-else class="m-files"><button v-for="item in filtered" :key="item.path" type="button" class="m-file" @click="isDirectory(item) ? load(item.path) : $emit('open', item.path)"><span class="m-file-icon"><i :class="isDirectory(item) ? 'fas fa-folder' : 'fas fa-file-alt'" aria-hidden="true"></i></span><span class="m-file-copy"><strong>{{ item.name }}</strong><small>{{ isDirectory(item) ? 'Folder' : fileKind(item.name) }}</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i></button><p v-if="!filtered.length" class="m-file-empty">{{ query ? 'No files match this search.' : 'This folder is empty.' }}</p></div>
    <MarketplaceShelf asset-type="file" variant="strip" fallback-to-all @browse="item => $emit('market', item)" />
    <button type="button" class="m-file-add" @click="$emit('manage')"><i class="fas fa-plus"></i>Upload, create or manage files</button>
  </section>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import { getTree } from '@/services/fileSystemService.js';
defineEmits(['open','manage','market']);
const directory=ref(''),query=ref(''),items=ref([]),loading=ref(false),error=ref('');let requestVersion=0;
const isDirectory=item=>item.type==='directory'||item.type==='folder'||item.isDirectory===true;
const parentDirectory=computed(()=>directory.value.split('/').slice(0,-1).join('/'));
const filtered=computed(()=>items.value.filter(item=>item.name.toLowerCase().includes(query.value.toLowerCase())).slice().sort((a,b)=>Number(isDirectory(b))-Number(isDirectory(a))||a.name.localeCompare(b.name)));
const fileKind=name=>{const ext=name.split('.').at(-1).toUpperCase();return ext===name.toUpperCase()?'File':ext+' file';};
async function load(path=directory.value){const version=++requestVersion;loading.value=true;error.value='';try{const response=await getTree(path);if(version!==requestVersion)return;items.value=response.items||[];directory.value=path;query.value='';}catch(e){if(version===requestVersion)error.value=e.message;}finally{if(version===requestVersion)loading.value=false;}}
onMounted(()=>load());defineExpose({refresh:()=>load()});
</script>
<style scoped>
section,header,label,article,button,input,span,div{box-sizing:border-box}
.m-file-browser{display:flex;flex-direction:column;gap:16px;padding:20px 15px 28px;box-sizing:border-box;flex:1;min-height:0;overflow:auto;color:var(--color-text);background:var(--color-background)}header{display:flex;justify-content:space-between;align-items:center;gap:12px}h1{font-size:23px;letter-spacing:-.03em;font-weight:600;margin:0 0 6px}header small{font-size:11px;color:var(--color-text-muted);overflow-wrap:anywhere}button{font-family:inherit;cursor:pointer;min-height:44px}header button{display:flex;gap:7px;align-items:center;border:1px solid var(--terminal-border-color);border-radius:9px;background:none;color:var(--color-text);padding:9px 12px;font-size:12px}.m-file-search{display:flex;gap:10px;align-items:center;border:1px solid var(--terminal-border-color);border-radius:11px;padding:0 12px;color:var(--color-text-muted)}input{min-height:46px;min-width:0;flex:1;width:100%;background:none;border:0;color:var(--color-text);font-size:16px}.m-file{display:flex;gap:12px;align-items:center;text-align:left;width:100%;border:0;border-bottom:1px solid var(--terminal-border-color);background:none;color:var(--color-text);padding:14px 0;min-height:76px}.m-file-copy{flex:1;min-width:0}.m-file strong{display:block;font-size:14px;font-weight:500;overflow-wrap:anywhere}.m-file small{font-size:11px;color:var(--color-text-muted);display:block;margin-top:5px}.m-file-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;border:1px solid var(--terminal-border-color);color:var(--color-green);background:var(--color-darker-0)}.m-file>i{color:var(--color-text-muted);font-size:11px}.m-file-add,.m-folder-back{border:1px solid var(--terminal-border-color);border-radius:10px;color:var(--color-text);background:var(--color-darker-0);padding:12px;font-size:12px;display:flex;align-items:center;gap:9px}.m-file-empty,.m-file-error{padding:24px 8px;font-size:13px;color:var(--color-text-muted);line-height:1.6}.m-file-error{color:var(--color-red)}
</style>
