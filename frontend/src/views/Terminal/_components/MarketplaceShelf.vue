<template>
  <!--
    The empty state IS the storefront.

    One component, mounted by every asset screen, rendering the same card the
    Marketplace screen renders. Before this, Agents/Workflows/Tools each carried
    a hand-copied marketplace card (19 byte-identical CSS rules, 2 already
    drifted) and Skills/WidgetManager had no marketplace path at all.

    DEGRADATION IS THE LOAD-BEARING CASE: if the catalogue is unreachable, or
    this asset type does not exist in the marketplace at all (there is no
    `skill` or `widget` asset_type server-side), the marketplace section is
    omitted entirely and the Create path is left exactly as it was. A broken
    grid would be strictly worse than the dead end this replaces.
  -->
  <div class="ms-root" :class="'ms-' + variant">
    <SimpleModal ref="simpleModal" />

    <!-- ── Create: always rendered, never gated on the network ── -->
    <div v-if="variant === 'full'" class="ms-start">
      <div class="ms-start-ico"><i :class="typeIcon"></i></div>
      <div class="ms-start-txt">
        <h2>Start with {{ article }} {{ typeNoun }}</h2>
        <p>Build your own from scratch, or install one that already works and change it after.</p>
      </div>
      <button class="ms-start-cta" @click="$emit('create')"><i class="fas fa-plus"></i> {{ createLabel }}</button>
    </div>

    <!-- ── Marketplace section: present only when it can actually be filled ── -->
    <template v-if="showShelf">
      <!-- FULL: the cold empty state -->
      <template v-if="variant === 'full'">
        <div class="ms-head">
          <div class="ms-head-txt">
            <div class="ms-title">
              <i class="fas fa-store"></i>From the marketplace
              <span class="ms-count">{{ countLabel }}</span>
            </div>
            <div class="ms-sub">{{ subtitle }}</div>
          </div>
          <button class="ms-all" @click="$emit('browse')">
            {{ browseLabel }} <i class="fas fa-arrow-right"></i>
          </button>
        </div>

        <div v-if="!query && categories.length > 1" class="ms-chips">
          <button class="ms-chip" :class="{ on: !category }" @click="category = null">
            All <b>{{ typeItems.length }}</b>
          </button>
          <button
            v-for="c in categories"
            :key="c.name"
            class="ms-chip"
            :class="{ on: category === c.name }"
            @click="category = category === c.name ? null : c.name"
          >
            {{ c.name }} <b>{{ c.count }}</b>
          </button>
        </div>

        <!-- No match is an affordance, not a sales pitch: someone who typed a
             query is not browsing, so answering with unrelated cards is noise. -->
        <div v-if="!visibleItems.length" class="ms-empty">
          <div class="ms-empty-ico"><i class="fas fa-search"></i></div>
          <h3>Nothing matches &ldquo;{{ query || category }}&rdquo;</h3>
          <p>No {{ typePlural }} in the marketplace match that yet.</p>
          <button class="ms-empty-cta" @click="$emit('clear-search'); category = null">
            <i class="fas fa-undo"></i> Clear search
          </button>
        </div>

        <div v-else ref="gridEl" class="ms-grid">
          <article
            v-for="(item, idx) in visibleItems"
            :key="item.id"
            class="ms-card"
            :style="{ '--i': Math.min(idx, 14) }"
            @click="$emit('browse', item)"
          >
            <div class="ms-card-art" :style="artStyle(item)">
              <img v-if="item.preview_image" class="ms-art-img" :src="item.preview_image" :alt="item.title" @error="onArtError(item)" />
              <div v-else class="ms-card-glyph"><i :class="assetIcon(item)"></i></div>
              <!-- The type badge is deliberately absent: on the Agents screen
                   every card is an agent. Rank / New / price still earn their
                   space because they vary between cards. -->
              <div class="ms-art-tags">
                <span v-if="rankMap[item.id]" class="ms-tag rank">#{{ rankMap[item.id] }} in {{ item.category }}</span>
                <span v-else-if="trendingIds.has(item.id)" class="ms-tag hot"><i class="fas fa-fire"></i> Trending</span>
                <span v-else-if="isNew(item)" class="ms-tag new">New</span>
                <span class="ms-tag price" :class="{ free: !(item.price > 0) }">
                  {{ item.price > 0 ? '$' + item.price.toFixed(2) : 'FREE' }}
                </span>
              </div>
            </div>

            <div class="ms-card-icon" :style="iconStyle(item)"><i :class="assetIcon(item)"></i></div>

            <div class="ms-card-body">
              <h3 class="ms-card-title">{{ item.title }}</h3>
              <div class="ms-card-by">{{ item.publisher_pseudonym || 'Anonymous' }}</div>
              <p class="ms-card-desc">{{ item.tagline || item.description || 'No description available' }}</p>
              <div class="ms-card-meta">
                <!-- Unrated, never a fake 0.0 — 31 of 33 catalogue items have no
                     ratings, and 0.0 reads as "bad" rather than "no data". -->
                <span v-if="item.rating_count > 0" class="ms-m ms-m-star">
                  <i class="fas fa-star"></i><b>{{ item.rating.toFixed(1) }}</b>
                  <span class="ms-m-count">({{ item.rating_count }})</span>
                </span>
                <span v-else class="ms-m ms-m-unrated">Unrated</span>
                <span class="ms-m"><i class="fas fa-download"></i><b>{{ formatCount(item.downloads || 0) }}</b></span>
              </div>
            </div>

            <div class="ms-card-foot">
              <button
                class="ms-inst"
                :class="{ busy: installingIds.has(item.id) }"
                data-sound="chaChingMoney"
                :disabled="installingIds.has(item.id)"
                @click.stop="install(item)"
              >
                <i :class="installingIds.has(item.id) ? 'fas fa-spinner fa-spin' : 'fas fa-download'"></i>
                <span>{{ installingIds.has(item.id) ? 'Installing…' : 'Install' }}</span>
              </button>
            </div>
          </article>
        </div>
      </template>

      <!-- STRIP: the user already owns things, so the shelf steps aside.
           Compact rows, not cards: rendered as cards this section measured
           4.7x the height of the user's own items — an upsell dominating a
           screen that belongs to their work. -->
      <div v-else class="ms-strip">
        <div class="ms-strip-head">
          <div class="ms-head-txt">
            <div class="ms-title">
              <i class="fas fa-store"></i>More {{ typePlural }} from the marketplace
              <span class="ms-count">{{ typeItems.length }}</span>
            </div>
            <div class="ms-sub">Most installed · the search above filters your own {{ typePlural }}</div>
          </div>
          <button class="ms-all" @click="$emit('browse')">Browse all <i class="fas fa-arrow-right"></i></button>
          <Tooltip text="Hide marketplace suggestions on this screen" width="auto">
            <button class="ms-dismiss" @click="dismiss"><i class="fas fa-times"></i></button>
          </Tooltip>
        </div>
        <div class="ms-rail">
          <div v-for="item in rankedItems" :key="item.id" class="ms-row" @click="$emit('browse', item)">
            <div class="ms-row-ico" :style="iconStyle(item)"><i :class="assetIcon(item)"></i></div>
            <div class="ms-row-txt">
              <h4>{{ item.title }}</h4>
              <!-- the install count is the only ranking signal on a rail sorted
                   "most installed", so it gets a slot that never shrinks -->
              <p>{{ installsLabel(item.downloads || 0) }}</p>
            </div>
            <button
              class="ms-row-get"
              :disabled="installingIds.has(item.id)"
              data-sound="chaChingMoney"
              @click.stop="install(item)"
            >
              {{ installingIds.has(item.id) ? '…' : item.price > 0 ? '$' + item.price.toFixed(2) : 'Install' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import {
  MARKETPLACE_ASSET_TYPES,
  isShelfEligible,
  assetIcon,
  artStyle,
  iconStyle,
  isNew,
  buildTrendingIds,
  buildCategoryRankMap,
  formatCount,
  installsLabel,
  matchesQuery,
  byPopularity,
  trimToWholeRows,
} from '@/composables/useMarketplaceCard';

const NOUNS = { agent: 'agent', workflow: 'workflow', tool: 'tool', plugin: 'plugin', skill: 'skill', widget: 'widget' };
const ICONS = {
  agent: 'fas fa-robot',
  workflow: 'fas fa-project-diagram',
  tool: 'fas fa-wrench',
  plugin: 'fas fa-puzzle-piece',
  skill: 'fas fa-graduation-cap',
  // FA5 names: this app vendors Font Awesome 5.15.1, where an FA6 name renders
  // as an empty box with no error. uiContracts.spec.js enforces this.
  widget: 'fas fa-th-large',
};
/** Per-screen dismissal of the strip. A permanent upsell on a working screen is an ad. */
const DISMISS_KEY = (t) => `marketplaceShelf.dismissed.${t}`;

export default {
  name: 'MarketplaceShelf',
  components: { SimpleModal, Tooltip },
  props: {
    /** agent | workflow | tool | plugin | (skill/widget render nothing — see MARKETPLACE_ASSET_TYPES) */
    assetType: { type: String, required: true },
    /** 'full' = cold empty state (Create + shelf). 'strip' = compact rail under the user's own items. */
    variant: { type: String, default: 'full' },
    /** The screen's existing search string. The shelf NEVER writes to the marketplace store's global filters. */
    query: { type: String, default: '' },
    createLabel: { type: String, default: 'Create' },
  },
  emits: ['create', 'browse', 'installed', 'availability', 'clear-search'],
  setup(props, { emit }) {
    const store = useStore();
    const simpleModal = ref(null);
    const gridEl = ref(null);
    const columns = ref(1);
    const installingIds = ref(new Set());
    const category = ref(null);
    const dismissed = ref(false);

    const { handleInstall } = useMarketplaceInstall(simpleModal);

    const status = computed(() => store.getters['marketplace/shelfStatus']);
    const typeItems = computed(() =>
      isShelfEligible(props.assetType) ? store.getters['marketplace/shelfItemsByType'](props.assetType) : []
    );

    /* The whole marketplace section hangs off this one predicate, so every
       degraded path (ineligible type, failed fetch, empty catalogue, dismissed
       strip) collapses to the same safe outcome: render Create, render nothing
       else. */
    const showShelf = computed(() => {
      if (!isShelfEligible(props.assetType)) return false;
      if (status.value === 'error' || status.value === 'loading' || status.value === 'idle') return false;
      if (!typeItems.value.length) return false;
      if (props.variant === 'strip' && dismissed.value) return false;
      return true;
    });

    watch(showShelf, (v) => emit('availability', v), { immediate: true });

    const rankedItems = computed(() => [...typeItems.value].sort(byPopularity));

    const matched = computed(() =>
      rankedItems.value.filter(
        (i) => matchesQuery(i, props.query) && (!category.value || i.category === category.value)
      )
    );

    /* Never end on a ragged row: 6 items in a 4-column grid rendered 4 + 2 and
       left 659px of measured dead space, which reads as "we ran out". */
    const visibleItems = computed(() => trimToWholeRows(matched.value, columns.value, 2));
    const hiddenCount = computed(() => matched.value.length - visibleItems.value.length);

    const categories = computed(() => {
      const counts = {};
      for (const i of typeItems.value) if (i.category) counts[i.category] = (counts[i.category] || 0) + 1;
      return Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    });

    const trendingIds = computed(() => buildTrendingIds(typeItems.value));
    const rankMap = computed(() => buildCategoryRankMap(typeItems.value));

    const typeNoun = computed(() => NOUNS[props.assetType] || props.assetType);
    const typePlural = computed(() => typeNoun.value + 's');
    const article = computed(() => (/^[aeiou]/i.test(typeNoun.value) ? 'an' : 'a'));
    const typeIcon = computed(() => ICONS[props.assetType] || 'fas fa-cube');

    const countLabel = computed(() =>
      hiddenCount.value > 0 ? `${visibleItems.value.length} of ${matched.value.length}` : String(matched.value.length)
    );
    const browseLabel = computed(() =>
      hiddenCount.value > 0 ? `Browse all (+${hiddenCount.value} more)` : 'Browse the marketplace'
    );
    const subtitle = computed(() =>
      props.query
        ? `${matched.value.length} match “${props.query}” · install and edit, nothing is locked`
        : 'Most installed · free, and editable the moment it lands'
    );

    /* Column count drives row-trimming and the grid is responsive, so it is
       measured after layout rather than guessed from a breakpoint. */
    let ro = null;
    const measure = () => {
      if (!gridEl.value) return;
      const cols = getComputedStyle(gridEl.value).gridTemplateColumns.split(' ').filter(Boolean).length;
      if (cols > 0 && cols !== columns.value) columns.value = cols;
    };
    watch(visibleItems, () => nextTick(measure));

    onMounted(async () => {
      dismissed.value = localStorage.getItem(DISMISS_KEY(props.assetType)) === '1';
      // Cached with a TTL in the store, so five screens cost one request.
      await store.dispatch('marketplace/fetchShelfItems');
      await nextTick();
      measure();
      if (typeof ResizeObserver !== 'undefined' && gridEl.value) {
        ro = new ResizeObserver(measure);
        ro.observe(gridEl.value);
      }
    });
    onBeforeUnmount(() => ro && ro.disconnect());

    const onArtError = (item) => {
      // Fall back to the deterministic gradient + glyph rather than a broken image.
      item.preview_image = null;
    };

    const dismiss = () => {
      dismissed.value = true;
      try {
        localStorage.setItem(DISMISS_KEY(props.assetType), '1');
      } catch {
        /* private mode / quota — dismissal just doesn't persist, which is fine */
      }
    };

    const install = async (item) => {
      if (installingIds.value.has(item.id)) return;
      installingIds.value = new Set(installingIds.value).add(item.id);
      try {
        const result = await handleInstall(item, props.assetType);
        if (result && result.success) emit('installed', item);
      } finally {
        const next = new Set(installingIds.value);
        next.delete(item.id);
        installingIds.value = next;
      }
    };

    return {
      MARKETPLACE_ASSET_TYPES,
      simpleModal,
      gridEl,
      installingIds,
      category,
      showShelf,
      typeItems,
      rankedItems,
      visibleItems,
      hiddenCount,
      categories,
      trendingIds,
      rankMap,
      typeNoun,
      typePlural,
      article,
      typeIcon,
      countLabel,
      browseLabel,
      subtitle,
      install,
      dismiss,
      onArtError,
      assetIcon,
      artStyle,
      iconStyle,
      isNew,
      formatCount,
      installsLabel,
    };
  },
};
</script>

<style scoped>
/*
  SECONDARY-INK RULE (measured, not eyeballed):
  every dimmed text element here uses opacity .82 on the theme's own ink.
  Across light/rose/dark/ember/nord, on both the card fill and the page fill,
  .77 is the floor that still clears WCAG AA 4.5:1 — light mode binds first
  (white card, #4a4a60 ink). .82 leaves headroom and matches .mk-card-meta.
  Do not dim past .82 here without re-measuring.
*/
.ms-root {
  display: flex;
  flex-direction: column;
  /* A flex item defaults to min-width:auto, i.e. min-content — so the strip's
     horizontally-scrolling rail was widening its own container and pushing a
     scrollbar onto the whole page (measured 40px of document overflow). The
     rail is supposed to be the only thing that scrolls. */
  min-width: 0;
}

/* ── Create card ─────────────────────────────────────────────────────────── */
.ms-start {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  flex-wrap: wrap;
  padding: 20px 22px;
  margin-bottom: var(--spacing-lg);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  background: var(--color-navy);
  position: relative;
  overflow: hidden;
}
.ms-start::after {
  content: '';
  position: absolute;
  right: -40px;
  top: -30px;
  width: 210px;
  height: 210px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--primary-rgb), 0.11), transparent 68%);
  pointer-events: none;
}
.ms-start-ico {
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  border-radius: 13px;
  display: grid;
  place-items: center;
  font-size: 19px;
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.11);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
}
.ms-start-txt {
  flex: 1 1 300px;
  min-width: 0;
}
.ms-start-txt h2 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  color: var(--color-text);
  margin: 0 0 4px;
}
.ms-start-txt p {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  opacity: 0.82;
  font-weight: var(--font-weight-light);
  line-height: 1.5;
  margin: 0;
}
.ms-start-cta {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px;
  border: none;
  border-radius: var(--border-radius-full);
  cursor: pointer;
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.ms-start-cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(var(--primary-rgb), 0.35);
}

