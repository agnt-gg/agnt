<template>
  <div class="team-body">
    <section class="section">
      <div>
        <h3>Team connections</h3>
        <p>Accounts the team's automations can use, such as GitHub or a model provider. Teammates use them without ever seeing the credentials, and personal connections never leave their owner's space.</p>
      </div>
      <form v-if="canManage" class="inline-form" @submit.prevent="connect">
        <CustomSelect v-model="provider" :options="providerOptions" aria-label="Provider" />
        <input v-model="name" required maxlength="100" placeholder="Name, e.g. Company GitHub" aria-label="Connection name" />
        <button class="primary" :disabled="busy">Connect for the team</button>
      </form>
      <p v-if="canManage" class="muted">Model connections may incur provider charges billed to the team.</p>
      <ul class="rows" aria-label="Team connections">
        <li v-for="connection in connections" :key="connection.id">
          <div class="who"><strong>{{ connection.name }}</strong><span>{{ providerLabel(connection.providerId) }}</span></div>
          <span v-if="tested[connection.id]" class="pill accent">{{ tested[connection.id] }}</span>
          <div class="actions">
            <button v-if="connection.providerId === 'github'" :disabled="busy" @click="test(connection)">Test</button>
            <button v-if="canManage" class="danger" :disabled="busy" @click="revoke(connection)">Disconnect</button>
          </div>
        </li>
      </ul>
      <p v-if="!connections.length && !busy" class="empty">No team connections yet.</p>
    </section>
  </div>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { teamRequest } from '@/utils/teamClient.js';

const PROVIDERS = [['agnt', 'AGNT Flash (included)'], ['github', 'GitHub'], ['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['groq', 'Groq'], ['deepseek', 'DeepSeek'], ['grokai', 'Grok'], ['openrouter', 'OpenRouter']];
const providerOptions = PROVIDERS.map(([value, label]) => ({ value, label }));
const providerLabel = id => PROVIDERS.find(([value]) => value === id)?.[1] || id;
const props = defineProps({ team: { type: Object, required: true } });
const emit = defineEmits(['error']);
const connections = ref([]), provider = ref('openai'), name = ref(''), busy = ref(false), tested = ref({});
const canManage = computed(() => ['owner', 'admin'].includes(props.team.role));

async function perform(fn) {
  busy.value = true;
  try { await fn(); } catch (error) { emit('error', error.message); } finally { busy.value = false; }
}
const load = async () => { connections.value = await teamRequest('/' + props.team.id + '/connections'); };
const connect = () => perform(async () => { await teamRequest('/' + props.team.id + '/connections', { method: 'POST', body: JSON.stringify({ providerId: provider.value, name: name.value }) }); name.value = ''; await load(); });
const revoke = connection => perform(async () => { await teamRequest('/' + props.team.id + '/connections/' + connection.id, { method: 'DELETE' }); await load(); });
const test = connection => perform(async () => {
  const result = await teamRequest('/' + props.team.id + '/connections/' + connection.id + '/execute', { method: 'POST', body: JSON.stringify({ operation: { name: 'github.listRepositories' } }) });
  tested.value = { ...tested.value, [connection.id]: 'Works · ' + (result.repositories?.length ?? 0) + ' repositories' };
});
onMounted(() => perform(load));
watch(() => props.team.id, () => { tested.value = {}; perform(load); });
</script>
