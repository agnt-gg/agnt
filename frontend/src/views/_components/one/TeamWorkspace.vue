<template>
  <section class="team-workspace main-panel">
    <header><CustomSelect v-if="!hideScopeSelector" v-model="teamId" :options="[{value:'',label:'Personal'},...teams.map(t=>({value:t.id,label:t.name}))]" :disabled="busy" @update:model-value="loadTeam" aria-label="Personal or team workspace" /><button @click="mode='create'">New team</button><button @click="mode='join'">Join team</button><button @click="$emit('close')">Back to personal workspace</button></header>
    <div v-if="error" class="error" role="alert">{{ error }} <button @click="error=''">Dismiss</button></div>
    <p v-if="loading" role="status">Loading…</p>
    <form v-if="mode==='create'" @submit.prevent="create"><h2>Enable Business team</h2><p>An active Business or managed cloud instance is required.</p><label>Cloud instance slug<input v-model="teamName" required maxlength="63" /></label><button :disabled="busy">Create</button><button type="button" @click="mode=''">Cancel</button></form>
    <form v-else-if="mode==='join'" @submit.prevent="join"><h2>Join team</h2><label>Invitation token<input v-model="inviteToken" required autocomplete="off" /></label><p>Sign in with the invited email. Invitation tokens are single-use and expire after seven days.</p><button :disabled="busy">Accept invitation</button><button type="button" @click="mode=''">Cancel</button></form>
    <template v-else-if="teamId">
      <p v-if="currentTeam?.tenantUrl"><a :href="currentTeam.tenantUrl" rel="noopener">Open team cloud instance</a> · {{ currentTeam.seats?.used }} / {{ currentTeam.seats?.total }} seats <a v-if="admin" href="https://agnt.gg/instance" target="_blank" rel="noopener">Manage seats and billing</a></p>
      <nav aria-label="Team views"><button v-for="name in ['Assets','Members','Workspaces','Connections','Activity']" :key="name" :class="{active:tab===name}" @click="tab=name">{{ name }}</button><small>{{ currentTeam?.name }} · {{ currentTeam?.role }}</small></nav>
      <div v-if="tab==='Assets'" class="team-content">
        <div class="team-actions"><input v-model="query" placeholder="Find a shared asset…" aria-label="Find shared asset" /><button v-if="editable" @click="newAsset">New shared asset</button><button v-if="editable" @click="mode='share'">Share a personal asset</button></div>
        <p class="muted">Versioned definitions shared with your Business team. Personal files and connections stay private. Library sharing does not grant execution or access to your computer.</p>
        <form v-if="mode==='share'" @submit.prevent="sharePersonal"><label>Personal resource<CustomSelect v-model="personalId" :options="personalResources.map(r=>({value:r.key,label:r.kind+' · '+r.name}))" placeholder="Choose a resource" /></label><p>Shares a reviewed snapshot. It will not silently track or modify the personal original. Remove secrets before sharing.</p><label class="check"><input type="checkbox" v-model="reviewed" required /> I reviewed this definition and removed credentials.</label><label v-if="personalId">Review and redact before sharing<textarea v-model="shareContent" rows="12" /></label><button :disabled="busy || !reviewed">Share snapshot</button><button type="button" @click="mode=''">Cancel</button></form>
        <div v-else class="asset-layout"><div class="asset-list"><button v-for="a in filteredAssets" :key="a.id" class="asset" @click="openAsset(a)"><strong>{{ a.name }}</strong><small>{{ a.kind }} · v{{ a.revision }}</small></button><p v-if="!filteredAssets.length && !loading">No shared assets yet.</p></div><div v-if="selected" class="asset-detail"><div class="asset-title"><h2>{{ selected.name }}</h2><small>v{{ selected.revision }} · {{ selected.kind }}</small></div><label v-if="editable">Add to workspace<CustomSelect v-model="destinationWorkspaceId" :options="[{value:'',label:'Team library'},...sharedWorkspaces.map(w=>({value:w.id,label:w.name}))]" /></label><p>Library definitions are inert. Import into a cloud workspace to execute with approved permissions.</p><label>Name<input v-model="draft.name" :readonly="!editable" maxlength="180" /></label><label>Kind<CustomSelect v-model="draft.kind" :disabled="!editable" :options="assetKinds.map(kind=>({value:kind,label:kind}))" /></label><label>Content<textarea v-model="draft.content" :readonly="!editable" rows="15" /></label><div class="team-actions"><button v-if="editable" :disabled="busy" @click="saveAsset">Save new version</button><button @click="download">Download</button><button @click="openAsset(selected)">Reload latest</button><button v-if="selected.revision>1" @click="loadVersion(selected.revision-1)">Previous version</button></div><p v-if="selected.revision<latestRevision" class="muted">Viewing historical version. Saving uses the last fetched revision and rejects stale updates.</p></div></div>
      </div>
      <div v-else-if="tab==='Members'" class="team-content"><ul><li v-for="m in members" :key="m.user_id"><span>{{ m.email || m.user_id }}</span><small>{{ m.role }}</small><button v-if="admin && m.role!=='owner'" @click="changeMemberRole(m)">{{ m.role==='admin' ? 'Make member' : 'Make admin' }}</button><button v-if="currentTeam?.role==='owner' && m.role!=='owner'" @click="remove(m)">Remove</button></li></ul><form v-if="admin" @submit.prevent="invite"><h2>Invite by verified email</h2><label>Email<input v-model="inviteEmail" type="email" required /></label><label>Role<CustomSelect v-model="inviteRole" :options="[{value:'member',label:'Member — edit shared assets'},{value:'admin',label:'Admin'}]" /></label><button :disabled="busy">Create invitation</button><p>An invitation email is attempted automatically. You can also send the single-use token privately.</p><textarea v-if="createdInvite" readonly :value="createdInvite" aria-label="Single-use invitation token" /></form><h3 v-if="invitations.length">Pending invitations</h3><ul><li v-for="i in invitations" :key="i.id"><span>{{ i.email }}</span><small>{{ i.role }}</small><button v-if="admin" @click="revoke(i)">Revoke</button></li></ul></div>
      <div v-else-if="tab==='Workspaces'" class="team-content"><SharedWorkspaceCanvas v-if="activeSharedWorkspace" :key="teamId+activeSharedWorkspace.id" :workspace="activeSharedWorkspace" :team-id="teamId" :request="request" :read-only="!editable" @close="activeSharedWorkspace=null" @saved="updated=>Object.assign(activeSharedWorkspace,updated)" /><section v-if="activeSharedWorkspace"><h3>Native resources</h3><form v-if="admin" @submit.prevent="setCapability(true)"><h4>Workspace permissions</h4><CustomSelect v-model="capabilityMember" :options="members.map(m=>({value:m.user_id,label:m.email||m.user_id}))" /><CustomSelect v-model="capabilityName" :options="workspaceCapabilities.map(c=>({value:c,label:c}))" /><button :disabled="busy || !capabilityMember">Grant</button><button type="button" :disabled="busy || !capabilityMember" @click="setCapability(false)">Revoke</button></form><div v-if="admin"><CustomSelect v-model="executionConnection" :options="connections.map(c=>({value:c.id,label:c.name}))" /><input v-model="executionModel" placeholder="Model ID" /></div><input v-model="executionInput" placeholder="Run input" /><div v-for="resource in nativeResources" :key="resource.kind+resource.id">{{resource.name}} · {{resource.kind}} <button v-if="admin" :disabled="busy" @click="nativeExecution(resource,'authorize')">Authorize revision</button><button :disabled="busy" @click="nativeExecution(resource,'run')">Run</button></div><pre v-if="executionResult">{{JSON.stringify(executionResult,null,2)}}</pre></section><form v-if="editable" @submit.prevent="createSharedWorkspace"><label>Workspace name<input v-model="workspaceName" required maxlength="100" /></label><button :disabled="busy">Create workspace</button></form><div v-for="workspace in sharedWorkspaces" :key="workspace.id" class="asset"><button @click="loadNativeResources(workspace)">{{ workspace.name }}</button><a :href="nativeWorkspaceUrl(workspace)">Open native workspace</a><small>All team members · v{{ workspace.revision }}</small><button @click="setWorkspaceOpen(workspace,!workspace.is_open)">{{ workspace.is_open ? 'Close for me' : 'Open for me' }}</button><button v-if="admin" @click="archiveWorkspace(workspace)">Archive</button></div><p v-if="!sharedWorkspaces.length">No team workspaces yet.</p></div>
      <div v-else-if="tab==='Connections'" class="team-content"><p>Approved connections allow team members to use the listed operations without seeing credentials.</p><button @click="loadConnections">Refresh connections</button><form v-if="admin" @submit.prevent="connectGithub"><label>Provider<CustomSelect v-model="connectionProvider" :options="['github','openai','anthropic','groq','deepseek','grokai','openrouter'].map(p=>({value:p,label:p}))" /></label><label>Connection name<input v-model="connectionName" required maxlength="100" /></label><p>Grants team use of this connected account. Model connections may incur provider charges.</p><button :disabled="busy">Authorize team connection</button></form><div v-for="connection in connections" :key="connection.id"><strong>{{ connection.name }}</strong><button :disabled="busy" @click="listRepositories(connection)">List repositories</button><button v-if="admin" :disabled="busy" @click="revokeConnection(connection)">Revoke</button></div><ul><li v-for="repository in repositoryResults" :key="repository.id">{{ repository.name }} · {{ repository.private ? 'Private' : 'Public' }}</li></ul></div>
      <div v-else class="team-content"><ul><li v-for="entry in events" :key="entry.id"><span>{{ entry.action }}</span><small>{{ entry.actor_id }} · {{ entry.created_at }}</small></li></ul><p v-if="!events.length">No activity yet.</p></div>
    </template>
    <div v-else-if="!mode" class="team-content"><h2>{{ hideScopeSelector ? 'Teams' : 'Personal workspace' }}</h2><p>Your personal resources stay private. Choose a team or create one to share versioned assets on this server.</p><div v-if="hideScopeSelector && teams.length" class="asset-list"><button v-for="team in teams" :key="team.id" class="asset" @click="teamId=team.id;loadTeam()"><strong>{{ team.name }}</strong><small>{{ team.role }}</small></button></div><button @click="$emit('close')">Continue personal work</button></div>
  </section>