/* ── Shelf header ────────────────────────────────────────────────────────── */
.ms-head,
.ms-strip-head {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-md);
  margin-bottom: 13px;
}
.ms-strip-head {
  align-items: center;
  flex-wrap: wrap;
}
.ms-head-txt {
  min-width: 0;
}
.ms-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--color-text);
  opacity: 0.9;
  display: flex;
  align-items: center;
  gap: 9px;
}
.ms-count {
  font-family: var(--font-family-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0;
  padding: 2px 7px;
  border-radius: var(--border-radius-sm);
  background: var(--color-darker-2);
  text-transform: none;
}
.ms-sub {
  font-size: var(--font-size-xs);
  color: var(--color-text);
  opacity: 0.82;
  font-weight: var(--font-weight-light);
  margin-top: 3px;
}
.ms-all {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
  color: var(--color-text);
  opacity: 0.88;
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.ms-all:hover {
  opacity: 1;
  border-color: var(--terminal-border-color-light);
}

/* ── Category chips ──────────────────────────────────────────────────────── */
.ms-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: var(--spacing-md);
}
.ms-chip {
  padding: 6px 12px;
  border-radius: var(--border-radius-full);
  cursor: pointer;
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--color-text);
  opacity: 0.82;
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  transition: all var(--transition-fast);
  white-space: nowrap;
}
.ms-chip:hover {
  opacity: 1;
  border-color: var(--terminal-border-color-light);
}
/* The SELECTED chip is a filled pill, not tinted-with-accent-text.
   `color: var(--color-primary)` measured 3.79:1 in light — brand pink on a white
   page, under AA — and the app has no accessible accent-TEXT token, only accent
   FILL pairs. Filling it uses the guaranteed pair, and a solid pill reads as
   "selected" more clearly than a tint anyway. */
