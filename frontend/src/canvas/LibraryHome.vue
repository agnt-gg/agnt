<template>
  <section class="library-home main-panel" aria-label="Library">
    <header><h1>Library</h1><input v-model="query" type="search" aria-label="Find a library collection" placeholder="Find a collection…" /></header>
    <div class="library-grid">
      <button v-for="item in filtered" :key="item.screen" @click="$emit('navigate',item.screen,{})">
        <i :class="item.icon" aria-hidden="true"></i><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span><i class="fas fa-arrow-right" aria-hidden="true"></i>
      </button>
      <button v-if="!query || 'shared team assets'.includes(query.toLowerCase())" @click="$emit('teams')"><i class="fas fa-users" aria-hidden="true"></i><span><strong>Shared assets</strong><small>Your team’s versioned library</small></span><i class="fas fa-arrow-right" aria-hidden="true"></i></button>
    </div>
  </section>
</template>
<script setup>
import {computed,ref} from 'vue';
defineEmits(['navigate','teams']);
const query=ref('');
const collections=[
 {screen:'ArtifactsScreen',label:'Files',icon:'fas fa-folder',description:'Documents, media, and generated outputs'},
 {screen:'AgentsScreen',label:'Agents',icon:'fas fa-robot',description:'Your reusable assistants'},
 {screen:'WorkflowsScreen',label:'Workflows',icon:'fas fa-project-diagram',description:'Saved processes and automations'},
 {screen:'ToolsScreen',label:'Tools',icon:'fas fa-wrench',description:'Capabilities your agents can use'},
 {screen:'SkillsScreen',label:'Skills',icon:'fas fa-graduation-cap',description:'Reusable instructions and methods'},
 {screen:'MemoryScreen',label:'Memory',icon:'fas fa-brain',description:'Saved knowledge and preferences'},
 {screen:'WidgetManagerScreen',label:'Widgets',icon:'fas fa-shapes',description:'Reusable workspace components'},
 {screen:'PluginsScreen',label:'Plugins',icon:'fas fa-puzzle-piece',description:'Installed app extensions'},
 {screen:'MarketplaceScreen',label:'Market',icon:'fas fa-store',description:'Discover more assets and extensions'},
];
const filtered=computed(()=>collections.filter(item=>(item.label+' '+item.description).toLowerCase().includes(query.value.trim().toLowerCase())));
</script>
<style scoped>
.library-home{height:100%;min-height:0;overflow:auto;color:var(--color-text);background:var(--color-background)}header{display:flex;align-items:center;gap:24px;padding:16px 22px;border-bottom:1px solid var(--terminal-border-color)}h1{font-size:19px;font-weight:500;margin:0}input{margin-left:auto;max-width:360px;width:60%;font:inherit;font-size:13px;padding:9px 11px;background:var(--color-darker-0);color:var(--color-text);border:1px solid var(--terminal-border-color);border-radius:6px}.library-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px;padding:22px}.library-grid button{display:flex;align-items:center;gap:13px;min-width:0;padding:17px;border:1px solid var(--terminal-border-color);border-radius:8px;background:none;color:var(--color-text);text-align:left;cursor:pointer;font:inherit}.library-grid button:hover{background:rgba(var(--primary-rgb),.07)}button>i:first-child{color:var(--color-primary);width:18px}button>span{flex:1;min-width:0}strong{font-size:14px;font-weight:500;display:block}small{font-size:12px;color:var(--color-text-muted);display:block;margin-top:6px;line-height:1.5}button>i:last-child{font-size:11px;color:var(--color-text-muted)}button:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}@media(max-width:600px){header{padding:13px 15px}.library-grid{padding:15px}}
</style>