</template>
<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue';
import {
  useStore
} from 'vuex';
import {
  API_CONFIG
} from '@/tt.config.js';
import {
  teamDefinition
} from '@/utils/teamDefinition.js';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import SharedWorkspaceCanvas from '@/canvas/SharedWorkspaceCanvas.vue';
const props=defineProps({selectedTeamId:{type:String,default:''},initialTab:{type:String,default:'Assets'},hideScopeSelector:{type:Boolean,default:false}});
const emit = defineEmits(['close','update:selectedTeamId','teams-loaded']);
const store = useStore();
const teams = ref([]),
  teamId = ref(props.selectedTeamId),
  members = ref([]),
  assets = ref([]),
  events = ref([]),
  invitations = ref([]),
  tab = ref(props.initialTab),
  mode = ref(''),
  teamName = ref(''),
  inviteToken = ref(''),
  inviteEmail = ref(''),
  inviteRole = ref('member'),
  createdInvite = ref(''),
  personalId = ref(''),
  reviewed = ref(false),
  query = ref(''),
  selected = ref(null),
  draft = ref({}),
  latestRevision = ref(0),
  busy = ref(false),
  loading = ref(false),
  error = ref('');
let generation = 0;
const shareContent = ref('');
const sharedWorkspaces = ref([]);
const workspaceName = ref('');
const activeSharedWorkspace = ref(null);
const nativeResources=ref([]);
const capabilityMember=ref(''),capabilityName=ref('resources.read');
const workspaceCapabilities=['resources.read','resources.write','files.read','files.write','runs.execute','runs.read','connections.use','access.manage'];
async function setCapability(grant){await perform(async()=>{const base='/'+teamId.value+'/instances/'+currentTeam.value.tenantSlug+'/workspaces/'+activeSharedWorkspace.value.id;await request(base+'/members/'+encodeURIComponent(capabilityMember.value)+'/capabilities/'+capabilityName.value,{method:grant?'PUT':'DELETE',body:'{}'});});}
async function loadNativeResources(workspace){const params=new URLSearchParams(window.location.search);if(params.get('team')!==teamId.value||params.get('workspace')!==workspace.id){const url=new URL(nativeWorkspaceUrl(workspace));url.searchParams.set('teams-panel','1');window.location.assign(url.href);return;}await perform(async()=>{activeSharedWorkspace.value=workspace;nativeResources.value=await request('/'+teamId.value+'/workspaces/'+workspace.id+'/native');await loadConnections();});}
async function nativeExecution(resource,action){const ticket=generation;await perform(async()=>{const connection=connections.value.find(c=>c.id===executionConnection.value);const result=await request('/'+teamId.value+'/workspaces/'+activeSharedWorkspace.value.id+'/native/'+resource.kind+'/'+resource.id+'/'+action,{method:'POST',body:JSON.stringify(action==='authorize'?{connectionId:connection?.id,provider:connection?.providerId,model:executionModel.value}:{input:executionInput.value})});if(ticket===generation)executionResult.value=result;});}
function nativeWorkspaceUrl(workspace){const url=new URL(currentTeam.value.tenantUrl);url.searchParams.set('team',teamId.value);url.searchParams.set('workspace',workspace.id);return url.href;}
const destinationWorkspaceId = ref('');
const executionConnection=ref(''),executionModel=ref(''),executionInput=ref(''),executionResult=ref(null);
const connections=ref([]),connectionName=ref(''),repositoryResults=ref([]),connectionProvider=ref('openai');
async function loadConnections(){await perform(async()=>{connections.value=await request('/'+teamId.value+'/connections');});}
async function connectGithub(){await perform(async()=>{await request('/'+teamId.value+'/connections',{method:'POST',body:JSON.stringify({providerId:connectionProvider.value,name:connectionName.value})});connections.value=await request('/'+teamId.value+'/connections');connectionName.value='';});}
async function revokeConnection(connection){await perform(async()=>{await request('/'+teamId.value+'/connections/'+connection.id,{method:'DELETE'});connections.value=await request('/'+teamId.value+'/connections');repositoryResults.value=[];});}
async function listRepositories(connection){const ticket=generation;await perform(async()=>{const result=await request('/'+teamId.value+'/connections/'+connection.id+'/execute',{method:'POST',body:JSON.stringify({operation:{name:'github.listRepositories'}})});if(ticket===generation)repositoryResults.value=result.repositories;});}
async function changeMemberRole(member){await perform(async()=>{await request('/'+teamId.value+'/members/'+member.user_id,{method:'PATCH',body:JSON.stringify({role:member.role==='admin'?'member':'admin'})});members.value=await request('/'+teamId.value+'/members');});}
async function createSharedWorkspace(){await perform(async()=>{await request('/'+teamId.value+'/workspaces',{method:'POST',body:JSON.stringify({name:workspaceName.value})});workspaceName.value='';sharedWorkspaces.value=await request('/'+teamId.value+'/workspaces');});}
async function setWorkspaceOpen(workspace,isOpen){await perform(async()=>{await request('/'+teamId.value+'/workspaces/'+workspace.id+'/preferences',{method:'PUT',body:JSON.stringify({isOpen})});workspace.is_open=isOpen?1:0;});}
async function archiveWorkspace(workspace){if(!window.confirm('Archive '+workspace.name+' for the team?'))return;await perform(async()=>{await request('/'+teamId.value+'/workspaces/'+workspace.id+'/archive',{method:'POST'});sharedWorkspaces.value=await request('/'+teamId.value+'/workspaces');});}
const assetKinds = ['markdown', 'text', 'html', 'csv', 'agent', 'workflow', 'tool', 'skill', 'widget', 'goal'];
const currentTeam = computed(() => teams.value.find(t => t.id === teamId.value));
const editable = computed(() => currentTeam.value?.entitlement?.collaborationAllowed && currentTeam.value?.tenantUrl && window.location.origin === new URL(currentTeam.value.tenantUrl).origin && ['owner', 'admin', 'member'].includes(currentTeam.value?.role));
const admin = computed(() => currentTeam.value?.capabilities?.manageMembers === true);
const filteredAssets = computed(() => assets.value.filter(a => a.name.toLowerCase().includes(query.value.toLowerCase())));
const personalResources = computed(() => [
  ['agent', store.getters['agents/allAgents'] || []],
  ['workflow', store.getters['workflows/allWorkflows'] || []],
  ['skill', store.getters['skills/allSkills'] || []]
].flatMap(([kind, list]) => list.map(item => ({
  key: kind + ':' + item.id,
  kind,
  name: item.name || item.title || kind,
  item
}))));
const selectedPersonalContent = computed(() => {
  const r = personalResources.value.find(r => r.key === personalId.value);
  return r ? teamDefinition(r) : ''
});
watch(selectedPersonalContent, value => {
  shareContent.value = value;
  reviewed.value = false
});
async function request(path, options = {}) {
  const response = await fetch(API_CONFIG.BASE_URL + '/teams' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + (localStorage.getItem('token') || ''),
      'Content-Type': 'application/json'
    }
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Team request failed');
  return result
}
async function perform(fn) {
  busy.value = true;
  error.value = '';
  try {
    await fn()
  } catch (e) {
    error.value = e.message;
    console.warn('[TeamWorkspace]', e.message)
  } finally {
    busy.value = false
  }
}
async function loadTeams() {
  const ticket = generation;
  const result = await request('');
  if (ticket === generation) { teams.value = result;emit('teams-loaded',result); }
}
async function loadTeam() {
  emit('update:selectedTeamId',teamId.value);
  const ticket = ++generation,
    id = teamId.value;
  assets.value = [];
  sharedWorkspaces.value = [];
  activeSharedWorkspace.value = null;
  nativeResources.value=[];
  connections.value=[];
  repositoryResults.value=[];
  executionResult.value=null;
  members.value = [];
  events.value = [];
  invitations.value = [];
  selected.value = null;
  mode.value = '';
  createdInvite.value = '';
  if (!id) return;
  loading.value = true;
  error.value = '';
  try {
    const onTenant = currentTeam.value?.tenantUrl && window.location.origin === new URL(currentTeam.value.tenantUrl).origin;
    const [a, m, e, i, workspaces] = await Promise.all([onTenant ? request('/' + id + '/assets') : [], request('/' + id + '/members'), onTenant ? request('/' + id + '/activity') : [], admin.value ? request('/' + id + '/invitations') : [], onTenant ? request('/'+id+'/workspaces') : []]);
    if (ticket !== generation) return;
    assets.value = a;
    sharedWorkspaces.value = workspaces;
    const queryWorkspace=new URLSearchParams(window.location.search).get('workspace');
    if(queryWorkspace){activeSharedWorkspace.value=workspaces.find(w=>w.id===queryWorkspace)||null;if(activeSharedWorkspace.value){tab.value='Workspaces';nativeResources.value=await request('/'+id+'/workspaces/'+queryWorkspace+'/native');}}
    members.value = m;
    events.value = e;
    invitations.value = i;
  } catch (e) {
    if (ticket === generation) {
      error.value = e.message;
      console.warn('[TeamWorkspace]', e.message)
    }
  } finally {
    if (ticket === generation) loading.value = false
  }
}

