<template>
  <!-- The approved mockup's agent page, on the real agent. -->
  <div class="content">
    <div v-if="!agent" class="page"><p class="mk-muted">{{ loading ? 'Loading…' : 'That agent is not in this space.' }}</p></div>
    <div v-else class="page">
      <div class="page-head">
        <div class="who" style="gap: 16px">
          <span class="av agent xl"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
          <div>
            <h1>{{ agent.name }}</h1>
            <p>{{ agent.description || 'No description yet.' }}</p>
            <div class="row-gap" style="margin-top: 8px"><span class="tag">Draft · only you</span><span class="tag">{{ (agent.assignedTools || []).length }} tools</span><span v-if="agent.model" class="tag">{{ agent.model }}</span></div>
          </div>
        </div>
        <div class="row-gap">
          <button type="button" class="btn" @click="tryIt('')"><MkIcon name="chats" size="sm" />Chat</button>
          <CopyToTeamButton v-if="!team" kind="agent" :id="String(agent.id)" :name="agent.name" />
          <button type="button" class="btn" @click="openFull"><MkIcon name="pen" size="sm" />Open full editor</button>
        </div>
      </div>
      <div class="two">
        <div>
          <label class="lbl">Instructions</label>
          <textarea v-model="instructions" class="field" rows="8" aria-label="Instructions" @change="saveInstructions"></textarea>
          <label class="lbl">Tools</label>
          <div class="chips">
            <button v-for="t in agent.assignedTools || []" :key="t" type="button" class="chip" style="border-color: var(--pink)" v-tooltip="'Remove'" @click="removeTool(t)"><MkIcon name="check" />{{ toolName(t) }}</button>
            <button type="button" class="chip" @click="openFull"><MkIcon name="plus" />Add a tool</button>
          </div>
          <label class="lbl">Runs with</label>
          <div class="banner" style="margin: 0"><MkIcon name="plug" size="sm" /><span>Your own connections. Nobody else can trigger it.</span></div>
        </div>
        <div>
          <div class="sec-head" style="margin-top: 14px"><h3>Try it</h3></div>
          <form class="composer" style="border-radius: 16px" @submit.prevent="tryIt(draft)">
            <textarea v-model="draft" rows="2" :placeholder="`Give ${agent.name} a job…`" aria-label="Job"></textarea>
            <div class="composer-row"><span class="mk-muted">Opens a chat where Annie hands it the job</span><button class="send" type="submit" aria-label="Send"><MkIcon name="up" size="sm" /></button></div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './MkIcon.vue';
import CopyToTeamButton from '@/views/_components/team/CopyToTeamButton.vue';

const props = defineProps({ agentId: { type: String, required: true } });
const ctx = inject('teamCtx');
const store = useStore();
const team = computed(() => ctx.team.value);
const agent = computed(() => (store.getters['agents/allAgents'] || []).find((a) => String(a.id) === props.agentId) || null);
const instructions = ref('');
const draft = ref('');
const loading = ref(true);
const toolName = (t) => (typeof t === 'string' ? t : t?.name || t?.title || t?.id || 'Tool');

watch(agent, (a) => { instructions.value = a?.systemPrompt || ''; }, { immediate: true });
async function save(patch, message) {
  try { await store.dispatch('agents/updateAgent', { ...agent.value, ...patch }); ctx.toast(message); } catch (e) { ctx.toast('Couldn’t save. ' + (e?.message || e)); }
}
const saveInstructions = () => save({ systemPrompt: instructions.value }, 'Instructions saved');
const removeTool = (t) => save({ assignedTools: (agent.value.assignedTools || []).filter((x) => x !== t) }, 'Tool removed');
const openFull = () => ctx.openLibrary('agents', String(agent.value.id));
function tryIt(text) {
  ctx.ask(`Use my agent “${agent.value.name}”${text ? ' to: ' + text : ': '}`);
  draft.value = '';
}
onMounted(async () => {
  if (!agent.value) await store.dispatch('agents/fetchAgents').catch(() => {});
  loading.value = false;
});
</script>
