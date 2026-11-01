<!-- The Apps page's "For you" tab: connect the apps you use first, then add what they unlock.
     Everything is derived (services/forYouModel.js) from data the page already loads; every icon is
     the real brand mark AGNT ships (services/brandIcons.js). Signing in, installing and asking stay
     with the page: this view only emits. -->
<template>
  <div class="fy" data-testid="for-you">
    <!-- Hero: one next step. -->
    <section class="fy-hero">
      <div class="fy-hero-mark">
        <template v-if="connectedFamilies.length">
          <span v-for="f in connectedFamilies.slice(0, 4)" :key="f.id" class="fy-tile sm"><SvgIcon :name="f.icon" /></span>
        </template>
        <span v-else-if="step?.family" class="fy-tile lg"><SvgIcon :name="step.family.icon" /></span>
      </div>
      <div class="fy-hero-copy">
        <h2>{{ headline }}</h2>
        <p>{{ subline }}</p>
      </div>
      <div class="fy-hero-cta">
        <button v-if="step?.type === 'connect'" type="button" class="ap-btn primary fy-big" data-action="hero-connect" @click="$emit('connect', step.family.card)">
          <span class="fy-btn-ico"><SvgIcon :name="step.family.icon" /></span>Connect {{ step.family.name }}
        </button>
        <button v-else-if="step?.type === 'install'" type="button" class="ap-btn primary fy-big" data-action="hero-install" :disabled="installBusy" @click="$emit('install', step.item.row)">Add {{ step.item.row.displayName }}</button>
        <button type="button" class="ap-link" data-action="more-apps" @click="$emit('browse', 'app')">{{ connectedFamilies.length ? 'Connect another app' : 'See all apps' }} →</button>
      </div>
    </section>

    <!-- 1. Try it: asks for what you connected, and asks that need nothing. -->
    <section class="fy-sec">
      <header class="fy-sec-h"><span class="fy-n">1</span><h3>Try it now</h3><p>{{ asked.forApps.length ? 'Things Annie can do with what you connected.' : 'Start with something that needs no setup.' }}</p></header>
      <div class="fy-asks">
        <button v-for="a in [...asked.forApps.slice(0, 6), ...asked.noSetup].slice(0, asked.forApps.length ? 6 : 4)" :key="a.text" type="button" class="fy-ask" data-action="ask" @click="$emit('ask', a)">
          <span class="fy-tile xs"><SvgIcon :name="a.icon" /></span><span class="fy-ask-q">“{{ a.text }}”</span><span class="fy-ask-go">Ask →</span>
        </button>
      </div>
    </section>

    <!-- 2. Connect your apps (first on a first visit, below what's ready afterwards). -->
    <section class="fy-sec" :style="{ order: connected.size ? 3 : 2 }">
      <header class="fy-sec-h"><span class="fy-n">{{ connected.size ? 3 : 2 }}</span><h3>{{ connected.size ? 'Connect more apps' : 'Connect your apps' }}</h3><p>One sign-in turns on every plugin that uses it.</p></header>
      <div v-if="connectedFamilies.length" class="fy-done">
        <span v-for="f in connectedFamilies.slice(0, 10)" :key="f.id" class="fy-chip ok"><span class="fy-tile xs"><SvgIcon :name="f.icon" /></span>✓ {{ f.name }}</span>
        <button v-if="connectedFamilies.length > 10" type="button" class="fy-chip more" @click="$emit('browse', 'accounts')">+{{ connectedFamilies.length - 10 }} more</button>
      </div>
      <div class="fy-fams">
        <article v-for="f in openFamilies" :key="f.id" class="fy-fam" :class="{ lead: f.id === leadId }" :data-family="f.id">
          <div class="fy-fam-top"><span class="fy-tile"><SvgIcon :name="f.icon" /></span>
            <div><h4>{{ f.name }}</h4><small>{{ f.apps.length > 1 ? `One sign-in · ${f.apps.length} apps` : f.apps[0]?.displayName ? 'Sign in once' : 'Connect your account' }}</small></div></div>
          <div v-if="f.id === leadId && f.apps.length > 1" class="fy-minis">
            <span v-for="a in f.apps" :key="a.name" class="fy-mini"><SvgIcon :name="a.icon" />{{ shortName(a.displayName, f.name) }}</span>
          </div>
          <div class="fy-fam-foot">
            <button type="button" class="ap-btn small" :data-connect="f.id" @click="$emit('connect', f.card)">Connect</button>
            <span class="fy-unlock">{{ unlockLabel(f) }}</span>
          </div>
        </article>
        <article class="fy-fam more"><div><h4>{{ appCount }} apps in all</h4><small>Search every app on the Market</small></div>
          <button type="button" class="ap-btn small" data-action="all-apps" @click="$emit('browse', 'app')">Browse apps →</button></article>
      </div>
    </section>

    <!-- 3. What your apps unlock: packs and utilities, ready first. -->
    <section class="fy-sec" :style="{ order: connected.size ? 2 : 3 }">
      <header class="fy-sec-h"><span class="fy-n">{{ connected.size ? 2 : 3 }}</span><h3>{{ connected.size ? 'Ready for you' : 'What your apps unlock' }}</h3><p>Packs do a whole job; utilities work on their own.</p>
        <button type="button" class="ap-link fy-more" @click="$emit('browse', 'pack')">See all →</button></header>
      <div class="fy-cards">
        <article v-for="s in items.slice(0, 9)" :key="s.row.name" class="fy-card" :data-pack="s.row.name" @click="$emit('open', s.row.name)">
          <div class="fy-card-top"><span class="fy-tile"><SvgIcon :name="s.icon" /></span>
            <div class="fy-card-id"><h4>{{ s.row.displayName }}</h4><small>{{ s.row.authorName || 'Community' }}</small></div>
            <span class="ap-badge" :class="'kind-' + s.kind.id">{{ s.kind.one }}</span></div>
          <p>{{ s.row.description || 'No description yet.' }}</p>
          <div class="fy-needs">
            <span v-for="id in s.requires" :key="id" class="fy-need" :class="connected.has(id) ? 'have' : 'miss'"><SvgIcon :name="iconFor(id)" />{{ nameFor(id) }}</span>
            <span v-if="!s.requires.length" class="fy-need have">No apps needed</span>
          </div>
          <div class="fy-card-foot" @click.stop>
            <template v-if="s.row.installed"><span class="fy-state ok">✓ Added</span></template>
            <template v-else-if="requested.has(s.row.name)"><span class="fy-state warn" data-testid="requested">Requested · waiting for the owner</span></template>
            <template v-else-if="s.ready"><span class="fy-state ok">● Ready</span><button type="button" class="ap-btn small" :data-install="s.row.name" :disabled="installBusy" @click="$emit('install', s.row)">{{ installing === s.row.name ? 'Adding…' : 'Add' }}</button></template>
            <template v-else><span class="fy-state warn">Needs {{ s.missing.length }} app{{ s.missing.length > 1 ? 's' : '' }}</span>
              <button type="button" class="ap-btn small" :data-connect="s.missing[0]" @click="connectId(s.missing[0])">Connect {{ nameFor(s.missing[0]) }}{{ s.missing.length > 1 ? ` (1 of ${s.missing.length})` : '' }}</button></template>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { families as buildFamilies, shelf, unlocks, asks, nextStep } from '@/services/forYouModel.js';
import { providerIcon } from '@/services/brandIcons.js';
import { pluginKind } from '@/services/pluginDirectory.js';

const props = defineProps({
  rows: { type: Array, default: () => [] },
  cards: { type: Object, default: () => ({}) },
  connectedIds: { type: Array, default: () => [] },
  modelProviderIds: { type: Array, default: () => [] },
  installing: { type: String, default: '' },
  installBusy: Boolean,
  // Plugins this member asked the owner for (still pending).
  requestedNames: { type: Array, default: () => [] },
});
const requested = computed(() => new Set(props.requestedNames));
const emit = defineEmits(['connect', 'install', 'open', 'ask', 'browse']);

const modelIds = computed(() => new Set(props.modelProviderIds.map((id) => String(id).toLowerCase())));
const connected = computed(() => new Set(props.connectedIds.map((id) => String(id).toLowerCase())));
const allFamilies = computed(() => buildFamilies({ cards: props.cards, rows: props.rows, connected: connected.value, modelIds: modelIds.value }));
const connectedFamilies = computed(() => allFamilies.value.filter((f) => f.connected));
const openFamilies = computed(() => allFamilies.value.filter((f) => !f.connected).slice(0, 7));
const leadId = computed(() => (openFamilies.value[0]?.apps.length > 1 ? openFamilies.value[0].id : null));
const items = computed(() => shelf({ rows: props.rows, connected: connected.value, modelIds: modelIds.value }));
const asked = computed(() => asks({ connected: connected.value, rows: props.rows, modelIds: modelIds.value }));
const step = computed(() => nextStep({ families: allFamilies.value, items: items.value, connected: connected.value }));
const appCount = computed(() => props.rows.filter((r) => pluginKind(r).id === 'app').length);

const byId = computed(() => new Map(allFamilies.value.map((f) => [f.id, f])));
const nameFor = (id) => byId.value.get(id)?.name || id.charAt(0).toUpperCase() + id.slice(1);
const iconFor = (id) => byId.value.get(id)?.icon || providerIcon(id) || 'puzzle-piece';
const connectId = (id) => { const f = byId.value.get(id); if (f) emit('connect', f.card); };
const shortName = (name, family) => String(name).replace(new RegExp(`^${family}\\s+`, 'i'), '');
function unlockLabel(f) {
  const n = unlocks(f.id, items.value, connected.value);
  if (n) return `Unlocks ${n} pack${n > 1 ? 's' : ''}`;
  const partOf = items.value.filter((s) => s.requires.includes(f.id)).length;
  return partOf ? `Part of ${partOf} pack${partOf > 1 ? 's' : ''}` : `${f.apps.length || 1} app${f.apps.length > 1 ? 's' : ''}`;
}

const readyNow = computed(() => items.value.filter((s) => s.ready && !s.row.installed && s.kind.id === 'pack'));
const connectedLabel = computed(() => {
  const names = connectedFamilies.value.map((f) => f.name);
  return names.length <= 3 ? names.join(', ') + ' connected' : `${names.length} apps connected`;
});
const headline = computed(() => connectedFamilies.value.length
  ? `${connectedLabel.value} · ${readyNow.value.length} pack${readyNow.value.length === 1 ? '' : 's'} ready to add`
  : 'Start with the apps you already use');
const subline = computed(() => {
  if (!connectedFamilies.value.length) {
    const lead = step.value?.family;
    return lead && lead.apps.length > 1
      ? `One ${lead.name} sign-in covers ${lead.apps.slice(0, 3).map((a) => shortName(a.displayName, lead.name)).join(', ')}${lead.apps.length > 3 ? ` and ${lead.apps.length - 3} more` : ''}. Annie works in them for you and asks before anything is sent.`
      : 'Connect once and Annie can work in your apps for you, asking before anything is sent.';
  }
  return step.value?.type === 'install' ? `Next: add ${step.value.item.row.displayName}. ${step.value.item.row.description || ''}` : 'Each app you connect unlocks more packs.';
});
</script>

<style scoped>
.fy { display: flex; flex-direction: column; gap: 28px; padding-bottom: 32px; }
.fy-hero { order: 0; display: grid; grid-template-columns: auto 1fr auto; gap: 20px; align-items: center; padding: 20px 22px; border: 1px solid var(--ap-border); border-radius: 16px; background: var(--ap-surface); }
.fy-hero-mark { display: flex; gap: 6px; }
.fy-hero-copy h2 { margin: 0 0 4px; font-size: var(--font-size-lg, 18px); color: var(--text-primary); }
.fy-hero-copy p { margin: 0; color: var(--text-secondary); font-size: var(--font-size-sm); }
.fy-hero-cta { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.fy-big { height: 40px; padding: 0 18px; font-size: var(--font-size-md, 15px); display: inline-flex; align-items: center; gap: 8px; }
/* The brand mark on the accent fill takes the fill's own ink. */
.fy-btn-ico { display: inline-grid; place-items: center; width: 18px; height: 18px; }
.fy-btn-ico :deep(svg) { width: 16px; height: 16px; }
.fy-btn-ico :deep(svg path[fill]), .fy-btn-ico :deep(svg[fill]) { fill: var(--on-fill-accent); }
.fy-sec:nth-of-type(2) { order: 1; }
.fy-sec-h { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.fy-sec-h h3 { margin: 0; font-size: var(--font-size-md, 16px); color: var(--text-primary); }
.fy-sec-h p { margin: 0; color: var(--text-secondary); font-size: var(--font-size-sm); }
.fy-more { margin-left: auto; }
.fy-n { align-self: center; min-width: 20px; height: 20px; border-radius: 99px; display: grid; place-items: center; font-size: 11px; font-weight: 700; background: var(--surface-active); color: var(--text-primary); }
/* Brand tiles: the real mark on a neutral tile, in the theme's text colour (SvgIcon's contract). */
.fy-tile { flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 11px; border: 1px solid var(--ap-border); background: var(--ap-sunken); }
.fy-tile :deep(svg) { width: 22px; height: 22px; }
.fy-tile.lg { width: 56px; height: 56px; border-radius: 15px; } .fy-tile.lg :deep(svg) { width: 30px; height: 30px; }
.fy-tile.sm { width: 34px; height: 34px; } .fy-tile.sm :deep(svg) { width: 18px; height: 18px; }
.fy-tile.xs { width: 24px; height: 24px; border-radius: 7px; } .fy-tile.xs :deep(svg) { width: 14px; height: 14px; }
.fy-asks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.fy-ask { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border: 1px solid var(--ap-border); border-radius: 12px; background: var(--ap-surface); text-align: left; color: var(--text-primary); cursor: pointer; }
.fy-ask:hover { border-color: var(--border-strong, var(--ap-border)); background: var(--surface-hover); }
.fy-ask-q { flex: 1; min-width: 0; font-size: var(--font-size-sm); }
.fy-ask-go { font-size: var(--font-size-xs); font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
.fy-done { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.fy-chip { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border-radius: 99px; font-size: var(--font-size-sm); font-weight: 600; }
.fy-chip.ok { background: rgba(var(--green-rgb), .14); color: var(--ap-ok); }
.fy-chip.more { padding: 4px 12px; border: 1px solid var(--ap-border); background: transparent; color: var(--text-secondary); cursor: pointer; }
.fy-fams { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.fy-fam { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--ap-border); border-radius: 14px; background: var(--ap-surface); }
.fy-fam.lead { grid-column: span 2; grid-row: span 2; }
.fy-fam.more { flex-direction: row; align-items: center; justify-content: space-between; border-style: dashed; background: transparent; }
.fy-fam-top { display: flex; gap: 12px; align-items: center; }
.fy-fam h4, .fy-card h4 { margin: 0; font-size: var(--font-size-md, 15px); color: var(--text-primary); }
.fy-fam small, .fy-card small { color: var(--text-secondary); font-size: var(--font-size-xs); }
.fy-minis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.fy-mini { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--ap-border); border-radius: 99px; font-size: var(--font-size-xs); color: var(--text-secondary); white-space: nowrap; overflow: hidden; }
.fy-mini :deep(svg) { width: 13px; height: 13px; flex: none; }
.fy-fam-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; }
.fy-unlock { margin-left: auto; font-size: var(--font-size-xs); color: var(--text-secondary); }
.fy-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.fy-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--ap-border); border-radius: 14px; background: var(--ap-surface); cursor: pointer; }
.fy-card:hover { border-color: var(--border-strong, var(--ap-border)); }
.fy-card-top { display: flex; gap: 12px; align-items: flex-start; }
.fy-card-id { flex: 1; min-width: 0; }
.fy-card p { margin: 0; min-height: 36px; color: var(--text-secondary); font-size: var(--font-size-sm); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fy-needs { display: flex; flex-wrap: wrap; gap: 6px; min-height: 24px; }
.fy-need { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px 2px 6px; border-radius: 99px; font-size: var(--font-size-xs); border: 1px solid var(--ap-border); color: var(--text-secondary); }
.fy-need :deep(svg) { width: 12px; height: 12px; }
.fy-need.miss { border-style: dashed; color: var(--ap-warn); }
.fy-need.have::after { content: '✓'; color: var(--ap-ok); font-weight: 700; }
.fy-card-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; justify-content: space-between; }
.fy-state { font-size: var(--font-size-xs); font-weight: 600; }
.fy-state.ok { color: var(--ap-ok); } .fy-state.warn { color: var(--ap-warn); }
@media (max-width: 900px) {
  .fy-hero { grid-template-columns: 1fr; } .fy-hero-cta { align-items: flex-start; }
  .fy-asks, .fy-fams, .fy-cards { grid-template-columns: 1fr; } .fy-fam.lead { grid-column: auto; grid-row: auto; }
}
</style>