function create() {
  perform(async () => {
    const t = await request('', {
      method: 'POST',
      body: JSON.stringify({
        tenantSlug: teamName.value.trim()
      })
    });
    await loadTeams();
    teamId.value = t.id;
    await loadTeam()
  })
}

function join() {
  perform(async () => {
    const t = await request('/accept', {
      method: 'POST',
      body: JSON.stringify({
        token: inviteToken.value.trim()
      })
    });
    inviteToken.value = '';
    await loadTeams();
    teamId.value = t.id;
    await loadTeam()
  })
}

function invite() {
  perform(async () => {
    const result = await request('/' + teamId.value + '/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: inviteEmail.value,
        role: inviteRole.value
      })
    });
    createdInvite.value = result.token;
    if (result.emailDelivery?.status === 'failed') error.value = 'Invitation created, but email delivery failed. Send the token privately or create a replacement invitation.';
    invitations.value = await request('/' + teamId.value + '/invitations');
    inviteEmail.value = ''
  })
}

function revoke(i) {
  perform(async () => {
    await request('/' + teamId.value + '/invitations/' + i.id, {
      method: 'DELETE'
    });
    createdInvite.value = '';
    await loadTeam()
  })
}

function remove(m) {
  if (!window.confirm('Remove ' + (m.email || m.user_id) + '? Their access to this team library ends immediately. Team assets are retained.')) return;
  perform(async () => {
    await request('/' + teamId.value + '/members/' + encodeURIComponent(m.user_id), {
      method: 'DELETE'
    });
    await loadTeam()
  })
}
async function openAsset(a) {
  const ticket = ++generation,
    id = teamId.value;
  error.value = '';
  loading.value = true;
  try {
    const result = await request('/' + id + '/assets/' + a.id);
    if (ticket !== generation) return;
    selected.value = result;
    draft.value = {
      name: result.name,
      kind: result.kind,
      content: result.content
    };
    latestRevision.value = result.revision;
    mode.value = '';
  } catch (e) {
    if (ticket === generation) error.value = e.message
  } finally {
    if (ticket === generation) loading.value = false
  }
}
async function loadVersion(revision) {
  perform(async () => {
    const ticket = ++generation,
      scope = teamId.value;
    const r = await request('/' + scope + '/assets/' + selected.value.id + '?revision=' + revision);
    if (ticket !== generation || scope !== teamId.value) return;
    selected.value = r;
    draft.value = {
      name: r.name,
      kind: r.kind,
      content: r.content
    }
  })
}

