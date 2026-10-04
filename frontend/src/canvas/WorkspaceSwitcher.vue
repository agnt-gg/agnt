<template>
  <div class="workspace-switcher" :class="{ compact, team: !!modelValue }">
    <button
      v-if="compact"
      class="workspace-icon"
      :aria-label="`Space: ${label}. Switch space`"
      v-tooltip="label"
      @click.stop="open"
    ><i :class="modelValue ? 'fas fa-users' : 'fas fa-user'" aria-hidden="true"></i></button>
    <div class="workspace-select" :class="{ 'compact-trigger': compact }" @click.capture="$emit('refresh')">
      <CustomSelect
        ref="select"
        :model-value="modelValue"
        :options="options"
        :aria-label="`Space: ${label}. Switch space`"
        :tabindex="compact ? -1 : 0"
        @update:model-value="$emit('select', $event)"
      />
    </div>
    <p v-if="error && !compact" role="status" class="workspace-error">{{ error }} <button @click="$emit('refresh')">Retry</button></p>
  </div>
</template>
<script setup>
/**
 * The space picker. Two kinds of space, and nothing else:
 *   Personal     your home: this computer, or your own personal cloud instance.
 *   Team spaces  one per shared cloud instance you belong to.
 * Choosing one switches the whole app to it. It says who you are signed in as,
 * because each instance is its own site and an account mismatch is otherwise
 * invisible. The last entry opens space management rather than a space.
 *
 * The UI never says "workspace": a SPACE is personal or team (this picker), a
 * CANVAS is an arranged layout (Chat › Canvas). Code identifiers keep their
 * old names; only what a person reads changed.
 */
import { computed, nextTick, ref } from 'vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
const MANAGE_TEAMS = '__manage'; // CanvasScreen.selectWorkspace handles this value
const props = defineProps({
  modelValue: { type: String, default: '' },
  teams: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // Unread per space, keyed by team id ('' is Personal). Shown on the OTHER spaces only.
  unread: { type: Object, default: () => ({}) },
  // Who is signed in here, and where Personal leads (e.g. 'goku'), when known.
  account: { type: String, default: '' },
  personalHint: { type: String, default: '' },
});
const emit = defineEmits(['select', 'refresh']);
const select = ref(null);
const label = computed(() => props.teams.find(team => team.id === props.modelValue)?.name || (props.modelValue ? 'Team space' : 'Personal'));
// Section rows are disabled options: CustomSelect skips them for selection.
const heading = (value, text) => ({ value, label: text, disabled: true, class: 'ws-heading' });
const detail = team => {
  const parts = [];
  if (team.role === 'owner') parts.push('owner');
  const members = team.seats?.used;
  if (members) parts.push(members === 1 ? '1 member' : members + ' members');
  return parts.length ? ' · ' + parts.join(' · ') : '';
};
const withUnread = (value, name) => {
  const count = value === props.modelValue ? 0 : props.unread[value] || 0;
  return count ? name + ' · ' + (count > 99 ? '99+' : count) : name;
};
const options = computed(() => [
  ...(props.account ? [{ value: '__account', label: 'Signed in as ' + props.account, disabled: true, class: 'ws-account' }] : []),
  heading('__personal', 'Personal'),
  { value: '', label: withUnread('', 'Personal' + (props.personalHint ? ' · ' + props.personalHint : '')) },
  ...(props.teams.length ? [heading('__workspaces', 'Team spaces')] : []),
  ...props.teams.map(team => ({ value: team.id, label: withUnread(team.id, team.name + detail(team)) })),
  { value: MANAGE_TEAMS, label: props.teams.length ? 'Manage spaces…' : 'Join or create a team space…' },
]);
async function open() {
  emit('refresh');
  select.value?.toggleDropdown(true);
  await nextTick();
  if(select.value){select.value.dropdownStyle.width=Math.min(240,window.innerWidth-16)+'px';select.value.$el.focus({preventScroll:true});}
}
</script>
<style scoped>
.workspace-switcher{width:100%;min-width:0;position:relative;margin:0 0 6px}.workspace-select{width:100%}.workspace-select :deep(.custom-select){width:100%;font-size:11px}.workspace-select :deep(.selected){padding:7px 6px;border-radius:7px;background:var(--color-darker-0)}.team .workspace-select :deep(.selected){box-shadow:inset 2px 0 0 var(--color-primary)}.workspace-error{font-size:10px;color:var(--color-text-muted);line-height:1.5;padding:0 5px;margin:8px 0 0;overflow-wrap:anywhere}.workspace-error button{font:inherit;background:none;border:0;color:var(--color-primary);cursor:pointer;padding:0}.compact{width:32px;margin-bottom:6px}.workspace-icon{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--terminal-border-color);border-radius:6px;background:none;color:var(--color-text);cursor:pointer}.team .workspace-icon{color:var(--color-primary);border-color:rgba(var(--primary-rgb),.4)}.compact-trigger{position:absolute;inset:0;pointer-events:none;opacity:0}.compact-trigger :deep(.custom-select){height:32px;pointer-events:none}.workspace-icon:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}
</style>
<style>
/* Global: the menu is teleported to <body>, out of reach of scoped styles. */
.custom-select-dropdown .option.ws-heading,.option.ws-heading{opacity:1;cursor:default;font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--color-text-muted);padding-top:9px;padding-bottom:3px;background:none}
.option.ws-account{opacity:1;cursor:default;font-size:10px;color:var(--color-text-muted);border-bottom:1px solid var(--terminal-border-color);background:none;overflow-wrap:anywhere}
.option.ws-heading:hover,.option.ws-account:hover{background:none}
.option.ws-heading .not-connected,.option.ws-account .not-connected{display:none}
</style>
