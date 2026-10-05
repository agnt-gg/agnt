<template>
  <div class="plugins-container" :class="{ 'is-forge': isForgeMode }">
    <!-- ═══ FORGE: building a plugin ═══ -->
    <PluginBuilder
      v-if="activeTab === 'builder'"
      :installed-names="installedNames"
      @back="openLibrary()"
      @open-pack="activeTab = 'pack-studio'"
      @publish="openPublishByName"
      @show-alert="(title, msg) => emit('show-alert', title, msg)"
      @plugin-installed="onPluginInstalled"
    />

    <!-- ═══ FORGE: composing a pack ═══ -->
    <div v-else-if="activeTab === 'pack-studio'" class="pack-shell">
      <header class="pack-bar">
        <button class="crumb-back" @click="openLibrary()">
          <i class="fas fa-arrow-left"></i>
          <span>Plugin Forge</span>
        </button>
        <span class="crumb-sep">/</span>
        <span class="crumb-current">New pack</span>
      </header>
      <div class="pack-body">
        <PackStudio @show-alert="(title, msg) => emit('show-alert', title, msg)" @plugin-installed="onPluginInstalled" />
      </div>
    </div>

    <!-- ═══ LIBRARY ═══ -->
    <template v-else>
      <header class="library-bar">
        <h2 v-if="!mobileView" class="library-title">Plugin Forge</h2>
        <span class="bar-spacer"></span>
        <div v-if="!mobileView" class="library-search">
          <BaseInput v-model="searchQuery" :placeholder="activeTab === 'marketplace' ? 'Search marketplace' : 'Search plugins'" :clearable="true" />
        </div>
        <BaseButton class="btn-compact" variant="secondary" v-tooltip="'Install a .agnt file. You can also drop one anywhere on this page.'" @click="triggerFileUpload">
          <i class="fas fa-file-import"></i> Install file
        </BaseButton>
        <BaseButton class="btn-compact" variant="primary" @click="newPlugin"> <i class="fas fa-plus"></i> New plugin </BaseButton>
        <input ref="fileInput" type="file" accept=".agnt,.tar.gz,.tgz" class="file-input" @change="handleFileSelect" />
      </header>

      <nav class="tabs" role="tablist">
        <button class="tab" :class="{ active: activeTab === 'installed' }" role="tab" @click="activeTab = 'installed'">
          Installed <span class="tab-count">{{ installedPlugins.length }}</span><!--
          The only badge left on this screen, and it counts one thing: updates
          held back because they asked for more than the installed version had.
          --><span v-if="reviewCount > 0" class="review-count">{{ reviewCount }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'marketplace' }" role="tab" @click="activeTab = 'marketplace'">
          Discover <span class="tab-count">{{ marketplacePlugins.length }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'mine' }" role="tab" @click="activeTab = 'mine'">
          My builds <span class="tab-count">{{ myBuildCount }}</span>
        </button>
      </nav>

      <div class="library-body" :class="{ 'is-dropping': isDropping }" @dragover.prevent="isDropping = true" @dragleave.self="isDropping = false" @drop.prevent="onDrop">
        <div v-if="activeTab === 'installed' && reviewCount > 0 && firstReviewPlugin" class="review-banner">
          <i class="fas fa-shield-alt"></i>
          <span>
            <b>{{ reviewCount === 1 ? '1 update needs review.' : `${reviewCount} updates need review.` }}</b>
            {{ getDisplayName(firstReviewPlugin) }} asks for new permissions.
          </span>
          <span class="bar-spacer"></span>
          <BaseButton class="btn-compact review-action" variant="secondary" :disabled="updatingName === firstReviewPlugin.name" @click="reviewUpdate(firstReviewPlugin)">Review</BaseButton>
        </div>

        <MobileCollection
          v-if="mobileView"
          view-id="plugins"
          :title="mobileTitle"
          count-label="plugins"
          :items="mobileItems"
          v-model:search="searchQuery"
          :selected-id="selectedPlugin?.name"
          icon="fas fa-plug"
          @select="selectPlugin"
        >
          <template #item="{ item }">
            <span class="m-plugin-version">v{{ item.version }} · {{ item.trustTier || 'Trust not reported' }}</span>
            <button v-if="activeTab === 'installed'" @click="togglePin(item)">{{ isPinned(item) ? 'Allow automatic updates' : 'Pin version' }}</button>
            <button v-if="pluginNotices[item.name]?.needsReview" @click="reviewUpdate(item)">Review update</button>
            <button v-if="activeTab === 'marketplace' && !isPluginInstalled(item.name)" @click="installPlugin(item)">{{ item.price > 0 ? `Buy $${item.price.toFixed(2)}` : 'Install' }}</button>
            <button v-if="activeTab === 'mine'" @click="openInForge(item)">Open in Forge</button>
            <button @click="selectPlugin(item)">Details & tools</button>
          </template>
        </MobileCollection>

        <div v-else-if="isLoading" class="loading-state"><i class="fas fa-spinner fa-spin"></i> Loading plugins…</div>

        <!-- Installed -->
        <div v-else-if="activeTab === 'installed'" class="plugins-grid" @click.self="deselectPlugin">
          <div
            v-for="plugin in filteredInstalledPlugins"
            :key="plugin.name"
            class="plugin-card installed"
            :class="{ selected: selectedPlugin?.name === plugin.name }"
            @click="selectPlugin(plugin)"
          >
            <div class="plugin-header">
              <div class="plugin-icon"><SvgIcon :name="plugin.icon || 'custom'" /></div>
              <div class="plugin-info">
                <h3 class="plugin-name">{{ getDisplayName(plugin) }}</h3>
                <span class="plugin-version">v{{ plugin.version }}<template v-if="plugin.author"> · {{ plugin.author }}</template></span>
              </div>
              <div class="plugin-status">
                <div class="card-menu" v-click-outside="() => closeMenu(plugin.name)">
                  <button class="card-menu-btn" aria-label="More actions" @click.stop="toggleMenu(plugin.name)">
                    <i class="fas fa-ellipsis-h"></i>
                  </button>
                  <div v-if="openMenuFor === plugin.name" class="card-menu-items">
                    <button class="card-menu-item" @click.stop="togglePin(plugin)">
                      <i class="fas" :class="isPinned(plugin) ? 'fa-unlock' : 'fa-thumbtack'"></i>
                      {{ isPinned(plugin) ? 'Allow automatic updates' : 'Pin to v' + plugin.version }}
                    </button>
                    <button class="card-menu-item" @click.stop="openInForge(plugin)"><i class="fas fa-pen"></i> Open in Forge</button>
                    <button class="card-menu-item" @click.stop="openPublish(plugin)"><i class="fas fa-cloud-upload-alt"></i> Publish…</button>
                  </div>
                </div>
              </div>
            </div>

            <p class="plugin-description">{{ plugin.description || 'No description available' }}</p>

            <div class="plugin-footer">
              <span class="footer-meta">
                <span class="meta-tag">{{ toolCount(plugin) }}</span>
                <!-- trust system Layer 6: display-only trust badge (0.6.0 ladder) -->
                <Tooltip v-if="plugin.trustTier" :title="trustTierLabel(plugin.trustTier)" :text="trustTooltipText(plugin)" position="top" width="300px">
                  <span class="trust-badge" :class="'trust-' + plugin.trustTier"><span class="trust-dot"></span>{{ plugin.trustTier }}</span>
                </Tooltip>
              </span>
              <!-- At most one chip, and it is only actionable for a refused update. -->
              <button
                v-if="pluginNotices[plugin.name]?.needsReview"
                class="notice-chip review"
                :disabled="updatingName === plugin.name"
                @click.stop="reviewUpdate(plugin)"
              >
                <i class="fas fa-shield-alt"></i>
                {{ updatingName === plugin.name ? 'Updating…' : 'Update needs review' }}
              </button>
              <span v-else-if="pluginNotices[plugin.name]" class="notice-chip" :class="pluginNotices[plugin.name].kind" v-tooltip="pluginNotices[plugin.name].detail">
                <i :class="pluginNotices[plugin.name].icon"></i> {{ pluginNotices[plugin.name].label }}
              </span>
              <span v-else class="status-badge installed"><i class="fas fa-check"></i> Installed</span>
            </div>
          </div>

          <p v-if="searchQuery && filteredInstalledPlugins.length === 0" class="grid-note">No installed plugins match “{{ searchQuery }}”.</p>

          <button class="new-card" @click="newPlugin">
            <i class="fas fa-plus"></i>
            <b>Build a plugin</b>
            <span>Describe it, the Forge writes it</span>
          </button>
        </div>

        <!-- Discover -->
        <template v-else-if="activeTab === 'marketplace'">
          <div v-if="discoverCategories.length > 1" class="category-row">
            <button class="category" :class="{ active: !categoryFilter }" @click="categoryFilter = null">All</button>
            <button v-for="category in discoverCategories" :key="category" class="category" :class="{ active: categoryFilter === category }" @click="categoryFilter = category">
              {{ category }}
            </button>
          </div>

          <div v-if="discoverPlugins.length === 0" class="empty-state">
            <i class="fas fa-store"></i>
            <p>{{ searchQuery ? `Nothing in the marketplace matches “${searchQuery}”.` : 'No plugins in the marketplace yet.' }}</p>
          </div>

          <div v-else class="plugins-grid" @click.self="deselectPlugin">
            <div
              v-for="plugin in discoverPlugins"
              :key="plugin.name"
              class="plugin-card"
              :class="{ selected: selectedPlugin?.name === plugin.name }"
              @click="selectPlugin(plugin)"
            >
              <div class="plugin-header">
                <div class="plugin-icon"><SvgIcon :name="plugin.icon || 'puzzle-piece'" /></div>
                <div class="plugin-info">
                  <h3 class="plugin-name">{{ getDisplayName(plugin) }}</h3>
                  <span class="plugin-version">v{{ plugin.version }}<template v-if="plugin.author"> · {{ plugin.author }}</template></span>
                </div>
              </div>

              <p class="plugin-description">{{ plugin.description || 'No description available' }}</p>

              <div class="plugin-footer">
                <span class="footer-meta">
                  <span class="meta-tag">{{ plugin.price > 0 ? `$${plugin.price.toFixed(2)}` : 'Free' }}</span>
                  <!-- trust system Layer 6: pre-install trust badge (from stamped marketplace record) -->
                  <Tooltip v-if="plugin.trustTier" :title="trustTierLabel(plugin.trustTier)" :text="trustTooltipText(plugin, true)" position="top" width="300px">
                    <span class="trust-badge" :class="'trust-' + plugin.trustTier"><span class="trust-dot"></span>{{ plugin.trustTier }}</span>
                  </Tooltip>
                </span>
                <span v-if="isPluginInstalled(plugin.name)" class="status-badge installed"><i class="fas fa-check"></i> Installed</span>
                <BaseButton v-else variant="primary" class="btn-compact" :disabled="installingPlugin === plugin.name" @click.stop="installPlugin(plugin)">
                  <i v-if="installingPlugin === plugin.name" class="fas fa-spinner fa-spin"></i>
                  {{ installingPlugin === plugin.name ? 'Installing…' : plugin.price > 0 ? `Buy $${plugin.price.toFixed(2)}` : 'Install' }}
                </BaseButton>
              </div>
            </div>
          </div>
        </template>

        <!-- My builds -->
        <div v-else-if="activeTab === 'mine'" class="plugins-grid" @click.self="deselectPlugin">
          <div v-if="forgeDraft" class="plugin-card draft-card" @click="continueDraft">
            <div class="plugin-header">
              <div class="plugin-icon"><i class="fas fa-magic"></i></div>
              <div class="plugin-info">
                <h3 class="plugin-name">{{ forgeDraft.title }}</h3>
                <span class="plugin-version">Unfinished in the Forge</span>
              </div>
              <div class="plugin-status"><span class="status-badge draft">Draft</span></div>
            </div>
            <p class="plugin-description">{{ forgeDraft.description }}</p>
            <div class="plugin-footer">
              <span class="meta-tag">{{ forgeDraft.detail }}</span>
              <BaseButton variant="primary" class="btn-compact" @click.stop="continueDraft">Continue</BaseButton>
            </div>
          </div>

          <div
            v-for="plugin in myBuildPlugins"
            :key="plugin.name"
            class="plugin-card"
            :class="{ selected: selectedPlugin?.name === plugin.name }"
            @click="selectPlugin(plugin)"
          >
            <div class="plugin-header">
              <div class="plugin-icon"><SvgIcon :name="plugin.icon || 'custom'" /></div>
              <div class="plugin-info">
                <h3 class="plugin-name">{{ getDisplayName(plugin) }}</h3>
                <span class="plugin-version">v{{ plugin.version }}</span>
              </div>
              <div class="plugin-status">
                <span v-if="publishedListingFor(plugin)" class="status-badge published">Published v{{ publishedListingFor(plugin).current_version }}</span>
                <span v-else class="status-badge private">Only on this machine</span>
              </div>
            </div>
            <p class="plugin-description">{{ plugin.description || 'No description available' }}</p>
            <div class="plugin-footer">
              <button class="text-link" @click.stop="openPublish(plugin)">{{ publishedListingFor(plugin) ? 'Publish update…' : 'Publish…' }}</button>
              <BaseButton variant="secondary" class="btn-compact" @click.stop="openInForge(plugin)"><i class="fas fa-pen"></i> Open in Forge</BaseButton>
            </div>
          </div>

          <p v-if="!forgeDraft && myBuildPlugins.length === 0" class="grid-note">
            {{ searchQuery ? `None of your builds match “${searchQuery}”.` : 'Plugins you build in the Forge or publish show up here.' }}
          </p>

          <button class="new-card" @click="newPlugin">
            <i class="fas fa-plus"></i>
            <b>Build a plugin</b>
            <span>Describe it, the Forge writes it</span>
          </button>
        </div>
      </div>
    </template>

    <!-- ═══ PUBLISH: a side sheet over whatever is open ═══ -->
    <Teleport to="body">
      <div v-if="publishSelectedPlugin" class="publish-scrim" @click.self="closePublish">
        <aside class="publish-sheet" role="dialog" aria-modal="true" :aria-label="`Publish ${getDisplayName(publishSelectedPlugin)}`">
          <header class="sheet-head">
            <h3>{{ isUpdateMode ? 'Publish update' : 'Publish' }} · {{ getDisplayName(publishSelectedPlugin) }}</h3>
            <button class="icon-button" aria-label="Close" @click="closePublish"><i class="fas fa-times"></i></button>
          </header>

          <div class="sheet-body">
            <!-- Update mode: listing copy is edited from the marketplace panel;
                 here we only ship the new package + changelog. -->
            <template v-if="isUpdateMode">
              <div class="version-summary" :class="{ blocked: !versionCanPublish }">
                <i class="fas" :class="versionCanPublish ? 'fa-arrow-up' : 'fa-exclamation-triangle'"></i>
                <span v-if="versionCanPublish">
                  v{{ selectedPublishedListing.current_version }} → <b>v{{ publishSelectedPlugin.version }}</b>
                </span>
                <span v-else>{{ versionBlockReason }}</span>
              </div>
              <label class="form-row">
                <span>Changelog</span>
                <textarea v-model="publishForm.changelog" class="form-textarea" placeholder="What changed in this version?" rows="4"></textarea>
              </label>
            </template>

            <template v-else>
              <div class="form-row">
                <span>Name</span>
                <BaseInput v-model="publishForm.displayName" placeholder="My Awesome Plugin" />
              </div>
              <label class="form-row">
                <span>Description</span>
                <textarea v-model="publishForm.description" class="form-textarea" placeholder="Describe what your plugin does…" rows="3"></textarea>
              </label>
              <div class="form-row">
                <span>Category</span>
                <BaseSelect v-model="publishForm.category" :options="categoryOptions" />
              </div>
              <div class="form-row">
                <span>Tags</span>
                <BaseInput v-model="publishForm.tags" placeholder="api, automation, productivity" />
              </div>
              <div class="form-row">
                <span>Price</span>
                <div class="price-toggle" role="radiogroup">
                  <button class="price-option" :class="{ active: publishForm.isFree }" role="radio" :aria-checked="publishForm.isFree" @click="publishForm.isFree = true">Free</button>
                  <button class="price-option" :class="{ active: !publishForm.isFree }" role="radio" :aria-checked="!publishForm.isFree" @click="publishForm.isFree = false">Paid</button>
                </div>
              </div>
              <div v-if="!publishForm.isFree" class="form-row">
                <span>Price (USD)</span>
                <BaseInput v-model="publishForm.price" type="number" placeholder="9.99" />
              </div>

              <!-- Revenue Info (when price > 0) -->
              <div v-if="!publishForm.isFree && parseFloat(publishForm.price) > 0" class="sheet-note">
                <i class="fas fa-info-circle"></i>
                <span>{{ getRevenueMainText() }} <span class="muted">{{ getRevenueComparisonText() }}</span></span>
              </div>

              <!-- Stripe Connect Warning -->
              <div v-if="!publishForm.isFree && parseFloat(publishForm.price) > 0 && !stripeConnected" class="sheet-note warn">
                <i class="fas fa-exclamation-triangle"></i>
                <span>You need Stripe Connect to sell paid plugins.</span>
                <button class="text-link" @click="setupStripe">Set up payments</button>
              </div>
            </template>

            <div class="checklist">
              <b>Before you publish</b>
              <span v-for="check in publishChecks" :key="check.label" class="check" :class="check.state">
                <i class="fas" :class="check.state === 'ok' ? 'fa-check' : check.state === 'bad' ? 'fa-times' : 'fa-minus'"></i>
                {{ check.label }}
              </span>
            </div>

            <p class="sheet-note">
              <i class="fas fa-info-circle"></i>
              <span v-if="isUpdateMode">The new package is re-scanned on upload. People on an older version get it as an update.</span>
              <span v-else>Your plugin is reviewed before it appears in the marketplace.</span>
            </p>
          </div>

          <footer class="sheet-foot">
            <BaseButton class="btn-compact" variant="secondary" @click="closePublish">Cancel</BaseButton>
            <BaseButton class="btn-compact" variant="primary" :disabled="isPublishing || !canPublish" @click="publishPlugin">
              <i class="fas" :class="isPublishing ? 'fa-spinner fa-spin' : isUpdateMode ? 'fa-arrow-up' : 'fa-cloud-upload-alt'"></i>
              <template v-if="isPublishing">Publishing…</template>
              <template v-else>Publish v{{ publishSelectedPlugin.version }}</template>
            </BaseButton>
          </footer>
        </aside>
      </div>
    </Teleport>

    <!-- Simple Modal for Confirmations -->
    <SimpleModal ref="modalRef" />
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue';
import { useStore } from 'vuex';
import MobileCollection from '@/mobile/MobileCollection.vue';
import BaseInput from '@/views/Terminal/_components/BaseInput.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import PluginBuilder from './PluginBuilder.vue';
import PackStudio from './PackStudio.vue';
import { API_CONFIG } from '@/tt.config.js';
import { checkPluginVersionPublishable } from '@/utils/pluginVersion.js';
import { apiFetch } from '@/utils/apiFetch.js';