function newAsset() {
  selected.value = {
    name: 'New shared asset',
    kind: 'markdown',
    revision: 0
  };
  draft.value = {
    name: '',
    kind: 'markdown',
    content: ''
  };
  mode.value = '';
}

function saveAsset() {
  const input = {
    id: selected.value.id,
    name: draft.value.name,
    kind: draft.value.kind,
    content: draft.value.content,
    expectedRevision: selected.value.revision
  };
  perform(async () => {
    const r = await request('/' + teamId.value + '/assets', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    if(destinationWorkspaceId.value)await request('/'+teamId.value+'/workspaces/'+destinationWorkspaceId.value+'/resources',{method:'POST',body:JSON.stringify({assetId:r.id})});
    await loadTeam();
    await openAsset(r)
  })
}

function sharePersonal() {
  const r = personalResources.value.find(r => r.key === personalId.value);
  if (!r || !reviewed.value) return;
  perform(async () => {
    await request('/' + teamId.value + '/assets', {
      method: 'POST',
      body: JSON.stringify({
        name: r.name,
        kind: r.kind,
        content: shareContent.value
      })
    });
    reviewed.value = false;
    personalId.value = '';
    await loadTeam()
  })
}

function download() {
  const url = URL.createObjectURL(new Blob([draft.value.content], {
    type: 'text/plain;charset=utf-8'
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = (draft.value.name || 'asset') + '.' + (draft.value.kind === 'markdown' ? 'md' : draft.value.kind === 'csv' ? 'csv' : 'txt');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
let mountedReady=false;
onMounted(()=>perform(async()=>{await loadTeams();mountedReady=true;if(teamId.value)await loadTeam()}));
watch(()=>props.selectedTeamId,async id=>{if(teamId.value===id)return;teamId.value=id;if(mountedReady)await loadTeam()});
watch(()=>props.initialTab,tabName=>{tab.value=tabName});
onBeforeUnmount(() => generation++);
watch(() => store.state.userAuth?.token, () => {
  generation++;
  teamId.value = '';
  teams.value = [];
  assets.value = [];
  sharedWorkspaces.value = [];
  activeSharedWorkspace.value = null;
  nativeResources.value=[];
  connections.value=[];
  repositoryResults.value=[];
  executionResult.value=null;
  members.value = [];
  invitations.value = [];
  selected.value = null;
  createdInvite.value = '';
  emit('close')
});
</script>
<style scoped>
.team-workspace {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  color: var(--color-text);
  overflow: auto;
  padding: 0;
  font-size: 13px
}

header {
  display: flex;
  gap: 8px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-wrap: wrap;
  align-items: center
}

button,
input,
textarea {
  font: inherit;
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: var(--color-darker-0);
  padding: 8px 10px
}

header :deep(.custom-select) {
  min-width: 160px
}

button {
  cursor: pointer
}

button:disabled {
  opacity: .5
}

button:hover,
nav .active {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), .35)
}

nav {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 10px 18px;
  border-bottom: 1px solid var(--terminal-border-color)
}

nav small {
  margin-left: auto;
  color: var(--color-text-muted)
}

.team-content {
  padding: 20px
}

.team-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px
}

.team-actions>input {
  flex: 1;
  min-width: 120px
}

.muted,
p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-muted)
}

