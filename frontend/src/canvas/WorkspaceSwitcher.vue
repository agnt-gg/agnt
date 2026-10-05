<template>
  <div class="workspace-switcher" :class="{ compact, toolbar, team: !!modelValue }">
    <!-- Toolbar: the same quiet text control as the model selector beside it. -->
    <button
      v-if="toolbar"
      type="button"
      class="workspace-toolbar-btn"
      :class="{ 'has-error': !!error }"
      :aria-label="`Space: ${label}. Switch space` + (error ? `. ${error}` : '')"
      :aria-expanded="dropdownOpen ? 'true' : 'false'"
      v-tooltip="error || ''"
      @click.stop="open"
    ><i :class="error ? 'fas fa-exclamation-triangle' : modelValue ? 'fas fa-users' : 'fas fa-user'" aria-hidden="true"></i><span class="workspace-toolbar-label">{{ label }}</span><i class="fas fa-caret-down" aria-hidden="true"></i></button>
    <button
      v-else-if="compact"
      class="workspace-icon"
      :aria-label="`Space: ${label}. Switch space`"
      v-tooltip="label"
      @click.stop="open"
    ><i :class="modelValue ? 'fas fa-users' : 'fas fa-user'" aria-hidden="true"></i></button>
    <div class="workspace-select" :class="{ 'compact-trigger': compact || toolbar }" @click.capture="$emit('refresh')">
      <CustomSelect
        ref="select"
        :model-value="modelValue"
        :options="options"
        :aria-label="`Space: ${label}. Switch space`"
        :tabindex="compact || toolbar ? -1 : 0"
        @update:model-value="$emit('select', $event)"
      />
    </div>
    <p v-if="error && !compact && !toolbar" role="status" class="workspace-error">{{ error }} <button @click="$emit('refresh')">Retry</button></p>
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
  // Top toolbar: a low-profile text trigger, styled like the model selector.
  toolbar: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // Unread per space, keyed by team id ('' is Personal). Shown on the OTHER spaces only.
  unread: { type: Object, default: () => ({}) },
  // Who is signed in here, and where Personal leads (e.g. 'goku'), when known.
  account: { type: String, default: '' },
  personalHint: { type: String, default: '' },
});
const emit = defineEmits(['select', 'refresh']);
const select = ref(null);
const dropdownOpen = computed(() => !!select.value?.isOpen);
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
  // The toolbar has no room for the error line the rail shows, so the open
  // menu leads with it (opening the menu also retries: it emits 'refresh').
  ...(props.toolbar && props.error ? [{ value: '__error', label: props.error, disabled: true, class: 'ws-error' }] : []),
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
  if(select.value){
    const width=Math.min(240,window.innerWidth-16);
    select.value.dropdownStyle.width=width+'px';
    // The toolbar trigger sits at the right edge of the app: keep the menu
    // inside the window, right-aligned to the trigger when it would overflow.
    if(props.toolbar){
      const rect=select.value.$el.getBoundingClientRect();
      const left=Math.max(8,Math.min(rect.left,rect.right-width,window.innerWidth-width-8));
      select.value.dropdownStyle.left=left+'px';
      select.value.dropdownStyle.maxWidth=width+'px';
    }
    select.value.$el.focus({preventScroll:true});
  }
}
</script>
<style scoped>
/* Toolbar variant: rules copied from CanvasScreen .cv-global-model and
   .cv-global-model-clickable, so the two read as one row of quiet controls. */
.workspace-switcher.toolbar{width:auto;margin:0;flex:0 0 auto}
.workspace-toolbar-btn{background:transparent;font-family:inherit;font-size:11px;color:var(--color-primary);letter-spacing:.5px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:4px;cursor:pointer;-webkit-app-region:no-drag;transition:opacity .15s;padding:2px 6px;border-radius:4px;border:1px solid transparent}
.workspace-toolbar-btn i{font-size:10px}
.workspace-toolbar-btn:hover,.workspace-toolbar-btn[aria-expanded=true]{opacity:1;border-color:rgba(var(--primary-rgb),.2);background:rgba(var(--primary-rgb),.04)}
.workspace-toolbar-btn:focus-visible{outline:2px solid var(--color-primary);outline-offset:1px}
.workspace-toolbar-label{overflow:hidden;text-overflow:ellipsis}
.workspace-toolbar-btn.has-error{color:var(--text-yellow);opacity:1}
.workspace-switcher{width:100%;min-width:0;position:relative;margin:0 0 6px}.workspace-select{width:100%}.workspace-select :deep(.custom-select){width:100%;font-size:11px}.workspace-select :deep(.selected){padding:7px 6px;border-radius:7px;background:var(--color-darker-0)}.team .workspace-select :deep(.selected){box-shadow:inset 2px 0 0 var(--color-primary)}.workspace-error{font-size:10px;color:var(--color-text-muted);line-height:1.5;padding:0 5px;margin:8px 0 0;overflow-wrap:anywhere}.workspace-error button{font:inherit;background:none;border:0;color:var(--color-primary);cursor:pointer;padding:0}.compact{width:32px;margin-bottom:6px}.workspace-icon{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--terminal-border-color);border-radius:6px;background:none;color:var(--color-text);cursor:pointer}.team .workspace-icon{color:var(--color-primary);border-color:rgba(var(--primary-rgb),.4)}.compact-trigger{position:absolute;inset:0;pointer-events:none;opacity:0}.compact-trigger :deep(.custom-select){height:32px;pointer-events:none}.workspace-icon:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}
</style>
<style>
/* Global: the menu is teleported to <body>, out of reach of scoped styles. */
.custom-select-dropdown .option.ws-heading,.option.ws-heading{opacity:1;cursor:default;font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--color-text-muted);padding-top:9px;padding-bottom:3px;background:none}
.option.ws-account{opacity:1;cursor:default;font-size:10px;color:var(--color-text-muted);border-bottom:1px solid var(--terminal-border-color);background:none;overflow-wrap:anywhere}
.option.ws-error{opacity:1;cursor:default;font-size:10px;color:var(--text-yellow);border-bottom:1px solid var(--terminal-border-color);background:none;overflow-wrap:anywhere;white-space:normal}
.option.ws-heading:hover,.option.ws-account:hover,.option.ws-error:hover{background:none}
.option.ws-heading .not-connected,.option.ws-account .not-connected,.option.ws-error .not-connected{display:none}
</style>
