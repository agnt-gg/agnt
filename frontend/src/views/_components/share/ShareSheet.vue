<template>
  <Teleport to="body">
    <div v-if="target" class="share-scrim" @click.self="closeShare" @keydown.esc="closeShare">
      <section class="share-sheet team-panel" role="dialog" aria-modal="true" :aria-label="'Share ' + target.name">
        <header>
          <div class="title">
            <i :class="kindIcon(target.kind)" aria-hidden="true"></i>
            <h2>Share {{ target.name }}</h2>
            <span class="pill">{{ kindLabel(target.kind) }}</span>
          </div>
          <button class="icon" aria-label="Close" @click="closeShare"><i class="fas fa-times"></i></button>
        </header>

        <FilterTabs v-if="tabs.length > 1" class="share-tabs" :tabs="tabs" :active="tab" @select="tab = $event" />

        <TeamShareTab v-if="tab === 'team'" :key="'team' + key" :kind="target.kind" :id="target.id" :name="target.name" @close="closeShare" />
        <LinkShareTab v-else-if="tab === 'link'" :key="'link' + key" :kind="target.kind" :id="target.id" :name="target.name" @close="closeShare" />
        <div v-else-if="tab === 'publish'" class="body">
          <p>List it on the AGNT Marketplace, where anyone can find it, review it and install it.</p>
          <div class="row"><button class="primary" @click="handOff(target.publish)"><i class="fas fa-store" aria-hidden="true"></i> Publish to Marketplace…</button></div>
        </div>
        <div v-else-if="tab === 'file'" class="body">
          <p>Save it as a file you can send to anyone, or import into another AGNT later.</p>
          <div class="row"><button class="primary" @click="handOff(target.exportItem)"><i class="fas fa-file-export" aria-hidden="true"></i> Export file</button></div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
<script setup>
/**
 * The one share sheet. Mounted once (App.vue); opened from any ShareButton.
 *
 *   Team     copy into a team you belong to (Personal only: in a team space the team IS here)
 *   Link     an unlisted agnt.gg link anyone can open, for people outside the team
 *   Publish  the Marketplace flow the screen already has, when it has one
 *   File     the export the screen already has, when it has one
 */
import { computed, ref, watch } from 'vue';
import FilterTabs from '@/views/Terminal/_components/FilterTabs.vue';
import TeamShareTab from '@/views/_components/team/TeamShareTab.vue';
import LinkShareTab from './LinkShareTab.vue';
import { shareState, closeShare } from '@/composables/useShare.js';
import { kindIcon, kindLabel, isBundleKind } from '@/services/share/shareKinds.js';
import { inTeamSpace } from '@/services/share/shareClient.js';
import '@/views/_components/team/team.css';

const target = computed(() => shareState.target);
const tab = ref('link');
const key = ref(0);
const tabs = computed(() => {
  const t = target.value;
  if (!t) return [];
  return [
    ...(isBundleKind(t.kind) && !inTeamSpace() ? [{ id: 'team', icon: 'fas fa-users', label: 'Team' }] : []),
    { id: 'link', icon: 'fas fa-link', label: 'Link' },
    ...(t.publish ? [{ id: 'publish', icon: 'fas fa-store', label: 'Marketplace' }] : []),
    ...(t.exportItem ? [{ id: 'file', icon: 'fas fa-file-export', label: 'File' }] : []),
  ];
});
watch(target, t => {
  if (!t) return;
  key.value++;
  const ids = tabs.value.map(entry => entry.id);
  tab.value = ids.includes(t.tab) ? t.tab : ids[0];
});
/** Publish and export belong to the screen that owns the item: close this sheet and let it take over. */
function handOff(action) {
  closeShare();
  if (typeof action === 'function') action();
}
</script>
<style scoped>
.share-scrim { position: fixed; inset: 0; z-index: 3000; background: var(--scrim); display: grid; place-items: center; padding: 16px; }
.share-sheet { width: min(540px, 100%); max-height: 90vh; height: auto; overflow: auto; border: 1px solid var(--terminal-border-color); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }
.share-sheet header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.share-sheet .title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.share-sheet .title > i { color: var(--color-primary); }
.share-sheet header h2 { margin: 0; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.share-tabs { padding: 10px 20px 0; }
.share-sheet :deep(.body) { padding: 18px 20px; display: grid; gap: 12px; }
.share-sheet .row { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
