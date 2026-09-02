<template>
  <div class="os">
    <!-- The morning sweep: newest files across every source. -->
    <div class="os-sec">
      <div class="os-hd">Recent <span class="os-ln"></span><span class="os-n">{{ recent.length }}</span></div>
      <div v-if="!recent.length" class="os-empty">Nothing yet. Files that chats, runs and agents produce land here.</div>
      <button v-for="o in recent" :key="'r-' + o.id" type="button" class="os-row" :class="{ on: isOpen(o) }" @click="open(o)" @click.shift.prevent="open(o)">
        <i :class="iconFor(o)"></i>
        <span class="os-nm">{{ label(o) }}</span>
        <span class="os-t">{{ when(o) }}</span>
      </button>
    </div>

    <!-- By what produced it. Empty groups are not listed. -->
    <div class="os-sec">
      <div class="os-hd">By source <span class="os-ln"></span><span class="os-n">{{ groups.length }}</span></div>
      <div v-for="g in groups" :key="g.id" class="os-group">
        <button type="button" class="os-ghd" @click="toggle(g.id)">
          <i class="fas" :class="collapsed.has(g.id) ? 'fa-chevron-right' : 'fa-chevron-down'"></i>
          <i class="os-kind" :class="kindIcon(g.kind)"></i>
          <span class="os-glabel">{{ g.label }}</span>
          <span class="os-n">{{ g.count }}</span>
        </button>
        <div v-if="!collapsed.has(g.id)" class="os-gbody">
          <button v-for="o in g.items.slice(0, limit(g.id))" :key="o.id" type="button" class="os-row" :class="{ on: isOpen(o) }" @click="open(o)">
            <i :class="iconFor(o)"></i>
            <span class="os-nm">{{ label(o) }}</span>
            <span class="os-t">{{ when(o) }}</span>
          </button>
          <button v-if="g.items.length > limit(g.id)" type="button" class="os-more" @click="more(g.id)">Show {{ Math.min(20, g.items.length - limit(g.id)) }} more</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * OutputSources — the Outputs screen's left panel body. Groups every content
 * output by the thing that produced it (this chat · a workflow · a tool · a
 * chat · loose) with a Recent strip on top. Clicking a row opens it; the
 * screen decides how (a conversation output → that chat; a file → the editor).
 */
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { groupOutputsBySource, recentOutputs, outputLabel } from '@/utils/outputSources.js';
import { parseServerTime } from '@/utils/serverTime.js';

const KIND_ICON = { conversation: 'fas fa-comments', workflow: 'fas fa-project-diagram', tool: 'fas fa-wrench', loose: 'fas fa-cube' };

export default {
  name: 'OutputSources',
  emits: ['open'],
  setup(props, { emit }) {
    const store = useStore();
    const collapsed = ref(new Set());
    const limits = ref({});

    const outputs = computed(() => store.getters['contentOutputs/visibleOutputs'] || []);
    const names = computed(() => ({
      workflows: new Map((store.getters['workflows/allWorkflows'] || []).map((w) => [String(w.id), w.name])),
      tools: new Map((store.getters['tools/allTools'] || []).map((t) => [String(t.id), t.name || t.title])),
      conversations: new Map(outputs.value.map((o) => [String(o.conversation_id), o.title]).filter(([k, v]) => k !== 'undefined' && v)),
    }));
    const activeConversationId = computed(() => store.state.chat?.currentConversationId || null);
    const groups = computed(() => groupOutputsBySource(outputs.value, names.value, { activeConversationId: activeConversationId.value }));
    const recent = computed(() => recentOutputs(outputs.value, 8));
    const openId = computed(() => store.getters['contentOutputs/selectedOutputId'] || null);

    const toggle = (id) => {
      const s = new Set(collapsed.value);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      collapsed.value = s;
    };
    const limit = (id) => limits.value[id] || 8;
    const more = (id) => {
      limits.value = { ...limits.value, [id]: limit(id) + 20 };
    };
    const label = outputLabel;
    const iconFor = (o) => {
      const t = String(o.content_type || '').toLowerCase();
      if (t.includes('html')) return 'fas fa-file-code';
      if (t.includes('image')) return 'fas fa-image';
      if (t.includes('markdown') || t.includes('md')) return 'fas fa-file-alt';
      if (t.includes('json') || t.includes('csv')) return 'fas fa-table';
      return o.workflow_id ? 'fas fa-project-diagram' : 'fas fa-comment-dots';
    };
    const kindIcon = (k) => KIND_ICON[k] || 'fas fa-cube';
    const when = (o) => {
      const ms = parseServerTime(o.updated_at || o.created_at);
      if (!ms) return '';
      const diff = (Date.now() - ms) / 1000;
      if (diff < 60) return 'now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
      if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
      return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const isOpen = (o) => openId.value != null && String(openId.value) === String(o.id);
    const open = (o) => emit('open', o);

    return { groups, recent, collapsed, toggle, limit, more, label, iconFor, kindIcon, when, isOpen, open };
  },
};
</script>

<style scoped>
.os {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.os-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 9.5px;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}
.os-ln {
  flex: 1;
  height: 1px;
  background: var(--terminal-border-color);
}
.os-n {
  font-size: 10px;
  letter-spacing: 0;
  color: var(--color-text-muted);
}
.os-empty {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
}
.os-row,
.os-ghd,
.os-more {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.os-row {
  padding: 6px 8px;
  font-size: 12.5px;
}
.os-row i {
  width: 13px;
  text-align: center;
  font-size: 11px;
  color: var(--color-text-muted);
  flex: 0 0 auto;
}
.os-row:hover {
  background: rgba(255, 255, 255, 0.03);
}
.os-row.on {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.25);
  background: rgba(var(--green-rgb), 0.06);
}
.os-nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.os-t {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.os-group {
  margin-bottom: 4px;
}
.os-ghd {
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
}
.os-ghd > i.fas.fa-chevron-right,
.os-ghd > i.fas.fa-chevron-down {
  font-size: 9px;
  width: 10px;
}
.os-kind {
  font-size: 11px;
  width: 13px;
  text-align: center;
}
.os-glabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}
.os-gbody {
  padding-left: 14px;
}
.os-more {
  padding: 5px 8px;
  font-size: 11px;
  color: var(--color-green);
}
</style>