.ms-chip.on {
  opacity: 1;
  background: var(--fill-accent);
  border-color: var(--fill-accent);
  color: var(--on-fill-accent);
  font-weight: var(--font-weight-semibold);
}
.ms-chip.on b {
  opacity: 0.75;
}
.ms-chip b {
  font-family: var(--font-family-mono);
  font-weight: 500;
  opacity: 0.7;
  margin-left: 5px;
}

/* ── Card grid ───────────────────────────────────────────────────────────── */
.ms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--spacing-md);
}
.ms-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  background: var(--color-navy);
  cursor: pointer;
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color var(--transition-fast), box-shadow var(--transition-fast);
  animation: msCardRise 300ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  animation-delay: calc(var(--i, 0) * 14ms);
}
@keyframes msCardRise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.ms-card:hover {
  transform: translateY(-4px);
  border-color: rgba(var(--primary-rgb), 0.4);
  box-shadow: 0 16px 40px -14px rgba(0, 0, 0, 0.55);
}
.ms-card-art {
  position: relative;
  height: 116px;
  flex: 0 0 auto;
  overflow: hidden;
}
.ms-art-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ms-card-glyph {
  position: absolute;
  right: -12px;
  bottom: -22px;
  font-size: 118px;
  line-height: 1;
  /* ART-INK RULE: the generated gradient is dark in EVERY theme, so anything
     on top of it must use the literal light ink, never a theme text token. */
  color: var(--text-on-scrim);
  opacity: 0.17;
  transition: transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity var(--transition-fast);
}
.ms-card:hover .ms-card-glyph {
  transform: scale(1.13) rotate(-6deg);
  opacity: 0.23;
}
.ms-art-tags {
  position: absolute;
  top: 11px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ms-tag {
  font-size: 9.5px;
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.09em;
  padding: 4px 9px;
  border-radius: var(--border-radius-full);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-on-scrim);
  background: rgba(7, 7, 16, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.13);
}
/* FILL / ON-FILL PAIRS (see styles/themes/_semantic.css).
   These three badges paint an accent background, so their label colour is a
   function of the theme, not a constant. Using the paired token means the
   contrast is guaranteed where the pair is defined rather than re-derived
   (wrongly) at each call site. */