/** Library views; every other activeTab value is a Forge mode. */
const LIBRARY_VIEWS = ['installed', 'marketplace', 'mine'];

const CATEGORY_OPTIONS = [
  { value: 'integration', label: 'Integration' },
  { value: 'utility', label: 'Utility' },
  { value: 'ai', label: 'AI/ML' },
  { value: 'data', label: 'Data' },
  { value: 'communication', label: 'Communication' },
  { value: 'other', label: 'Other' },
];

/** Close an open card menu on any click that lands outside it. */
const clickOutside = {
  beforeMount(el, binding) {
    el.__clickOutside__ = (event) => {
      if (!(el === event.target || el.contains(event.target))) binding.value(event);
    };
    document.addEventListener('click', el.__clickOutside__);
  },
  unmounted(el) {
    document.removeEventListener('click', el.__clickOutside__);
    delete el.__clickOutside__;
  },
};

/**
 * SimpleModal renders `message` with v-html, and a permission string is not
 * ours: normalizePermissions() passes any string in a plugin's manifest
 * through verbatim, including `domain:<anything>`. The consent dialog is the
 * one place a refused update still gets to put text on screen, so it is the
 * one place that must not let that text become markup.
 */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

export default {
  name: 'Plugins',
  directives: { clickOutside },
  components: { MobileCollection,
    BaseInput,
    BaseSelect,
    BaseButton,
    SvgIcon,
    SimpleModal,
    Tooltip,
    PluginBuilder,
    PackStudio,
  },
  emits: ['show-alert'],
  setup(props, { emit }) {
    const store = useStore();
    const mobileView = inject('isMobile', ref(false));
    const modalRef = ref(null);
    const searchQuery = ref('');
    const isLoading = ref(false);
    const installedPlugins = ref([]);
    const marketplacePlugins = ref([]);
    const installingPlugin = ref(null);
    const uninstallingPlugin = ref(null);
    const fileInput = ref(null);
    const isDropping = ref(false);
    const categoryFilter = ref(null);
    const playSound = inject('playSound', () => {});

    // Publish tab state
    const publishSelectedPlugin = ref(null);
    const isPublishing = ref(false);
    // Listings this user has already published, keyed by plugin asset_id.
    // Drives update-vs-create: `POST /marketplace/publish` is create-only and
    // 409s on a second call, so publishing an update needs the listing id.
    const myPublishedPlugins = ref([]);
    /** The user's own marketplace listing for an installed plugin, if any. */
    function publishedListingFor(plugin) {
      if (!plugin?.name) return null;
      return myPublishedPlugins.value.find((item) => item.asset_id === plugin.name) || null;
    }

    const selectedPublishedListing = computed(() => publishedListingFor(publishSelectedPlugin.value));
    const isUpdateMode = computed(() => Boolean(selectedPublishedListing.value));

    const versionCheck = computed(() => {
      const listing = selectedPublishedListing.value;
      if (!listing) return { ok: true, reason: '' };
      return checkPluginVersionPublishable(publishSelectedPlugin.value?.version, listing.current_version);
    });

    const versionCanPublish = computed(() => versionCheck.value.ok);
    const versionBlockReason = computed(() => versionCheck.value.reason);

    /**
     * Single source of truth: the marketplace store owns fetching + caching +
     * the older-server fallback. Duplicating the fetch here is how the two
     * would drift.
     */
    async function fetchMyPublishedPlugins() {
      try {
        if (!localStorage.getItem('token')) return;
        await store.dispatch('marketplace/fetchMyPublishedItems', { force: true });
        const items = store.state.marketplace?.myPublishedItems || [];
        myPublishedPlugins.value = items.filter((item) => item.asset_type === 'plugin');
      } catch (error) {
        // Non-fatal: without this the tab simply falls back to create-only.
        console.warn('Could not load published plugin listings:', error.message);
      }
    }

    const publishForm = ref({
      displayName: '',
      description: '',
      category: 'utility',
      tags: '',
      isFree: true,
      price: '',
      changelog: '',
    });

    /**
     * Best-effort owner/repo from a plugin manifest. Stored as
     * metadata.repository on first publish: the provenance endpoint matches a
     * listing by that field, so a listing without it can never be upgraded to
     * the verified tier no matter how the CI workflow is configured.
     */
    function extractRepository(plugin) {
      const candidates = [plugin?.repository?.url, plugin?.repository, plugin?.homepage].filter((v) => typeof v === 'string');
      for (const candidate of candidates) {
        const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/#?]|$)/i.exec(candidate);
        if (match) return match[1];
      }
      return undefined;
    }

    // Shared state from store
    const activeTab = computed({
      get: () => store.getters['connectors/activeTab'],
      set: (val) => store.dispatch('connectors/setActiveTab', val),
    });

    const selectedPlugin = computed(() => store.getters['connectors/selectedPlugin']);

    // ============ Views: a library, and the Forge ============
    //
    // Five peer tabs used to mix browsing (Installed, Marketplace) with
    // making (Build, Pack Studio, Publish). Browsing is now three views of
    // one library; making is the Forge, a separate full-height screen that
    // the library opens and returns from. Publish is a sheet, not a place.
    const isForgeMode = computed(() => !LIBRARY_VIEWS.includes(activeTab.value));
    const lastLibraryView = ref(LIBRARY_VIEWS.includes(activeTab.value) ? activeTab.value : 'installed');
    watch(activeTab, (tab) => {
      if (LIBRARY_VIEWS.includes(tab)) lastLibraryView.value = tab;
    });

    function openLibrary(view = lastLibraryView.value) {
      activeTab.value = view;
    }

    const installedNames = computed(() => installedPlugins.value.map((plugin) => plugin.name));

    const builder = computed(() => store.state.pluginBuilder || {});
    const hasUninstalledWork = computed(() => Boolean(store.getters['pluginBuilder/hasUninstalledWork']));

    /** The Forge's current draft, when it holds work that is not installed. */
    const forgeDraft = computed(() => {
      const state = builder.value;
      const manifest = state.generatedManifest;
      if (manifest && hasUninstalledWork.value) {
        const tools = manifest.tools?.length || 0;
        return {
          title: getDisplayName({ name: manifest.name || 'new-plugin', displayName: manifest.displayName }),
          description: manifest.description || state.pluginDescription || '',
          detail: `${tools} ${tools === 1 ? 'tool' : 'tools'} · not installed`,
        };
      }
      if (!manifest && state.conversation?.length) {
        return { title: 'New plugin', description: state.pluginDescription || '', detail: 'Not generated yet' };
      }
      return null;
    });

    /** Installed plugins this user made: built in the Forge here, or published. */
    const myBuildPlugins = computed(() => {
      const built = new Set(builder.value.builtPluginNames || []);
      const query = searchQuery.value.toLowerCase();
      return sortedInstalledPlugins.value.filter(
        (plugin) =>
          (built.has(plugin.name) || publishedListingFor(plugin)) &&
          (!query || plugin.name.toLowerCase().includes(query) || (plugin.description || '').toLowerCase().includes(query)),
      );
    });
    const myBuildCount = computed(() => myBuildPlugins.value.length + (forgeDraft.value ? 1 : 0));

    /** Categories the marketplace data actually carries; the row hides below two. */
    const discoverCategories = computed(() =>
      [...new Set(marketplacePlugins.value.map((plugin) => plugin.category).filter((value) => typeof value === 'string' && value))].sort(),
    );
    const discoverPlugins = computed(() =>
      filteredMarketplacePlugins.value.filter((plugin) => !categoryFilter.value || plugin.category === categoryFilter.value),
    );

    const firstReviewPlugin = computed(() => installedPlugins.value.find((plugin) => pluginNotices.value[plugin.name]?.needsReview) || null);

    const mobileTitle = computed(() => ({ installed: 'Plugins', marketplace: 'Discover', mine: 'My builds' })[activeTab.value] || 'Plugins');
    const mobileItems = computed(() => {
      if (activeTab.value === 'marketplace') return discoverPlugins.value;
      if (activeTab.value === 'mine') return myBuildPlugins.value;
      return filteredInstalledPlugins.value;
    });

    function toolCount(plugin) {
      const count = plugin.tools?.length || 0;
      return `${count} ${count === 1 ? 'tool' : 'tools'}`;
    }

    /**
     * Opening the Forge for something else replaces the draft. Ask first when
     * the draft holds work that exists nowhere else. Resolves to whether the
     * caller may go ahead.
     */
    async function confirmReplaceDraft(nextLabel) {
      if (!hasUninstalledWork.value) return true;
      return Boolean(
        await modalRef.value?.showModal({
          title: 'Replace your unfinished plugin?',
          message: `“${forgeDraft.value?.title || 'Your draft'}” has changes that are not installed. ${nextLabel} discards them.`,
          confirmText: 'Discard draft',
          cancelText: 'Keep it',
          showCancel: true,
          confirmClass: 'btn-danger',
        }),
      );
    }

    /** New plugin: an unfinished draft is offered back rather than silently dropped. */
    async function newPlugin() {
      if (forgeDraft.value) {
        const startFresh = await modalRef.value?.showModal({
          title: 'You have an unfinished plugin',
          message: `Continue “${forgeDraft.value.title}”, or start a new one? Starting a new one discards it.`,
          confirmText: 'Start new',
          cancelText: 'Continue draft',
          showCancel: true,
          confirmClass: 'btn-danger',
        });
        if (startFresh) store.dispatch('pluginBuilder/resetAll');
      } else if (builder.value.generatedManifest) {
        // The Forge still shows an installed plugin; a new one starts clean.
        store.dispatch('pluginBuilder/resetAll');
      }
      activeTab.value = 'builder';
    }

    function continueDraft() {
      activeTab.value = 'builder';
    }

    async function openInForge(plugin) {
      openMenuFor.value = null;
      const alreadyOpen = builder.value.generatedManifest?.name === plugin.name;
      if (!alreadyOpen && !(await confirmReplaceDraft(`Opening “${getDisplayName(plugin)}”`))) return;
      activeTab.value = 'builder';
      if (alreadyOpen) return;
      const result = await store.dispatch('pluginBuilder/loadPluginForEditing', plugin.name);
      if (!result?.success) emit('show-alert', 'Could not open plugin', result?.error || 'Its source could not be loaded.');
    }

    // Stripe Connect status from store
    const stripeConnected = computed(() => store.getters['userAuth/stripeConnected'] || false);

    // Watch for refresh trigger from SecretsPanel
    watch(
      () => store.getters['connectors/refreshTrigger'],
      () => {
        refreshPlugins();
      },
    );

    const filteredInstalledPlugins = computed(() => {
      let plugins = [...installedPlugins.value];
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        plugins = plugins.filter((p) => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
      }
      // Sort alphabetically by display name
      plugins.sort((a, b) => {
        const nameA = (a.displayName || a.name).toLowerCase();
        const nameB = (b.displayName || b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      return plugins;
    });

    const filteredMarketplacePlugins = computed(() => {
      let plugins = [...marketplacePlugins.value];
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        plugins = plugins.filter((p) => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
      }
      // Sort alphabetically by display name
      plugins.sort((a, b) => {
        const nameA = (a.displayName || a.name).toLowerCase();
        const nameB = (b.displayName || b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      return plugins;
    });

    // Sorted installed plugins for publish tab (no search filter, just alphabetical)
    const sortedInstalledPlugins = computed(() => {
      return [...installedPlugins.value].sort((a, b) => {
        const nameA = (a.displayName || a.name).toLowerCase();
        const nameB = (b.displayName || b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    });

    function isPluginInstalled(name) {
      return installedPlugins.value.some((p) => p.name === name);
    }

    function getDisplayName(plugin) {
      if (plugin.displayName) return plugin.displayName;
      return plugin.name
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    // ============ Updates: silent by default, one interrupt ============
    //
    // Updating is infrastructure, not a decision. The background scheduler
    // applies anything that does not widen a plugin's powers, and the
    // permission-diff gate refuses anything that does — so the refusal is the
    // only event worth a human. Everything else is a chip on the card the
    // plugin already occupies.
    //
    // What used to be here: an Updates tab, a "Check for Updates" button, a
    // "Check automatically (daily)" checkbox and an auto/notify/pinned
    // dropdown on every row — 2 + 2N controls, none of which asked a question
    // the user could answer better than the program could.
    const updateStatus = ref(null);
    const updatingName = ref(null);
    const openMenuFor = ref(null);

    /**
     * At most ONE chip per installed plugin, ranked.
     *
     * A card has room for exactly one fact, and "this needs your decision"
     * outranks "this changed on its own", which outranks "this is frozen".
     * Assignment therefore runs lowest priority first and lets later writes win.
     */
    const pluginNotices = computed(() => {
      const status = updateStatus.value || {};
      const notices = {};

      for (const plugin of installedPlugins.value) {
        if (plugin.updatePolicy === 'pinned') {
          notices[plugin.name] = {
            kind: 'pinned',
            icon: 'fas fa-thumbtack',
            label: 'Pinned',
            detail: `Staying on v${plugin.version}. Updates are not applied.`,
          };
        }
      }

      for (const entry of status.autoUpdated || []) {
        notices[entry.name] = {
          kind: 'updated',
          icon: 'fas fa-check-circle',
          label: `Updated to v${entry.version}`,
          detail: 'Applied automatically because it requested nothing new.',
        };
      }

      // `failed` was `notified` before the notify policy was removed. Only its
      // error entries ever carried anything, so old status files still read.
      const failures = [...(status.failed || []), ...(status.notified || []).filter((n) => n && n.error)];
      for (const entry of failures) {
        notices[entry.name] = {
          kind: 'failed',
          icon: 'fas fa-exclamation-triangle',
          label: 'Update failed',
          detail: String(entry.error || 'Unknown error'),
        };
      }

      for (const entry of status.blockedOnConsent || []) {
        const added = (entry.permissionDiff?.added || []).join(', ');
        notices[entry.name] = {
          kind: 'review',
          icon: 'fas fa-shield-alt',
          label: 'Update needs review',
          needsReview: true,
          detail: added
            ? `The new version requests ${added}. Nothing was installed.`
            : 'The new version requests permissions the installed one does not have. Nothing was installed.',
        };
      }

      return notices;
    });

    // Scoped to plugins that are actually installed, so a stale status entry
    // for something since removed cannot advertise work that no longer exists.
    const reviewCount = computed(
      () => installedPlugins.value.filter((p) => pluginNotices.value[p.name]?.needsReview).length,
    );

    /**
     * The last background pass. A missing summary is not an error — it means
     * no pass has run — and a client can outlive the server it talks to, so a
     * 404 whose body is not JSON must not throw here.
     */
    async function loadUpdateStatus() {
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update-status`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.success) updateStatus.value = data.status;
      } catch (err) {
        console.warn('[Plugins] update status unavailable:', err.message);
      }
    }

    function isPinned(plugin) {
      return plugin.updatePolicy === 'pinned';
    }

    function toggleMenu(name) {
      openMenuFor.value = openMenuFor.value === name ? null : name;
    }

    function closeMenu(name) {
      if (openMenuFor.value === name) openMenuFor.value = null;
    }

    /**
     * Pinning is what earns the right to update silently: someone who cannot
     * tolerate a version moving under them has somewhere to say so. It lives
     * in the overflow menu because almost nobody needs it.
     */
    async function togglePin(plugin) {
      openMenuFor.value = null;
      const policy = isPinned(plugin) ? 'auto' : 'pinned';
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update-policy/${encodeURIComponent(plugin.name)}`, {
          method: 'POST',
          body: JSON.stringify({ policy }),
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'unknown error');
        await fetchInstalledPlugins();
      } catch (err) {
        emit('show-alert', 'Error', `Could not change the update setting: ${err.message}`);
      }
    }

    /**
     * The one interrupt.
     *
     * Reached only from a card whose update was refused for asking more than
     * the installed version had — everything else applied itself. Re-POSTs
     * without consent first so the diff on screen is the server's current
     * answer rather than a possibly-stale line from the status file.
     */
    async function reviewUpdate(plugin, acceptedPermissions = false) {
      updatingName.value = plugin.name;
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update/${encodeURIComponent(plugin.name)}`, {
          method: 'POST',
          body: JSON.stringify({ acceptedPermissions }),
        });
        const data = await resp.json();

        if (data.requiresConsent) {
          const added = (data.permissionDiff?.added || []).map(escapeHtml);
          const confirmed = await modalRef.value.showModal({
            title: `"${plugin.name}" update requests new permissions`,
            message:
              `This update adds capabilities the currently installed version does not have:<br><br>` +
              `<b>${added.join('</b><br><b>')}</b><br><br>` +
              `Nothing has been installed. Grant these permissions and update?`,
            confirmText: 'Grant & Update',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-danger',
          });
          if (confirmed) {
            updatingName.value = null;
            return reviewUpdate(plugin, true);
          }
          return;
        }

        if (data.success) {
          emit('show-alert', 'Success', `"${plugin.name}" updated to v${data.version}${data.trustTier ? ` · ${data.trustTier}` : ''}`);
          await Promise.all([fetchInstalledPlugins(), loadUpdateStatus()]);
        } else {
          emit('show-alert', 'Error', `Update failed: ${data.error}`);
        }
      } catch (err) {
        emit('show-alert', 'Error', `Update failed: ${err.message}`);
      } finally {
        updatingName.value = null;
      }
    }

    // trust system Layer 6: human-readable trust labels (no backend jargon
    // like "tofu" ever reaches the UI).
    function trustTierLabel(tier) {
      if (tier === 'official') return 'Official — built & maintained by AGNT';
      if (tier === 'community') return 'Community — verified & fully declared';
      if (tier === 'unverified') return 'Unverified — undeclared capabilities';
      return 'Unaudited — could not be scanned';
    }

    function integrityLabel(state) {
      if (state === 'verified') return 'Package verified against the marketplace record.';
      if (state === 'tofu') return 'Fingerprint recorded on first use — any future tampering will be detected.';
      if (state === 'mismatch') return 'Package does NOT match its marketplace record!';
      return 'No integrity record yet.';
    }    function trustTooltipText(plugin, isMarketplace = false) {
      const parts = [];
      if (plugin.trustTier === 'official') {
        parts.push('First-party AGNT plugin — built, scanned, and integrity-tracked by the AGNT team.');
      } else if (plugin.trustTier === 'community') {
        parts.push('This plugin is integrity-tracked and every capability it uses is declared by its author.');
      } else if (plugin.trustTier === 'unverified') {
        parts.push('This plugin uses capabilities its author has not declared yet.');
      } else {
        parts.push('This plugin could not be scanned.');
      }
      if (isMarketplace) {
        // Pre-install: the record carries a verified hash; the package will be
        // checked against it during installation.
        parts.push('Package will be verified against its marketplace record during installation.');
        const caps = (plugin.declaredPermissions && plugin.declaredPermissions.length && plugin.declaredPermissions) || plugin.detectedCapabilities || [];
        if (caps.length) parts.push('Requests: ' + caps.join(', ') + '.');
      } else {
        parts.push(integrityLabel(plugin.integrityState));
        if (plugin.grantedPermissions && plugin.grantedPermissions.length) {
          parts.push('Granted: ' + plugin.grantedPermissions.join(', ') + '.');
        } else if (plugin.detectedCapabilities && plugin.detectedCapabilities.length) {
          parts.push('Detected: ' + plugin.detectedCapabilities.join(', ') + '.');
        }
      }
      return parts.join(' ');
    }

    function formatSize(bytes) {
      if (!bytes) return '';
      if (bytes < 1024) {
        return `${bytes} B`;
      } else if (bytes < 1024 * 1024) {
        const kb = bytes / 1024;
        return `${kb.toFixed(1)} KB`;
      } else {
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
      }
    }

    // Sanitize plugin data by stripping large base64 strings that block the UI
    function sanitizePluginData(plugin) {
      const MAX_BASE64_LENGTH = 5000; // ~3.7KB decoded, enough for small icons
      const sanitized = { ...plugin };

      // Strip or truncate preview_image if it's a huge base64 string
      if (sanitized.preview_image && typeof sanitized.preview_image === 'string') {
        if (sanitized.preview_image.startsWith('data:') && sanitized.preview_image.length > MAX_BASE64_LENGTH) {
          sanitized.preview_image = null; // Remove it entirely
        }
      }

      // Also check icon field if it contains base64
      if (sanitized.icon && typeof sanitized.icon === 'string') {
        if (sanitized.icon.startsWith('data:') && sanitized.icon.length > MAX_BASE64_LENGTH) {
          sanitized.icon = 'custom'; // Fallback to default icon
        }
      }

      // Recursively sanitize tools array if present
      if (sanitized.tools && Array.isArray(sanitized.tools)) {
        sanitized.tools = sanitized.tools.map((tool) => {
          const sanitizedTool = { ...tool };
          if (sanitizedTool.preview_image && typeof sanitizedTool.preview_image === 'string') {
            if (sanitizedTool.preview_image.startsWith('data:') && sanitizedTool.preview_image.length > MAX_BASE64_LENGTH) {
              sanitizedTool.preview_image = null;
            }
          }
          return sanitizedTool;
        });
      }

      return sanitized;
    }

    async function fetchInstalledPlugins() {
      try {
        // apiFetch, not fetch: the route is account-scoped and a bare call 401s.
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/installed`);
        const data = await response.json();
        if (data.success) {
          // Sanitize plugin data to remove large base64 strings
          installedPlugins.value = (data.plugins || []).map(sanitizePluginData);
        } else {
          console.error('[Plugins] API returned success=false:', data.error);
        }
      } catch (error) {
        console.error('[Plugins] Error fetching installed plugins:', error);
      }
    }

    async function fetchMarketplacePlugins() {
      try {
        // Optimization: Use cached marketplace items if available
        let marketplaceItems = store.getters['marketplace/filteredMarketplaceItems'] || [];
        if (marketplaceItems.length === 0) {
          await store.dispatch('marketplace/fetchMarketplaceItems');
          marketplaceItems = store.getters['marketplace/filteredMarketplaceItems'] || [];
        }

        // Fetch from local backend (has full plugin manifest data with icons, tools, etc.)
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/marketplace`);
        const data = await response.json();
        if (data.success) {
          const localPlugins = data.plugins || [];

          if (marketplaceItems.length > 0) {
            // Create a map of plugin prices by name/asset_id
            const priceMap = {};
            marketplaceItems
              .filter((item) => item.asset_type === 'plugin')
              .forEach((item) => {
                const pluginName = item.asset_data?.manifest?.name || item.asset_id;
                if (pluginName) {
                  priceMap[pluginName] = {
                    price: item.price || 0,
                    marketplace_item_id: item.id,
                  };
                }
              });

            // Merge price data into local plugins and sanitize
            marketplacePlugins.value = localPlugins.map((plugin) =>
              sanitizePluginData({
                ...plugin,
                price: priceMap[plugin.name]?.price || 0,
                marketplace_item_id: priceMap[plugin.name]?.marketplace_item_id || null,
              }),
            );
          } else {
            // No marketplace items yet, use local plugins without price (sanitized)
            marketplacePlugins.value = localPlugins.map(sanitizePluginData);
          }
        }
      } catch (error) {
        console.error('Error fetching marketplace plugins:', error);
      }
    }

    async function refreshPlugins() {
      isLoading.value = true;
      try {
        await Promise.all([
          fetchInstalledPlugins(),
          fetchMarketplacePlugins(),
          store.dispatch('marketplace/fetchMyPurchases'),
          store.dispatch('marketplace/fetchMyInstalls'),
        ]);
      } finally {
        isLoading.value = false;
      }
    }

    // trust system Layer 1: human-readable capability labels for the
    // pre-install disclosure modal.
    const CAPABILITY_LABELS = {
      network: ['🌐', 'Network access', 'makes requests to the internet'],
      filesystem: ['📁', 'File system access', 'reads or writes files on your computer'],
      'spawn-process': ['⚙️', 'Runs system processes', 'executes commands on your machine'],
      'env-access': ['🔑', 'Environment variables', 'can read env vars, which may include API keys'],
      'dynamic-eval': ['⚡', 'Dynamic code execution', 'runs dynamically generated code'],
      'dynamic-import': ['📦', 'Dynamic module loading', 'loads additional code at runtime'],
    };

    /**
     * trust system Layer 1: pre-install disclosure & consent. Inspects the
     * package server-side (download + scan, NO install), then shows a
     * blocking modal with capabilities, integrity state, and trust tier.
     * Returns true only if the user explicitly confirms. An integrity
     * mismatch blocks installation outright.
     */
    async function showInstallDisclosure(plugin) {
      try {
        const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/inspect/${encodeURIComponent(plugin.name)}`);
        const report = await resp.json();
        if (!report.success) throw new Error(report.error || 'inspection failed');

        if (report.integrityState === 'mismatch') {
          await modalRef.value.showModal({
            title: '🚨 Integrity Check Failed — Install Blocked',
            message:
              `The downloaded package for "<b>${getDisplayName(plugin)}</b>" does <b>NOT</b> match the marketplace record.<br><br>` +
              `<b>Expected:</b> <code>${report.expectedIntegrity}</code><br>` +
              `<b>Got:</b> <code>${report.integrity}</code><br><br>` +
              `The artifact may be corrupted or tampered with. Installation has been blocked — nothing was installed.`,
            confirmText: 'Close',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
          return false;
        }

        const caps = Object.keys(report.detected || {});
        const capRows = caps.length
          ? caps
              .map((cap) => {
                const [icon, label, desc] = CAPABILITY_LABELS[cap] || ['❔', cap, ''];
                const undeclared = report.undeclared?.includes(cap) ? ' <span style="color:var(--text-yellow);">(undeclared by author)</span>' : '';
                const ex = report.detected[cap]?.example;
                const evidence = ex ? ` <span style="opacity:0.55;">(${ex.file}:${ex.line})</span>` : '';
                return `${icon} <b>${label}</b>${undeclared} — ${desc}${evidence}`;
              })
              .join('<br>')
          : '✅ No sensitive capabilities detected in first-party source';

        const integrityLine =
          report.integrityState === 'verified'
            ? '🔐 <b>Integrity verified</b> — package bytes match the marketplace record exactly'
            : "📌 <b>No integrity record yet</b> — AGNT will record this package's fingerprint now and alert you if it ever changes";        // Theme-colored dot matching the badge colors (modal message is v-html)
        const tierColor =
          report.trustTier === 'official'
            ? 'var(--color-green)'
            : report.trustTier === 'community'
              ? 'var(--color-green)'
              : report.trustTier === 'unverified'
                ? 'var(--color-yellow)'
                : 'var(--color-red)';
        const tierIcon = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${tierColor};margin-right:2px;"></span>`;

        const validLine = report.valid
          ? ''
          : `<br><span style="color:var(--color-red);">⚠️ Package validation problems: ${(report.validationErrors || []).join('; ')}</span>`;

        const confirmed = await modalRef.value.showModal({
          title: `Install "${getDisplayName(plugin)}" v${report.version || plugin.version || '?'}?`,
          message:
            `${tierIcon} Trust tier: <b>${report.trustTier}</b><br>` +
            `${integrityLine}<br><br>` +
            `<b>This plugin can:</b><br>${capRows}${validLine}<br><br>` +
            `<span style="opacity:0.7;">Plugins run with full access to your machine. Only install plugins you trust.</span>`,
          confirmText: 'Install',
          cancelText: 'Cancel',
          showCancel: true,
          confirmClass: 'btn-primary',
        });
        return !!confirmed;
      } catch (err) {
        // Inspection unavailable — NEVER silently install; fall back to an
        // explicit basic consent that says exactly what we don't know.
        console.warn('[Plugins] Pre-install inspection unavailable:', err.message);
        const confirmed = await modalRef.value.showModal({
          title: `Install "${getDisplayName(plugin)}"?`,
          message:
            `⚠️ Pre-install inspection unavailable (${err.message}).<br><br>` +
            `This package could not be scanned before install. Plugins run with full access to your machine.`,
          confirmText: 'Install Anyway',
          cancelText: 'Cancel',
          showCancel: true,
          confirmClass: 'btn-danger',
        });
        return !!confirmed;
      }
    }
    async function installPlugin(plugin) {
      installingPlugin.value = plugin.name;
      try {
        const marketplaceItemId = plugin.marketplace_item_id || plugin.id;

        // Check if this is a paid plugin from the marketplace
        if (plugin.price && plugin.price > 0) {
          // Verify we have a valid marketplace item ID for purchase
          if (!marketplaceItemId) {
            emit('show-alert', 'Error', `This plugin is marked as paid but is not available for purchase through the marketplace.`);
            installingPlugin.value = null;
            return;
          }

          // Check if user has already purchased
          const hasPurchased = await store.dispatch('marketplace/checkPurchaseStatus', marketplaceItemId);

          if (!hasPurchased) {
            // Show purchase confirmation modal
            const confirmed = await modalRef.value.showModal({
              title: 'Purchase Required',
              message: `"${getDisplayName(plugin)}" costs $${plugin.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
              confirmText: 'Purchase Now',
              cancelText: 'Cancel',
              showCancel: true,
              confirmClass: 'btn-primary',
            });

            if (confirmed) {
              emit('show-alert', 'Info', `Redirecting to checkout for "${getDisplayName(plugin)}"...`);
              // Redirect to Stripe checkout
              await store.dispatch('marketplace/purchaseItem', {
                itemId: marketplaceItemId,
              });
              // Note: User will be redirected to Stripe, so code after this won't execute
            }
            installingPlugin.value = null;
            return;
          }
        }

        // If free or already purchased, proceed with installation
        // trust system Layer 1: BLOCKING pre-install disclosure & consent.
        // The user sees exactly what this plugin can do before any bytes land.
        const consented = await showInstallDisclosure(plugin);
        if (!consented) {
          installingPlugin.value = null;
          return;
        }

        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/install`, {
          method: 'POST',
          body: JSON.stringify({ name: plugin.name, version: plugin.version || 'latest' }),
        });
        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${plugin.name}" installed successfully!${data.trustTier ? ` Trust tier: ${data.trustTier}.` : ''}`);
          await refreshPlugins();
          await store.dispatch('tools/refreshAllTools');
        } else {
          throw new Error(data.error || 'Installation failed');
        }
      } catch (error) {
        // Handle specific payment-related errors
        if (error.code === 'PAYMENT_REQUIRED') {
          const marketplaceItemId = plugin.marketplace_item_id || plugin.id;
          if (!marketplaceItemId) {
            emit('show-alert', 'Error', `This plugin requires payment but is not properly configured for purchase.`);
            return;
          }

          emit('show-alert', 'Error', `This plugin costs $${plugin.price}. Payment required.`);
          const confirmed = await modalRef.value.showModal({
            title: 'Payment Required',
            message: `This plugin costs $${plugin.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
            confirmText: 'Purchase Now',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (confirmed) {
            await store.dispatch('marketplace/purchaseItem', {
              itemId: marketplaceItemId,
            });
          }
        } else if (error.message.includes('invalid payment') || error.message.includes('Stripe')) {
          emit('show-alert', 'Error', `Payment setup error: ${error.message}`);
        } else {
          emit('show-alert', 'Error', `Failed to install plugin: ${error.message}`);
        }
      } finally {
        installingPlugin.value = null;
      }
    }

    // This is now mainly for the marketplace or manual calls, as SecretsPanel handles its own uninstall
    async function confirmUninstall(plugin) {
      const confirmed = await modalRef.value.showModal({
        title: 'Confirm Uninstall',
        message: `Are you sure you want to uninstall "${plugin.name}"?`,
        confirmText: 'Uninstall',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) return;

      uninstallingPlugin.value = plugin.name;
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/${plugin.name}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${plugin.name}" uninstalled successfully!`);
          await refreshPlugins();
          await store.dispatch('tools/refreshAllTools');
          // If uninstalled plugin was selected, deselect it
          if (selectedPlugin.value?.name === plugin.name) {
            store.dispatch('connectors/selectPlugin', null);
          }
        } else {
          throw new Error(data.error || 'Uninstallation failed');
        }
      } catch (error) {
        emit('show-alert', 'Error', `Failed to uninstall plugin: ${error.message}`);
      } finally {
        uninstallingPlugin.value = null;
      }
    }

    function selectPlugin(plugin) {
      playSound('typewriterKeyPress');
      const isInstalled = isPluginInstalled(plugin.name);
      store.dispatch('connectors/selectPlugin', { ...plugin, _isInstalled: isInstalled });
    }

    function deselectPlugin() {
      store.dispatch('connectors/selectPlugin', null);
    }

    function triggerFileUpload() {
      fileInput.value?.click();
    }

    async function handleFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        await uploadPluginFile(file);
      }
      event.target.value = '';
    }

    async function onDrop(event) {
      isDropping.value = false;
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      if (file.name.endsWith('.agnt') || file.name.endsWith('.tar.gz') || file.name.endsWith('.tgz')) {
        await uploadPluginFile(file);
      } else {
        emit('show-alert', 'Error', 'Please drop a .agnt plugin file');
      }
    }

    async function uploadPluginFile(file) {
      isLoading.value = true;
      try {
        const reader = new FileReader();
        const fileData = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const pluginName = file.name.replace(/\.(agnt|tar\.gz|tgz)$/, '');

        const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/install-file`, {
          method: 'POST',
          body: JSON.stringify({
            name: pluginName,
            fileData: fileData,
            fileName: file.name,
          }),
        });

        const data = await response.json();
        if (data.success) {
          emit('show-alert', 'Success', `Plugin "${pluginName}" installed successfully!`);
          await refreshPlugins();
          await store.dispatch('tools/refreshAllTools');
        } else {
          throw new Error(data.error || 'Installation failed');
        }
      } catch (error) {
        emit('show-alert', 'Error', `Failed to install plugin: ${error.message}`);
      } finally {
        isLoading.value = false;
      }
    }

    async function onPluginInstalled() {
      // refresh every store the plugin could have touched. Tool-only
      // plugins need tool/plugin refresh; ecosystem packs also drop new
      // agents/workflows/skills/widgets in DB and we want those visible
      // immediately on their respective pages.
      await refreshPlugins();
      await Promise.all([
        store.dispatch('tools/refreshAllTools').catch(() => {}),
        store.dispatch('agents/fetchAgents', { force: true }).catch(() => {}),
        store.dispatch('workflows/fetchWorkflows', { force: true }).catch(() => {}),
        store.dispatch('skills/fetchSkills').catch(() => {}),
        store.dispatch('widgetDefinitions/fetchDefinitions').catch(() => {}),
      ]);
      // Stay on the current tab — switching to 'installed' is jarring when
      // the user just built a pack and might want to keep iterating.
    }

    // Revenue calculation functions for paid plugins
    function getRevenueMainText() {
      const price = parseFloat(publishForm.value.price) || 0;
      if (price <= 0) return '';

      const planType = store.getters['userAuth/planType'] || 'free';

      // Calculate earnings for each buyer tier
      const tiers = {
        enterprise: { fee: 0, earnings: price * 1.0, label: 'Enterprise (0% fee)' },
        business: { fee: 5, earnings: price * 0.95, label: 'Business (5% fee)' },
        personal: { fee: 10, earnings: price * 0.9, label: 'Personal (10% fee)' },
        free: { fee: 20, earnings: price * 0.8, label: 'Free (20% fee)' },
      };

      const userTier = tiers[planType];
      const userEarnings = userTier.earnings.toFixed(2);

      return `As a ${userTier.label} seller, you'll earn $${userEarnings} per sale.`;
    }

    function getRevenueComparisonText() {
      const price = parseFloat(publishForm.value.price) || 0;
      if (price <= 0) return '';

      // Calculate earnings for each buyer tier
      const tiers = {
        enterprise: { fee: 0, earnings: price * 1.0, label: 'Enterprise (0% fee)' },
        business: { fee: 5, earnings: price * 0.95, label: 'Business (5% fee)' },
        personal: { fee: 10, earnings: price * 0.9, label: 'Personal (10% fee)' },
        free: { fee: 20, earnings: price * 0.8, label: 'Free (20% fee)' },
      };

      // Build comparison text
      const allTiers = Object.entries(tiers)
        .map(([key, tier]) => `${tier.label}: $${tier.earnings.toFixed(2)}`)
        .join(' • ');

      return `All tiers: ${allTiers}`;
    }

    function setupStripe() {
      // Navigate to billing/payments settings to set up Stripe Connect
      store.dispatch('navigation/navigateTo', { page: 'settings', tab: 'billing' });
    }

    // Publish functions
    function openPublish(plugin) {
      openMenuFor.value = null;
      selectPluginToPublish(plugin);
    }

    /** From the Forge, which only knows the plugin's name. */
    function openPublishByName(name) {
      const plugin = installedPlugins.value.find((candidate) => candidate.name === name);
      if (!plugin) {
        emit('show-alert', 'Install it first', `"${name}" is not installed yet, so there is no package to publish.`);
        return;
      }
      selectPluginToPublish(plugin);
    }

    function closePublish() {
      if (!isPublishing.value) publishSelectedPlugin.value = null;
    }

    function closePublishOnEscape(event) {
      if (event.key === 'Escape' && publishSelectedPlugin.value) closePublish();
    }

    /**
     * What is known about this package before it ships. Only `bad` blocks:
     * an untested tool is information, not a gate, because Test runs real
     * side effects and some tools cannot be exercised safely.
     */
    const publishChecks = computed(() => {
      const plugin = publishSelectedPlugin.value;
      if (!plugin) return [];
      const checks = [];
      if (isUpdateMode.value) {
        checks.push({
          state: versionCanPublish.value ? 'ok' : 'bad',
          label: versionCanPublish.value ? `v${plugin.version} is newer than the published version` : 'Bump the version before publishing',
        });
      } else {
        const complete = Boolean(publishForm.value.displayName.trim() && publishForm.value.description.trim());
        checks.push({ state: complete ? 'ok' : 'bad', label: complete ? 'Name and description filled in' : 'Add a name and description' });
        if (!publishForm.value.isFree) {
          const priced = parseFloat(publishForm.value.price) > 0;
          checks.push({ state: priced ? 'ok' : 'bad', label: priced ? 'Price set' : 'Set a price above $0' });
          if (priced) checks.push({ state: stripeConnected.value ? 'ok' : 'bad', label: stripeConnected.value ? 'Payments set up' : 'Set up Stripe payments' });
        }
      }
      const tools = plugin.tools || [];
      if (tools.length) {
        const results = tools.map((tool) => store.getters['pluginBuilder/testResultFor']?.(plugin.name, tool.type)).filter(Boolean);
        const passed = results.filter((result) => result.ok).length;
        checks.push({
          gate: false,
          state: results.length === tools.length && passed === tools.length ? 'ok' : results.some((result) => !result.ok) ? 'bad' : 'unknown',
          label: results.length ? `${passed} of ${tools.length} tools passed in Test` : 'Tools not tested this session',
        });
      }
      return checks;
    });

    // A failed Test run is shown, not enforced (see publishChecks).
    const canPublish = computed(() => publishChecks.value.every((check) => check.gate === false || check.state !== 'bad'));

    function selectPluginToPublish(plugin) {
      const listing = publishedListingFor(plugin);
      if (listing) {
        // Update mode: the listing already owns title/description/price. Editing
        // those is `PUT /marketplace/items/:id` and belongs to the marketplace
        // panel; this tab ships bytes.
        publishSelectedPlugin.value = plugin;
        publishForm.value.changelog = '';
        return;
      }
      playSound('typewriterKeyPress');
      publishSelectedPlugin.value = plugin;
      // Pre-fill form with plugin data
      publishForm.value.displayName = getDisplayName(plugin);
      publishForm.value.description = plugin.description || '';
      publishForm.value.category = 'utility';
      publishForm.value.tags = '';
      publishForm.value.isFree = true;
      publishForm.value.price = '';
      publishForm.value.changelog = '';
    }

    async function publishPlugin() {
      if (!publishSelectedPlugin.value) {
        emit('show-alert', 'Error', 'Please select a plugin to publish');
        return;
      }

      if (!isUpdateMode.value && (!publishForm.value.displayName || !publishForm.value.description)) {
        emit('show-alert', 'Error', 'Please fill in all required fields');
        return;
      }

      isPublishing.value = true;
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required. Please log in.');
        }

        // First, get the plugin package data
        const packageResponse = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed/${publishSelectedPlugin.value.name}/package`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const packageData = await packageResponse.json();
        if (!packageData.success) {
          throw new Error(packageData.error || 'Failed to get plugin package');
        }

        // UPDATE: an existing listing takes new bytes through the version
        // endpoint. /marketplace/publish is create-only and 409s here.
        if (isUpdateMode.value) {
          const listing = selectedPublishedListing.value;
          const updateResponse = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${listing.id}/version`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              packageData: packageData.data,
              changelog: publishForm.value.changelog || `Version ${publishSelectedPlugin.value.version}`,
            }),
          });
          const updateResult = await updateResponse.json();
          if (!updateResponse.ok) throw new Error(updateResult.error || 'Failed to publish update');

          triggerConfetti();
          emit(
            'show-alert',
            'Update Published',
            `${getDisplayName(publishSelectedPlugin.value)} is now at v${updateResult.version}. ` +
              `Existing users will see it as an available update.`
          );
          await fetchMyPublishedPlugins();
          publishSelectedPlugin.value = null;
          publishForm.value.changelog = '';
          return;
        }

        // CREATE: first publish of this plugin id.
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/publish`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // Required fields for marketplace API
            asset_type: 'plugin',
            asset_id: publishSelectedPlugin.value.name, // Plugin name serves as the asset ID
            asset_data: {
              manifest: publishSelectedPlugin.value,
              downloadUrl: null, // Will be set by server after storing the package
              packageData: packageData.data, // Base64 encoded .agnt file
              size: packageData.size,
              // Recording the repo is the handshake that makes the GitHub
              // Actions provenance publish path reachable for this listing.
              // Without it the provenance endpoint can never match a listing.
              repository: extractRepository(publishSelectedPlugin.value),
              homepage: publishSelectedPlugin.value.homepage || undefined,
            },
            // Listing metadata
            title: publishForm.value.displayName,
            description: publishForm.value.description,
            category: publishForm.value.category,
            tags: publishForm.value.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
            price: publishForm.value.isFree ? 0 : parseFloat(publishForm.value.price) || 0,
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Failed to publish plugin');
        }

        // Trigger confetti celebration!
        triggerConfetti();

        emit('show-alert', 'Success', `Plugin "${publishForm.value.displayName}" submitted for review!`);

        await fetchMyPublishedPlugins();

        // Reset form
        publishSelectedPlugin.value = null;
        publishForm.value = {
          displayName: '',
          description: '',
          category: 'utility',
          tags: '',
          isFree: true,
          price: '',
          changelog: '',
        };
      } catch (error) {
        emit('show-alert', 'Error', `Failed to publish: ${error.message}`);
      } finally {
        isPublishing.value = false;
      }
    }

    // Confetti animation
    const triggerConfetti = () => {
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 2000 };

      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }

      const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Create confetti from two origins
        if (window.confetti) {
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          });
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          });
        }
      }, 250);
    };

    // Handler for realtime plugin install events
    const handlePluginInstalled = async () => {
      console.log('[Plugins] Received plugin-installed event, refreshing...');
      try {
        await fetchInstalledPlugins();
        // A background auto-update broadcasts this too, so the chip that
        // reports it has to be re-read here, not only at mount.
        await loadUpdateStatus();
        await store.dispatch('tools/refreshAllTools');
        console.log(
          '[Plugins] Refresh complete, installed plugins:',
          installedPlugins.value.map((p) => p.name),
        );
      } catch (error) {
        console.error('[Plugins] Error refreshing after plugin install:', error);
      }
    };

    const handlePluginUninstalled = async () => {
      console.log('[Plugins] Received plugin-uninstalled event, refreshing...');
      try {
        await fetchInstalledPlugins();
        await store.dispatch('tools/refreshAllTools');
        console.log('[Plugins] Refresh complete after uninstall');
      } catch (error) {
        console.error('[Plugins] Error refreshing after plugin uninstall:', error);
      }
    };

    onMounted(() => {
      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }

      // 'publish' was a tab; it is a sheet now, so a saved value lands on the library.
      if (activeTab.value === 'publish') activeTab.value = 'installed';

      refreshPlugins();
      // Needed before the publish sheet can tell create from update.
      fetchMyPublishedPlugins();
      // Drives the review badge — the only thing on this screen still
      // allowed to ask for attention.
      loadUpdateStatus();

      // Listen for realtime plugin events
      window.addEventListener('plugin-installed', handlePluginInstalled);
      window.addEventListener('plugin-uninstalled', handlePluginUninstalled);
      window.addEventListener('keydown', closePublishOnEscape);
    });

    onUnmounted(() => {
      // Clean up event listeners
      window.removeEventListener('plugin-installed', handlePluginInstalled);
      window.removeEventListener('plugin-uninstalled', handlePluginUninstalled);
      window.removeEventListener('keydown', closePublishOnEscape);
    });

    return { mobileView,
      emit,
      modalRef,
      searchQuery,
      activeTab,
      isLoading,
      installedPlugins,
      marketplacePlugins,
      filteredInstalledPlugins,
      filteredMarketplacePlugins,
      sortedInstalledPlugins,
      selectedPlugin,
      installingPlugin,
      uninstallingPlugin,
      fileInput,
      isDropping,
      publishSelectedPlugin,
      isPublishing,
      publishForm,
      publishedListingFor,
      selectedPublishedListing,
      isUpdateMode,
      versionCanPublish,
      versionBlockReason,
      isPluginInstalled,
      getDisplayName,
      trustTierLabel,
      trustTooltipText,
      updatingName,
      updateStatus,
      pluginNotices,
      reviewCount,
      reviewUpdate,
      isPinned,
      togglePin,
      openMenuFor,
      toggleMenu,
      closeMenu,
      formatSize,
      refreshPlugins,
      installPlugin,
      confirmUninstall,
      selectPlugin,
      deselectPlugin,
      triggerFileUpload,
      handleFileSelect,
      onDrop,
      onPluginInstalled,
      openPublish,
      openPublishByName,
      closePublish,
      publishChecks,
      canPublish,
      categoryOptions: CATEGORY_OPTIONS,
      publishPlugin,
      stripeConnected,
      getRevenueMainText,
      getRevenueComparisonText,
      setupStripe,
      isForgeMode,
      openLibrary,
      installedNames,
      forgeDraft,
      myBuildPlugins,
      myBuildCount,
      categoryFilter,
      discoverCategories,
      discoverPlugins,
      firstReviewPlugin,
      mobileTitle,
      mobileItems,
      toolCount,
      newPlugin,
      continueDraft,
      openInForge,
    };
  },
};
</script>

<style scoped>
.plugins-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  width: 100%;
}

/* The Forge owns the whole screen height so its composer is never below the fold. */
.plugins-container.is-forge {
  flex: 1;
  min-height: 0;
}

/* ── shared bits ── */
.bar-spacer {
  flex: 1;
}

.crumb-back,
.text-link,
.icon-button {
  font: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.crumb-back {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  color: var(--text-secondary);
}

.crumb-back:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.crumb-sep {
  color: var(--text-quaternary);
}

.crumb-current {
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.text-link {
  padding: 0;
  color: var(--text-info);
  font-size: var(--font-size-sm);
}

.text-link:hover {
  text-decoration: underline;
}

.muted {
  color: var(--text-tertiary);
}

.file-input {
  display: none;
}

/* ── pack shell ── */
.pack-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
}

.pack-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  min-height: 60px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.pack-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-md);
}

/* ── library header + tabs ── */
.library-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.library-title {
  margin: 0;
  font-size: var(--font-size-xxl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.library-search {
  width: 260px;
}

.tabs {
  display: flex;
  gap: var(--spacing-xs);
  border-bottom: 1px solid var(--terminal-border-color);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  font: inherit;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--text-secondary);
  cursor: pointer;
}

.tab:hover {
  color: var(--text-primary);
}

.tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--color-primary);
}

.tab-count {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.review-count {
  min-width: 18px;
  padding: 0 var(--spacing-xs);
  border-radius: var(--border-radius-md);
  background: var(--fill-warning);
  color: var(--on-fill-warning);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  text-align: center;
}

/* ── library body ── */
.library-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  border-radius: var(--border-radius-lg);
  outline: 2px dashed transparent;
  outline-offset: 4px;
  transition: outline-color var(--transition-fast);
}

.library-body.is-dropping {
  outline-color: var(--color-primary);
}

.review-banner {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-md);
  border: 1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent);
  background: rgba(var(--yellow-rgb), 0.08);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.review-banner > i,
.review-banner b {
  color: var(--status-amber-text);
}

.review-action,
.review-action:hover {
  border-color: var(--color-yellow);
  color: var(--status-amber-text);
}

.category-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.category {
  font: inherit;
  font-size: var(--font-size-sm);
  text-transform: capitalize;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.category:hover {
  color: var(--text-primary);
}

.category.active {
  border-color: var(--color-primary);
  color: var(--text-primary);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xxl) var(--spacing-md);
  color: var(--text-tertiary);
  text-align: center;
}

.empty-state i {
  font-size: var(--font-size-xxl);
  opacity: 0.6;
}

.empty-state p {
  margin: 0;
}

/* ── cards ── */
.plugins-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing-md);
}

.grid-note {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.plugin-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  background: var(--color-darker-0);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.plugin-card:hover {
  border-color: var(--border-strong);
}

.plugin-card.selected {
  border-color: var(--color-primary);
  box-shadow: var(--glow-ring);
}

.plugin-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.plugin-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--border-radius-md);
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--color-primary);
}

.plugin-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.plugin-name {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-version {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex-shrink: 0;
}

.plugin-description {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plugin-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  min-height: 32px;
}

.meta-tag {
  white-space: nowrap;
  font-size: var(--font-size-xs);
  padding: var(--spacing-xxs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  background: var(--color-darker-0);
  color: var(--text-secondary);
}

/* BaseButton is width:100% by design (forms); in a row it must size to its label. */
.btn-compact {
  width: auto;
  flex: 0 0 auto;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-sm);
}

.btn-compact.primary,
.btn-compact.primary:hover,
.btn-compact.primary:focus {
  background: var(--fill-accent);
  border-color: var(--fill-accent);
  color: var(--on-fill-accent);
}

/* A dimmed fill still reads as live; an unavailable primary drops fill AND ink together. */
.btn-compact.primary.is-disabled {
  background: transparent;
  border-color: var(--terminal-border-color);
  color: var(--text-tertiary);
}

.footer-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}

.new-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  min-height: 150px;
  padding: var(--spacing-md);
  border: 1px dashed var(--border-strong);
  border-radius: var(--border-radius-md);
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.new-card i {
  font-size: var(--font-size-xxl);
  color: var(--color-primary);
}

.new-card b {
  color: var(--text-primary);
  font-size: var(--font-size-md);
}

.new-card:hover {
  border-color: var(--color-primary);
  color: var(--text-secondary);
}

.draft-card {
  border-style: dashed;
  border-color: var(--color-secondary);
}

/* ── status chips ── */
.status-badge,
.notice-chip,
.trust-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-xs);
  padding: var(--spacing-xxs) var(--spacing-sm);
  border-radius: var(--border-radius-lg);
  border: 1px solid transparent;
  white-space: nowrap;
}

.status-badge.installed {
  color: var(--status-green-text);
  background: rgba(var(--green-rgb), 0.12);
}

.status-badge.published {
  color: var(--status-blue-text);
  background: rgba(var(--blue-rgb), 0.12);
}

.status-badge.private {
  color: var(--text-tertiary);
  background: var(--color-darker-0);
}

.status-badge.draft {
  color: var(--status-blue-text);
  border-color: color-mix(in srgb, var(--color-secondary) 45%, transparent);
}

.notice-chip {
  color: var(--text-tertiary);
  background: var(--color-darker-0);
  font: inherit;
  font-size: var(--font-size-xs);
}

.notice-chip.review {
  color: var(--status-amber-text);
  background: rgba(var(--yellow-rgb), 0.14);
  border-color: color-mix(in srgb, var(--color-yellow) 45%, transparent);
  cursor: pointer;
}

.notice-chip.review:hover:not(:disabled) {
  background: rgba(var(--yellow-rgb), 0.26);
}

.notice-chip.review:disabled {
  cursor: default;
  opacity: 0.7;
}

.notice-chip.updated {
  color: var(--status-green-text);
  background: rgba(var(--green-rgb), 0.12);
  cursor: help;
}

.notice-chip.failed {
  color: var(--color-red);
  background: rgba(var(--red-rgb), 0.12);
  cursor: help;
}

.notice-chip.pinned {
  cursor: help;
}

/* trust system Layer 6: trust tier badge (display-only — never affects loading) */
.trust-badge {
  text-transform: capitalize;
  cursor: help;
}

.trust-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.trust-badge.trust-official,
.trust-badge.trust-community {
  color: var(--status-green-text);
  background: rgba(var(--green-rgb), 0.12);
}

.trust-badge.trust-unverified {
  color: var(--status-amber-text);
  background: rgba(var(--yellow-rgb), 0.12);
}

.trust-badge.trust-unaudited {
  color: var(--color-red);
  background: rgba(var(--red-rgb), 0.12);
}

/* ── overflow menu ── */
.card-menu {
  position: relative;
  display: inline-flex;
}

.card-menu-btn {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  line-height: 1;
}

.card-menu-btn:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.card-menu-items {
  position: absolute;
  top: calc(100% + var(--spacing-xs));
  right: 0;
  z-index: var(--z-index-dropdown);
  min-width: 210px;
  padding: var(--spacing-xs);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  background: var(--color-popup);
  box-shadow: var(--shadow-lg);
}

.card-menu-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  padding: var(--spacing-sm);
  border: none;
  border-radius: var(--border-radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.card-menu-item:hover {
  background: var(--surface-hover);
}

.m-plugin-version {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

/* ── publish sheet ── */
.publish-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal-backdrop);
  display: flex;
  justify-content: flex-end;
  background: var(--scrim);
}

.publish-sheet {
  width: min(460px, 100%);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-popup);
  border-left: 1px solid var(--terminal-border-color);
  box-shadow: var(--shadow-overlay);
  color: var(--text-primary);
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--terminal-border-color);
}

.sheet-head h3 {
  margin: 0;
  font-size: var(--font-size-lg);
}

.icon-button {
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  color: var(--text-tertiary);
}

.icon-button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.sheet-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.form-textarea {
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-normal);
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  color: var(--text-primary);
  resize: vertical;
  outline: none;
}

.form-textarea:focus {
  border-color: var(--color-primary);
}

.price-toggle {
  display: flex;
  gap: var(--spacing-xs);
}

.price-option {
  flex: 1;
  font: inherit;
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.price-option.active {
  border-color: var(--color-primary);
  color: var(--text-primary);
  background: rgba(var(--primary-rgb), 0.1);
}

.version-summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-md);
  color: var(--status-green-text);
  background: rgba(var(--green-rgb), 0.1);
  font-size: var(--font-size-sm);
}

.version-summary.blocked {
  color: var(--status-amber-text);
  background: rgba(var(--yellow-rgb), 0.1);
}

.checklist {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  font-size: var(--font-size-sm);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--text-tertiary);
}

.check.ok {
  color: var(--status-green-text);
}

.check.bad {
  color: var(--color-red);
}

.sheet-note {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.sheet-note.warn > i {
  color: var(--status-amber-text);
}

.sheet-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--terminal-border-color);
}
</style>
