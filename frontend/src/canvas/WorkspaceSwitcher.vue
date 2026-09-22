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
 * The space picker: Personal, then each team. Choosing one switches the whole
 * app to it. The last entry opens team management rather than a space.
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
});
const emit = defineEmits(['select', 'refresh']);
const select = ref(null);
const label = computed(() => props.teams.find(team => team.id === props.modelValue)?.name || (props.modelValue ? 'Team' : 'Personal'));
const withUnread = (value, name) => {
  const count = value === props.modelValue ? 0 : props.unread[value] || 0;
  return count ? name + ' · ' + (count > 99 ? '99+' : count) : name;
};
const options = computed(() => [
  { value: '', label: withUnread('', 'Personal') },
  ...props.teams.map(team => ({ value: team.id, label: withUnread(team.id, team.name) })),
  { value: MANAGE_TEAMS, label: props.teams.length ? 'Manage teams…' : 'Join or create a team…' },
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