.ms-tag.new {
  background: var(--fill-info);
  border-color: transparent;
  color: var(--on-fill-info);
}
.ms-tag.hot {
  background: var(--fill-danger);
  border-color: transparent;
  color: var(--on-fill-danger);
}
.ms-tag.rank {
  background: var(--fill-warning);
  border-color: transparent;
  color: var(--on-fill-warning);
}
.ms-tag.price {
  margin-left: auto;
  font-family: var(--font-family-mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}
.ms-tag.price.free {
  /* This label is the ONE tag painted in an accent rather than --text-on-scrim,
     and it sits on a generated gradient whose hue varies per item. Composited
     against the brightest stop the tool hue can produce (hsl(59 62% 52%)), the
     shared 0.55 scrim left it at 4.23:1 — under AA. 0.72 measures 7.08:1 at the
     worst hue of all four asset types. */
  color: var(--color-green);
  background: rgba(7, 7, 16, 0.72);
  border-color: rgba(var(--green-rgb), 0.35);
}
.ms-card-icon {
  position: absolute;
  left: 16px;
  top: 90px;
  z-index: 2;
  width: 52px;
  height: 52px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  font-size: 21px;
  border: 1.5px solid var(--color-black-navy);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
  transition: transform var(--transition-fast);
}
.ms-card:hover .ms-card-icon {
  transform: translateY(-3px) scale(1.05);
}
.ms-card-body {
  padding: 52px var(--spacing-md) 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}
.ms-card-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.015em;
  line-height: 1.25;
  margin: 0 0 3px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ms-card-by {
  font-size: var(--font-size-xs);
  color: var(--color-text);
  opacity: 0.82;
  margin-bottom: 9px;
  min-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ms-card-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text);
  opacity: 0.82;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0 0 12px;
  min-height: 38px;
}
.ms-card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-bottom: 12px;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  opacity: 0.82;
}
/* both rating variants share a box height so the star row and the "Unrated"
   row sit on one baseline */
