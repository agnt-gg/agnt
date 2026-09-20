<template>
  <div class="navigation-settings">
    <section class="nav-card">
      <div class="card-heading">
        <div>
          <h3>Sidebar pages</h3>
          <p>Choose what appears, arrange pages, and collect them into groups.</p>
        </div>
        <div class="heading-actions">
          <button type="button" @click="addPage">Add page</button>
          <button class="quiet-button" type="button" @click="resetAll">Reset defaults</button>
        </div>
      </div>

      <div class="group-creator">
        <input v-model="newGroup" maxlength="32" placeholder="New group name" @keydown.enter="createGroup" />
        <button type="button" :disabled="!newGroup.trim()" @click="createGroup">Add group</button>
      </div>
    </section>

    <section v-for="(group, groupIndex) in groups" :key="group.name" class="nav-card">
      <div class="group-heading">
        <input
          class="group-name"
          :value="group.name"
          maxlength="32"
          aria-label="Group name"
          @change="renameGroup(group.name, $event.target.value)"
        />
        <div class="row-actions">
          <button type="button" aria-label="Move group up" :disabled="groupIndex === 0" @click="moveGroup(group.name, -1)"><i class="fas fa-arrow-up"></i></button>
          <button type="button" aria-label="Move group down" :disabled="groupIndex === groups.length - 1" @click="moveGroup(group.name, 1)"><i class="fas fa-arrow-down"></i></button>
        </div>
      </div>

      <div v-if="group.items.length" class="nav-list">
        <div v-for="(item, itemIndex) in group.items" :key="item.key" class="nav-row" :class="{ muted: !item.visible }">
          <i :class="item.icon"></i>
          <div class="item-copy">
            <strong>{{ item.label }}</strong>
            <span>{{ item.type === 'page' ? 'Custom page' : 'Built-in page' }}</span>
          </div>
          <CustomSelect
            class="group-select"
            :model-value="item.group"
            :options="groupOptions"
            aria-label="Navigation group"
            @update:modelValue="setGroup(item.key, $event)"
          />
          <div class="row-actions">
            <button type="button" aria-label="Move page up" :disabled="itemIndex === 0" @click="moveItem(item.key, -1)"><i class="fas fa-arrow-up"></i></button>
            <button type="button" aria-label="Move page down" :disabled="itemIndex === group.items.length - 1" @click="moveItem(item.key, 1)"><i class="fas fa-arrow-down"></i></button>
          </div>
          <label class="visibility-control">
            <input type="checkbox" :checked="item.visible" @change="setVisible(item.key, $event.target.checked)" />
            <span>{{ item.visible ? 'Shown' : 'Hidden' }}</span>
          </label>
          <button v-if="item.type === 'page'" type="button" class="remove-button" @click="removePage(item)">Remove</button>
        </div>
      </div>
      <p v-else class="empty-group">Move a page here using its group menu.</p>
    </section>
  </div>
</template>

<script>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import {
  addNavigationGroup,
  groupedNavigation,
  loadNavigationPreferences,
  moveNavigationGroup,
  removeNavigationItemPreference,
  renameNavigationGroup,
  reorderNavigationItem,
  resetNavigationPreferences,
  updateNavigationItem,
} from '@/services/navigationPreferences.js';

export default {
  name: 'NavigationSettings',
  components: { CustomSelect },
  setup() {
    const store = useStore();
    const revision = ref(0);
    const newGroup = ref('');
    const customPages = computed(() => store.getters['widgetLayout/allPages'].filter((page) => !page.route));
    const groups = computed(() => {
      revision.value;
      return groupedNavigation(customPages.value, { includeHidden: true });
    });
    const groupNames = computed(() => {
      revision.value;
      return loadNavigationPreferences().groups;
    });
    const groupOptions = computed(() => groupNames.value.map((group) => ({ label: group, value: group })));
    const refresh = () => { revision.value += 1; };

    const setVisible = (key, visible) => { updateNavigationItem(key, { visible }); refresh(); };
    const setGroup = (key, group) => { updateNavigationItem(key, { group }); refresh(); };
    const moveItem = (key, direction) => { reorderNavigationItem(key, direction, customPages.value); refresh(); };
    const moveGroup = (name, direction) => { moveNavigationGroup(name, direction); refresh(); };
    const renameGroup = (previous, next) => { renameNavigationGroup(previous, next); refresh(); };
    const createGroup = () => {
      if (!newGroup.value.trim()) return;
      addNavigationGroup(newGroup.value);
      newGroup.value = '';
      refresh();
    };
    const addPage = () => window.dispatchEvent(new CustomEvent('agnt:new-page'));
    const resetAll = () => { resetNavigationPreferences(); refresh(); };
    const removePage = async (item) => {
      if (!window.confirm(`Remove “${item.label}” and its widgets?`)) return;
      await store.dispatch('widgetLayout/deletePage', item.id);
      removeNavigationItemPreference(item.key);
      refresh();
    };

    return { groups, groupOptions, newGroup, setVisible, setGroup, moveItem, moveGroup, renameGroup, createGroup, addPage, resetAll, removePage };
  },
};
</script>

<style scoped>
.navigation-settings { display: flex; flex-direction: column; gap: 14px; width: 100%; }
.nav-card { border: 1px solid var(--terminal-border-color); border-radius: 12px; padding: 16px; background: var(--color-darker-0); }
.card-heading, .group-heading, .nav-row, .group-creator, .heading-actions { display: flex; align-items: center; gap: 12px; }
.card-heading, .group-heading { justify-content: space-between; }
h3, p { margin: 0; }
.card-heading p, .empty-group { color: var(--color-text-muted); margin-top: 5px; }
.group-creator { margin-top: 16px; }
input, select, button { font: inherit; }
.group-creator input, .group-name { color: var(--color-text); background: var(--color-darker-0); border: 1px solid var(--terminal-border-color); border-radius: 7px; padding: 8px 10px; }
.group-select { width: 150px; }
.group-creator input { flex: 1; }
.group-name { font-weight: 700; letter-spacing: .08em; width: min(240px, 55%); }
button { color: var(--color-text); background: rgba(var(--primary-rgb), .1); border: 1px solid var(--terminal-border-color); border-radius: 7px; padding: 7px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
button:disabled { opacity: .35; cursor: default; }
.quiet-button { background: transparent; }
.nav-list { display: flex; flex-direction: column; margin-top: 12px; }
.nav-row { min-height: 52px; border-top: 1px solid var(--terminal-border-color-light); }
.nav-row > i { width: 20px; color: var(--color-primary); text-align: center; }
.nav-row.muted { opacity: .58; }
.item-copy { display: flex; flex-direction: column; flex: 1; min-width: 120px; }
.item-copy span { color: var(--color-text-muted); font-size: .78rem; }
.row-actions { display: flex; gap: 4px; }
.row-actions button { width: 31px; padding: 6px 0; }
.visibility-control { display: flex; align-items: center; gap: 6px; min-width: 72px; }
.remove-button { color: var(--color-red); background: transparent; }
.empty-group { padding-top: 12px; border-top: 1px solid var(--terminal-border-color-light); }
@media (max-width: 850px) { .nav-row { flex-wrap: wrap; padding: 10px 0; } .item-copy { flex-basis: calc(100% - 44px); } .group-select { flex: 1; } }
</style>
