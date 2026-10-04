<template>
  <BaseScreen screenId="LearningScreen" :leftPanelProps="{activeSection:'learning'}" @panel-action="handlePanel" @screen-change="screen=>$emit('screen-change',screen)">
    <template #default>
      <LearningBoard :data="snapshot" :busy="busy" :error="error" @refresh="refresh" @pause="paused=>mutate('/settings',{paused})" @approve="approve" @dismiss="item=>mutate('/findings/'+item.id+'/dismiss',{revision:item.revision})" @keep="item=>mutate('/trials/'+item.id+'/keep',{revision:item.revision,candidateHash:item.candidate_hash})" @undo="item=>mutate('/trials/'+item.id+'/undo',{revision:item.revision})" />
    </template>
  </BaseScreen>
</template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import BaseScreen from '../../BaseScreen.vue';
import LearningBoard from './LearningBoard.vue';
import {useStore} from 'vuex';
import {watch} from 'vue';
import {API_CONFIG} from '@/tt.config.js';
const store=useStore();
const emit=defineEmits(['screen-change']);
const empty=()=>({settings:{paused:false},findings:[],trials:[],policies:[],coverage:{events:0,work:0}});
const snapshot=ref(empty()),busy=ref(false),error=ref('');
let controller=null,disposed=false;
async function request(path,body){
  const token=localStorage.getItem('token');if(!token)throw new Error('Sign in to view account learning.');
  const response=await fetch(API_CONFIG.BASE_URL+'/learning'+path,{method:body?'POST':'GET',credentials:'include',signal:controller?.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(token!==localStorage.getItem('token'))throw new DOMException('Account changed','AbortError');if(!response.ok)throw new Error(result.error||'Learning is unavailable.');return result;
}
async function refresh(){if(disposed||busy.value)return;busy.value=true;error.value='';controller=new AbortController();try{snapshot.value=await request('');}catch(e){if(e.name!=='AbortError')error.value=e.message;}finally{busy.value=false;}}
async function mutate(path,body){if(busy.value||disposed)return;busy.value=true;error.value='';controller=new AbortController();try{await request(path,body);snapshot.value=await request('');}catch(e){if(e.name!=='AbortError')error.value=({insufficient_baseline:'More known baseline calls are needed before starting this trial.',stale_finding:'Evidence changed. Refresh and review the latest proposal.',stale_trial:'This trial changed. Refresh before continuing.',learning_paused:'Resume learning before activating a change.'}[e.message]||e.message);}finally{busy.value=false;}}
function approve(item){mutate('/findings/'+item.id+'/approve',{revision:item.revision,candidateHash:item.candidate_hash,durationDays:7,minimumSamples:20});}
function handlePanel(action,payload){if(action==='settings-goto'||action==='navigate')emit('screen-change',payload);}
watch(()=>store.state.userAuth?.user?.id||store.state.userAuth?.userId,()=>{controller?.abort();snapshot.value=empty();error.value='';});
onMounted(refresh);
onBeforeUnmount(()=>{disposed=true;controller?.abort();snapshot.value=empty();});
</script>