.ms-m,
.ms-m-unrated {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 16px;
  line-height: 1;
}
.ms-m b {
  font-weight: var(--font-weight-medium);
}
.ms-m-star i {
  color: var(--color-yellow);
}
.ms-card-foot {
  display: flex;
  gap: 8px;
  padding: 0 16px 16px;
}
.ms-inst {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 14px;
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
  color: var(--color-text);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.ms-card:hover .ms-inst:not(:disabled) {
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
  border-color: var(--color-primary);
  box-shadow: 0 6px 18px rgba(var(--primary-rgb), 0.3);
}
.ms-inst:disabled {
  cursor: default;
  opacity: 0.7;
}

/* ── No match ────────────────────────────────────────────────────────────── */
.ms-empty {
  text-align: center;
  padding: 48px 24px;
}
.ms-empty-ico {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 24px;
  background: var(--color-darker-2);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}
.ms-empty h3 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 6px;
  color: var(--color-text);
}
.ms-empty p {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  opacity: 0.82;
  margin: 0 0 16px;
}
.ms-empty-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 20px;
  border: none;
  border-radius: var(--border-radius-full);
  cursor: pointer;
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
  font-family: var(--font-family-primary);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
}

/* ── Strip variant ───────────────────────────────────────────────────────── */
.ms-strip {
  border-top: 1px solid var(--terminal-border-color);
  padding-top: var(--spacing-lg);
  margin-top: var(--spacing-sm);
  min-width: 0; /* see .ms-root */
}
.ms-dismiss {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
  transition: color var(--transition-fast);
}
.ms-dismiss:hover {
  color: var(--color-text);
}
.ms-rail {
  /* A column-flow grid contributes its MAX-CONTENT width to ancestors, so six
     320px rows tried to make the whole screen ~1900px wide. width/max-width:100%
     resolves the rail against its containing block instead, and overflow-x keeps
     the scrolling inside the rail where it belongs. min-width:0 alone was not
     enough once an ancestor was shrink-to-fit. */
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(300px, 320px);
  gap: var(--spacing-sm);
  overflow-x: auto;
  padding-bottom: 10px;
  scroll-snap-type: x mandatory;
  /* fades the right edge so a rail that overflows LOOKS like it overflows,
     rather than reading as a hard clip */
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 56px), transparent);
  mask-image: linear-gradient(90deg, #000 calc(100% - 56px), transparent);
}
.ms-rail > * {
  scroll-snap-align: start;
}
.ms-rail::-webkit-scrollbar {
  height: 6px;
}
.ms-rail::-webkit-scrollbar-thumb {
  background: var(--terminal-border-color);
  border-radius: 3px;
}
.ms-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  background: var(--color-navy);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.ms-row:hover {
  border-color: rgba(var(--primary-rgb), 0.4);
}
.ms-row-ico {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 14px;
}
.ms-row-txt {
  flex: 1;
  min-width: 0;
}
.ms-row-txt h4 {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0 0 2px;
}
.ms-row-txt p {
  font-size: 10.5px;
  color: var(--color-text);
  opacity: 0.82;
  font-weight: 300;
  white-space: nowrap;
  font-family: var(--font-family-mono);
  margin: 0;
  flex: 0 0 auto;
}
.ms-row-get {
  flex: 0 0 auto;
  padding: 6px 12px;
  border-radius: var(--border-radius-full);
  cursor: pointer;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
  color: var(--color-text);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  transition: all var(--transition-fast);
}
.ms-row:hover .ms-row-get:not(:disabled) {
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
  border-color: var(--color-primary);
}

@media (max-width: 900px) {
  .ms-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ms-card {
    animation: none;
    transition: none;
  }
  .ms-card:hover {
    transform: none;
  }
}
</style>
