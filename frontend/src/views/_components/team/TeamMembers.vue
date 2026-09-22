<template>
  <div class="team-body">
    <section class="section">
      <div>
        <h3>People</h3>
        <p>Add someone by email. They get a seat on {{ team.tenantSlug }} and join the team in one step, with access to every project for their role.</p>
      </div>
      <form v-if="canManage" class="inline-form" @submit.prevent="add">
        <input v-model="email" type="email" placeholder="colleague@company.com" required aria-label="Email address to add" />
        <CustomSelect v-model="role" :options="roleOptions" aria-label="Role" />
        <button class="primary" :disabled="busy || seatsFull">Add person</button>
      </form>
      <p v-if="canManage && seatsFull">All {{ seats.total }} seats are in use. Remove someone or add seats from billing.</p>
      <ul class="rows" aria-label="Team people">
        <li v-for="person in people" :key="person.user_id">
          <div class="who"><strong>{{ person.name || person.email || person.user_id }}</strong><span>{{ person.email }}</span></div>
          <span v-if="!person.teamRole" class="pill warn" v-tooltip="'Has a seat but is not on the team yet'">Seat only</span>
          <span v-else-if="!person.instanceRole && person.teamRole !== 'owner'" class="pill warn" v-tooltip="'On the team but has no seat on the instance'">No seat</span>
          <template v-if="canManage && person.teamRole && person.teamRole !== 'owner' && person.user_id !== selfId">
            <CustomSelect :model-value="person.teamRole" :options="roleOptions" :disabled="busy" :aria-label="'Role for ' + (person.email || person.user_id)" @update:model-value="value => setRole(person, value)" />
          </template>
          <span v-else class="pill" :class="{ accent: ['owner', 'admin'].includes(person.teamRole) }">{{ roleLabel(person.teamRole) }}</span>
          <div v-if="canManage && person.teamRole !== 'owner' && person.user_id !== selfId" class="actions">
            <button v-if="!person.teamRole" :disabled="busy" @click="repair(person)">Finish adding</button>
            <button class="danger" :disabled="busy" @click="remove(person)">Remove</button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="canManage" class="section">
      <div>
        <h3>Invite someone new to AGNT</h3>
        <p>For a person without an AGNT account. They sign up with this email and accept the invitation. Single use, expires in seven days.</p>
      </div>
      <form class="inline-form" @submit.prevent="invite">
        <input v-model="inviteEmail" type="email" placeholder="email" required aria-label="Email to invite" />
        <CustomSelect v-model="inviteRole" :options="roleOptions" aria-label="Invitation role" />
        <button :disabled="busy">Send invitation</button>
      </form>
      <div v-if="createdInvite" class="token-box">
        <code>{{ createdInvite }}</code>
        <button class="icon" v-tooltip="copied ? 'Copied' : 'Copy invitation code'" @click="copyInvite"><i :class="copied ? 'fas fa-check' : 'fas fa-copy'"></i></button>
      </div>
      <ul v-if="invitations.length" class="rows" aria-label="Pending invitations">
        <li v-for="invitation in invitations" :key="invitation.id">
          <div class="who"><strong>{{ invitation.email }}</strong><span>Pending · {{ roleLabel(invitation.role) }}</span></div>
          <div class="actions"><button :disabled="busy" @click="revoke(invitation)">Revoke</button></div>
        </li>
      </ul>
    </section>
  </div>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { ROLES, roleLabel, teamRequest, tenantRequest, addPerson, removePerson, changeRole } from '@/utils/teamClient.js';

const props = defineProps({ team: { type: Object, required: true } });
const emit = defineEmits(['error', 'changed']);
const store = useStore();
const members = ref([]), instanceMembers = ref([]), invitations = ref([]), seats = ref({ used: 0, total: 0 });
const email = ref(''), role = ref('member'), inviteEmail = ref(''), inviteRole = ref('member');
const createdInvite = ref(''), copied = ref(false), busy = ref(false);
const roleOptions = ROLES.map(r => ({ value: r.value, label: r.label }));
const canManage = computed(() => props.team.capabilities?.manageMembers === true || ['owner', 'admin'].includes(props.team.role));
const selfId = computed(() => store.state.userAuth?.user?.id || '');
const seatsFull = computed(() => seats.value.total > 0 && seats.value.used >= seats.value.total);

/** One row per person, whichever grant they hold, so a half-added person is visible and fixable. */
const people = computed(() => {
  const byId = new Map();
  for (const m of instanceMembers.value) byId.set(m.userId, { user_id: m.userId, email: m.email, name: m.name, instanceRole: m.role, teamRole: null });
  for (const m of members.value) {
    const row = byId.get(m.user_id) || { user_id: m.user_id, email: m.email, name: m.name, instanceRole: null, teamRole: null };
    Object.assign(row, { teamRole: m.role, email: row.email || m.email, name: row.name || m.name });
    byId.set(m.user_id, row);
  }
  const rank = r => (r.teamRole === 'owner' ? 0 : r.teamRole === 'admin' ? 1 : 2);
  return [...byId.values()].sort((a, b) => rank(a) - rank(b) || (a.email || '').localeCompare(b.email || ''));
});

async function perform(fn) {
  busy.value = true;
  try { await fn(); } catch (error) { emit('error', error.message); } finally { busy.value = false; }
}
async function load() {
  const [teamMembers, pending, instance] = await Promise.all([
    teamRequest('/' + props.team.id + '/members'),
    canManage.value ? teamRequest('/' + props.team.id + '/invitations').catch(() => []) : [],
    tenantRequest('/' + props.team.tenantSlug).catch(error => { console.warn('[TeamMembers] instance:', error.message); return null; }),
  ]);
  members.value = teamMembers; invitations.value = pending;
  instanceMembers.value = instance?.members || [];
  seats.value = instance?.seats || props.team.seats || { used: 0, total: 0 };
}
const reload = async () => { await load(); emit('changed'); };
const add = () => perform(async () => { await addPerson(props.team, { email: email.value, role: role.value }); email.value = ''; await reload(); });
const repair = person => perform(async () => { await teamRequest('/' + props.team.id + '/members', { method: 'POST', body: JSON.stringify({ userId: person.user_id, role: 'member' }) }); await reload(); });
const setRole = (person, next) => perform(async () => { await changeRole(props.team, person.user_id, next); await reload(); });
function remove(person) {
  if (!window.confirm('Remove ' + (person.email || person.user_id) + '? They lose access to ' + props.team.name + ' immediately. Everything the team made stays.')) return;
  perform(async () => { await removePerson(props.team, person.user_id); await reload(); });
}
const invite = () => perform(async () => {
  const result = await teamRequest('/' + props.team.id + '/invitations', { method: 'POST', body: JSON.stringify({ email: inviteEmail.value, role: inviteRole.value }) });
  createdInvite.value = result.token; inviteEmail.value = '';
  if (result.emailDelivery?.status === 'failed') emit('error', 'Invitation created, but the email did not send. Share the code privately.');
  invitations.value = await teamRequest('/' + props.team.id + '/invitations');
});
const revoke = invitation => perform(async () => { await teamRequest('/' + props.team.id + '/invitations/' + invitation.id, { method: 'DELETE' }); createdInvite.value = ''; await load(); });
async function copyInvite() {
  try { await navigator.clipboard.writeText(createdInvite.value); copied.value = true; setTimeout(() => { copied.value = false; }, 1500); } catch { emit('error', 'Could not copy to the clipboard'); }
}
onMounted(() => perform(load));
watch(() => props.team.id, () => { createdInvite.value = ''; perform(load); });
</script>
