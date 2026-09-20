<template>
  <section class="shared-canvas">
    <header><strong>{{ workspace.name }}</strong><span>Revision {{ revision }}</span><button @click="$emit('close')">Back to workspaces</button><button :disabled="saving" @click="reload">Reload</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="saving" role="status">Saving shared layout…</p>
    <div v-if="!readOnly"><CustomSelect v-model="widgetId" aria-label="Widget to add" :options="[{value:'',label:'Choose widget'},...catalog.map(widget=>({value:widget.id,label:widget.name}))]" /><button :disabled="!widgetId || saving || conflicted" @click="addWidget">Add widget</button></div>
    <WidgetCanvas :page-id="workspace.id" :shared-layout="layout" :read-only="readOnly || saving || conflicted" :is-custom-page="true" @update:shared-layout="save" />
  </section>
</template>
<script setup>
import {ref,watch,computed} from 'vue';
import {getAllWidgets,registryVersion} from './widgetRegistry.js';
import WidgetCanvas from './WidgetCanvas.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
const props=defineProps({workspace:{type:Object,required:true},request:{type:Function,required:true},teamId:{type:String,required:true},readOnly:{type:Boolean,default:false}});
const emit=defineEmits(['close','saved']);
const layout=ref([]),revision=ref(0),saving=ref(false),conflicted=ref(false),error=ref('');
const widgetId=ref('');
const catalog=computed(()=>{registryVersion.value;return getAllWidgets().filter(widget=>!widget.isCustomWidget && !widget.isScreenWidget);});
function addWidget(){const widget=catalog.value.find(w=>w.id===widgetId.value);if(!widget)return;save([...layout.value,{instanceId:crypto.randomUUID(),widgetId:widget.id,col:0,row:0,cols:widget.defaultSize?.cols||4,rows:widget.defaultSize?.rows||4,visible:true}]);}
let generation=0;
function hydrate(workspace){const parsed=JSON.parse(workspace.canvas_json||'[]');if(!Array.isArray(parsed))throw Error('Invalid shared canvas');layout.value=parsed;revision.value=workspace.revision;}
watch(()=>[props.workspace.id,props.teamId],()=>{generation++;error.value='';conflicted.value=false;saving.value=false;try{hydrate(props.workspace);}catch(e){error.value=e.message;conflicted.value=true;}},{immediate:true});
async function reload(){const ticket=generation;try{const rows=await props.request('/'+props.teamId+'/workspaces');if(ticket!==generation)return;const workspace=rows.find(w=>w.id===props.workspace.id);if(!workspace)throw Error('Workspace is no longer available');hydrate(workspace);error.value='';conflicted.value=false;}catch(e){if(ticket===generation)error.value=e.message;}}
async function save(next){if(props.readOnly||saving.value||conflicted.value)return;const ticket=generation; saving.value=true;error.value='';try{const updated=await props.request('/'+props.teamId+'/workspaces/'+props.workspace.id,{method:'PATCH',body:JSON.stringify({canvas:next,expectedRevision:revision.value})});if(ticket!==generation)return;hydrate(updated);emit('saved',updated);}catch(e){if(ticket===generation){error.value=e.message;conflicted.value=true;}}finally{if(ticket===generation)saving.value=false;}}
</script>
<style scoped>
.shared-canvas{display:flex;flex-direction:column;min-height:560px;height:70vh;gap:12px}.shared-canvas header{display:flex;align-items:center;gap:12px}.shared-canvas header strong{flex:1}.shared-canvas :deep(.widget-canvas){flex:1;min-height:350px}
</style>