.asset-layout {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(0, 2fr);
  gap: 20px;
  margin-top: 18px
}

.asset-list {
  display: grid;
  align-content: start;
  gap: 8px
}

.asset {
  text-align: left;
  padding: 14px
}

.asset strong {
  font-size: 14px;
  font-weight: 500;
  display: block
}

.asset small {
  display: block;
  margin-top: 6px;
  color: var(--color-text-muted)
}

.asset-detail {
  min-width: 0
}

.asset-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px
}

h2 {
  font-size: 20px;
  font-weight: 500;
  margin: 0 0 14px
}

h3 {
  font-size: 15px;
  font-weight: 500
}

label {
  display: block;
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 12px 0
}

label input,
label select,
label textarea {
  display: block;
  width: 100%;
  margin-top: 6px
}

textarea,
pre {
  font: 12px/1.7 'Fira Code', monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  max-width: 100%;
  resize: vertical
}

form {
  padding: 20px;
  max-width: 900px
}

form form {
  padding: 0
}

.check {
  display: flex;
  align-items: center;
  gap: 7px
}

.check input {
  width: auto;
  margin: 0
}

ul {
  list-style: none;
  padding: 0
}

li {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--terminal-border-color)
}

li span {
  flex: 1;
  overflow-wrap: anywhere
}

li small {
  color: var(--color-text-muted)
}

.error {
  padding: 12px 18px;
  background: rgba(255, 80, 80, .08);
  color: var(--color-red, #ff7777)
}

button:focus-visible {
  outline: 2px solid var(--color-primary)
}

@media(max-width:800px) {
  .asset-layout {
    grid-template-columns: 1fr
  }

  .team-content {
    padding: 14px
  }

  header {
    padding: 10px
  }

  nav {
    padding: 9px 10px
  }

  form {
    padding: 14px
  }
}
</style>
