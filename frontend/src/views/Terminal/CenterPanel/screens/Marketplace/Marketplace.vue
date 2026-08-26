<!-- Marketplace.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="MarketplaceScreen"
    :terminalLines="terminalLines"
    :leftPanelProps="{
      marketplaceWorkflows: filteredWorkflows,
      featuredWorkflows,
      filters,
      selectedWorkflow,
      activeTab,
    }"
    :panelProps="{ selectedWorkflow, activeTab }"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="marketplace-panel">
        <SimpleModal ref="simpleModal" />
        <!-- Sticky Header Container -->
        <div class="sticky-header">
          <BaseTabControls
            :tabs="tabs"
            :active-tab="activeTab"
            :current-layout="currentLayout"
            :show-grid-toggle="true"
            @select-tab="selectTab"
            @set-layout="setLayout"
          />

          <!-- Search and Controls Bar (hide for My Earnings tab) -->
          <div v-if="activeTab !== 'my-earnings'" class="controls-bar">
            <div class="search-wrapper">
              <input
                type="text"
                class="search-input"
                placeholder="Search marketplace..."
                :value="filters.search"
                @input="handleSearch($event.target.value)"
              />
            </div>
          </div>
        </div>

        <!-- Main Content -->
        <div class="marketplace-content">
          <!-- ── Toolbar ── Screen chrome, so it lives OUTSIDE the scroller.
               A pinned bar INSIDE the scroll flow can only hide the cards
               passing behind it by painting an opaque background, which is
               unsatisfiable with a transparent theme. Out here the scroller's
               own overflow clips them and this bar needs no background at all.
               .mk-toolbar-slot reproduces the scrollbar gutter so the bar stays
               centred on exactly the same axis as the grid. -->
          <div v-if="showToolbar" class="mk-toolbar-slot">
            <div class="mk-toolbar">
              <div class="mk-tb-row mk-tb-controls">
                <div class="mk-count">
                  Showing <b>{{ gridItems.length }}</b> of <b>{{ filteredWorkflows.length }}</b> {{ currentAssetTypeLabel }}
                  <span v-if="showSpotlight" class="mk-count-note">· {{ spotlightItems.length }} in spotlight above</span>
                </div>
                <div class="mk-spacer"></div>
                <div class="mk-seg">
                  <button
                    v-for="opt in priceSegments"
                    :key="opt.value"
                    :class="{ on: (filters.priceRange || 'all') === opt.value }"
                    @click="setPriceRange(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
                <CustomSelect class="mk-sort" :model-value="filters.sortBy || 'popular'" :options="sortOptions" @update:model-value="setSortBy($event)" />
              </div>
              <div class="mk-tb-row mk-tb-filters">
                <span class="mk-tb-label">Filter</span>
                <div class="mk-chip-rail">
                  <div ref="chipRailEl" class="mk-chips" @scroll="syncRail">
                    <button class="mk-chip" :class="{ on: selectedCategory === 'all' }" @click="selectedCategory = 'all'">
                      All <span class="mk-chip-n">{{ categoryCounts.all || 0 }}</span>
                    </button>
                    <button
                      v-for="category in availableCategories"
                      :key="category"
                      class="mk-chip"
                      :class="{ on: selectedCategory === category }"
                      @click="selectedCategory = category"
                    >
                      {{ category }} <span class="mk-chip-n">{{ categoryCounts[category] || 0 }}</span>
                    </button>
                  </div>
                </div>
                <button class="mk-rail-next" :class="{ hide: !railHasMore }" v-tooltip="'More categories'" @click="scrollRail">
                  <i class="fas fa-chevron-right"></i>
                </button>
              </div>
            </div>
          </div>

          <main ref="mainContentEl" class="marketplace-main-content">
            <!-- Earnings Dashboard (My Earnings Tab) -->
            <div v-if="activeTab === 'my-earnings'" class="earnings-dashboard">
              <div class="earnings-header">
                <h2 class="earnings-title">
                  <i class="fas fa-chart-line"></i>
                  My Earnings Dashboard
                </h2>
              </div>

              <!-- Earnings Summary Cards -->
              <div class="earnings-summary">
                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-dollar-sign"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">Total Revenue</div>
                    <div class="earnings-card-value">${{ myEarnings.totalEarnings?.toFixed(2) || '0.00' }}</div>
                    <div class="earnings-card-subtitle">Gross sales revenue</div>
                  </div>
                </div>

                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-hand-holding-usd"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">Your Earnings</div>
                    <div class="earnings-card-value">${{ myEarnings.totalNetEarnings?.toFixed(2) || '0.00' }}</div>
                    <div class="earnings-card-subtitle">After platform fees (0-15%)</div>
                  </div>
                </div>

                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-shopping-cart"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">Total Sales</div>
                    <div class="earnings-card-value">{{ myEarnings.totalSales || 0 }}</div>
                    <div class="earnings-card-subtitle">Completed purchases</div>
                  </div>
                </div>

                <div class="earnings-card">
                  <div class="earnings-card-icon">
                    <i class="fas fa-calendar-alt"></i>
                  </div>
                  <div class="earnings-card-content">
                    <div class="earnings-card-label">This Month</div>
                    <div class="earnings-card-value">${{ myEarnings.thisMonthNetEarnings?.toFixed(2) || '0.00' }}</div>
                    <div class="earnings-card-subtitle">Net earnings</div>
                  </div>
                </div>
              </div>

              <!-- Earnings Breakdown -->
              <div class="earnings-breakdown">
                <h3 class="section-title">
                  <i class="fas fa-chart-pie"></i>
                  Revenue Breakdown
                </h3>
                <div class="breakdown-grid">
                  <div class="breakdown-item">
                    <div class="breakdown-label">Gross Revenue</div>
                    <div class="breakdown-value">${{ myEarnings.totalEarnings?.toFixed(2) || '0.00' }}</div>
                  </div>
                  <div class="breakdown-item fee">
                    <div class="breakdown-label">Platform Fee (15%)</div>
                    <div class="breakdown-value">-${{ myEarnings.totalPlatformFees?.toFixed(2) || '0.00' }}</div>
                  </div>
                  <div class="breakdown-item net">
                    <div class="breakdown-label">Your Net Earnings (85%)</div>
                    <div class="breakdown-value">${{ myEarnings.totalNetEarnings?.toFixed(2) || '0.00' }}</div>
                  </div>
                </div>
              </div>

              <!-- Sales Breakdown Table -->
              <div class="earnings-section">
                <h3 class="section-title">
                  <i class="fas fa-list"></i>
                  Sales Breakdown
                </h3>
                <BaseTable
                  v-if="myEarnings.itemBreakdown && myEarnings.itemBreakdown.length > 0"
                  :items="myEarnings.itemBreakdown"
                  :columns="earningsColumns"
                  :show-search="false"
                  :show-sort-dropdown="false"
                  :enable-column-sorting="true"
                  no-results-text="No sales yet"
                  :title-key="'title'"
                >
                  <template #title="{ item }">
                    {{ item.title }}
                  </template>
                  <template #sales="{ item }">
                    {{ item.sales }}
                  </template>
                  <template #revenue="{ item }"> ${{ item.revenue?.toFixed(2) }} </template>
                  <template #earnings="{ item }"> ${{ item.earnings?.toFixed(2) }} </template>
                </BaseTable>
                <div v-else class="no-earnings">
                  <i class="fas fa-chart-line"></i>
                  <p>No sales yet. Publish paid items to start earning!</p>
                </div>
              </div>
            </div>

            <!-- Table View -->
            <BaseTable
              v-else-if="currentLayout === 'table'"
              :items="filteredWorkflows"
              :columns="tableColumns"
              :selected-id="selectedWorkflow?.id"
              :show-search="false"
              :show-sort-dropdown="false"
              :enable-column-sorting="true"
              search-placeholder="Search marketplace..."
              :search-keys="['title', 'publisher_pseudonym', 'category', 'description']"
              :no-results-text="`No ${currentAssetTypeLabel} found in marketplace.`"
              :title-key="'title'"
              @row-click="handleWorkflowClick"
              @search="handleSearch"
            >
              <template #title="{ item }">
                {{ item.title }}
              </template>
              <template #publisher="{ item }">
                <button v-if="item.publisher_id" class="mk-card-author is-link" @click.stop="openProfile(item)">
                  {{ item.publisher_pseudonym || 'Anonymous' }}
                </button>
                <span v-else>{{ item.publisher_pseudonym || 'Anonymous' }}</span>
              </template>
              <template #price="{ item }">
                <span v-if="item.price > 0" class="price-badge paid">${{ item.price.toFixed(2) }}</span>
                <span v-else class="price-badge free">FREE</span>
              </template>
              <template #rating="{ item }">
                <div class="rating-display">
                  <template v-if="item.rating_count > 0">
                    <i class="fas fa-star"></i>
                    {{ item.rating.toFixed(1) }}
                    <span class="rating-count">({{ item.rating_count }})</span>
                  </template>
                  <span v-else class="mk-m-unrated">Unrated</span>
                </div>
              </template>
              <template #downloads="{ item }">
                <div class="downloads-display">
                  <i class="fas fa-download"></i>
                  {{ item.downloads || 0 }}
                </div>
              </template>
              <template #actions="{ item }">
                <button class="table-install-button" @click.stop="handleInstallWorkflow(item)" :disabled="isInstalled(item) || isPurchased(item)">
                  <i class="fas fa-download"></i>
                  {{ isInstalled(item) ? 'Installed' : isPurchased(item) ? 'Purchased' : item.price > 0 ? 'Purchase' : 'Install' }}
                </button>
              </template>
            </BaseTable>

            <!-- ═══════════════════ GRID VIEW ═══════════════════ -->
            <div v-else class="items-grid-container">
              <!-- ═══════════ Publisher profile ═══════════
                   Shown in place of the editorial layer + toolbar. Everything
                   here is derived from the item list the screen already has. -->
              <section v-if="profileUserId && profileInfo" class="mk-profile">
                <button class="mk-back" @click="closeProfile">
                  <i class="fas fa-arrow-left"></i> Back to marketplace
                </button>

                <div class="mk-prof-head">
                  <div class="mk-prof-avatar" :style="avatarStyle(profileInfo.id)">{{ initials(profileInfo.name) }}</div>
                  <div class="mk-prof-id">
                    <h2 class="mk-prof-name">{{ profileInfo.name }}</h2>
                    <div class="mk-prof-sub">
                      <span><i class="fas fa-calendar-alt"></i> Publishing since {{ formatJoined(profileInfo.since) }}</span>
                      <span v-if="profileInfo.categories.length">
                        <i class="fas fa-tag"></i> {{ profileInfo.categories.slice(0, 3).join(' · ') }}
                      </span>
                    </div>
                  </div>
                  <span v-if="profileInfo.isSelf" class="mk-prof-you"><i class="fas fa-user-circle"></i> This is you</span>
                </div>

                <div class="mk-prof-stats">
                  <div class="mk-prof-stat">
                    <div class="v">{{ profileInfo.count }}</div>
                    <div class="k">Published</div>
                  </div>
                  <div class="mk-prof-stat">
                    <div class="v">{{ formatNumber(profileInfo.installs) }}</div>
                    <!-- scope is stated when there's more than one listing, so a
                         client-derived total can never be mistaken for a server total -->
                    <div class="k">Installs<span v-if="profileInfo.count > 1"> · across {{ profileInfo.count }} listings</span></div>
                  </div>
                  <div class="mk-prof-stat">
                    <div class="v">
                      <i v-if="profileInfo.ratingCount" class="fas fa-star"></i>
                      {{ profileInfo.ratingCount ? profileInfo.rating.toFixed(1) : '—' }}
                    </div>
                    <div class="k">{{ profileInfo.ratingCount ? profileInfo.ratingCount + ' ratings' : 'No ratings yet' }}</div>
                  </div>
                  <div class="mk-prof-stat">
                    <div class="v">{{ profileInfo.categories.length }}</div>
                    <div class="k">Categor{{ profileInfo.categories.length === 1 ? 'y' : 'ies' }}</div>
                  </div>
                </div>

                <div v-if="!profileInfo.isSelf && profileInfo.installedByMe > 0" class="mk-prof-rel">
                  <i class="fas fa-check-circle"></i>
                  <span>
                    You have <b>{{ profileInfo.installedByMe }}</b> of {{ profileInfo.name }}'s
                    <b>{{ profileInfo.count }}</b> item{{ profileInfo.count === 1 ? '' : 's' }} installed.
                  </span>
                </div>
              </section>

              <!-- ── Live pulse strip (derived from real item data) ── -->
              <div v-if="showEditorial" class="mk-pulse">
                <span class="mk-pulse-live"><span class="mk-beacon"></span>Live</span>
                <span><b>{{ formatNumber(pulseStats.installs) }}</b> total installs</span>
                <span class="mk-dot">·</span>
                <span><b>{{ pulseStats.builders }}</b> publishers</span>
                <span class="mk-dot">·</span>
                <span><b>{{ pulseStats.free }}</b> free</span>
                <span class="mk-dot">·</span>
                <span><b>{{ pulseStats.paid }}</b> paid</span>
                <button v-if="pulseStats.fresh > 0" class="mk-pulse-cta" @click="showNewest">
                  {{ pulseStats.fresh }} new this month <i class="fas fa-chevron-right"></i>
                </button>
              </div>

              <!-- ── Spotlight ── -->
              <section v-if="showSpotlight" class="mk-section">
                <div class="mk-sec-head">
                  <div class="mk-sec-title">Spotlight</div>
                  <div class="mk-sec-sub">Featured picks, hand-selected and top-installed</div>
                </div>
                <div class="mk-spotlight">
                  <article
                    v-for="(item, idx) in spotlightItems"
                    :key="'spot-' + item.id"
                    class="mk-hero"
                    :class="{ 'mk-hero-sm': idx > 0, selected: selectedWorkflow?.id === item.id }"
                    @click="handleWorkflowClick(item)"
                  >
                    <div class="mk-art" :style="artStyle(item)">
                      <img
                        v-if="item.preview_image"
                        class="mk-art-img"
                        :src="item.preview_image"
                        :alt="item.title"
                        @error="item.preview_image = null"
                      />
                    </div>
                    <div class="mk-hero-glyph"><i :class="getAssetIcon(item)"></i></div>
                    <div class="mk-hero-scrim"></div>
                    <div class="mk-hero-top">
                      <span class="mk-eyebrow" :class="{ alt: idx > 0 }">
                        <i :class="idx === 0 ? 'fas fa-star' : 'fas fa-fire'"></i>
                        {{ idx === 0 ? 'Top pick' : 'Trending' }}
                      </span>
                      <span v-if="pluginTrust(item)" class="mk-hero-badge">
                        <i class="fas fa-shield-alt"></i> {{ pluginTrust(item).trustTier }}
                      </span>
                    </div>
                    <div class="mk-hero-body">
                      <h2 class="mk-hero-title">{{ item.title }}</h2>
                      <div class="mk-hero-by">
                        <i class="fas fa-user"></i>
                        <!-- .stop: the whole hero is clickable and opens the detail panel -->
                        <button
                          v-if="item.publisher_id"
                          class="mk-hero-author"
                          v-tooltip="`View ${item.publisher_pseudonym || 'publisher'}'s profile`"
                          @click.stop="openProfile(item)"
                        >
                          {{ item.publisher_pseudonym || 'Anonymous' }}
                        </button>
                        <span v-else>{{ item.publisher_pseudonym || 'Anonymous' }}</span>
                        <span class="mk-dot">·</span> {{ getAssetTypeLabel(item) }}
                      </div>
                      <p class="mk-hero-desc">{{ item.tagline || item.description || 'No description available' }}</p>
                      <div class="mk-hero-chips">
                        <span v-if="item.category">{{ item.category }}</span>
                        <span v-if="item.rating_count > 0">{{ item.rating_count }} ratings</span>
                        <span>{{ item.price > 0 ? '$' + item.price.toFixed(2) : 'Free' }}</span>
                      </div>
                      <div class="mk-hero-foot">
                        <button
                          class="mk-hero-cta"
                          :class="{ done: isInstalled(item) || isPurchased(item) }"
                          data-sound="chaChingMoney"
                          :disabled="isInstalled(item) || isPurchased(item) || installingIds.has(item.id)"
                          @click.stop="installWithBusy(item)"
                        >
                          <i :class="installIcon(item)"></i>
                          <span>{{ installLabel(item) }}</span>
                        </button>
                        <div class="mk-hero-stats">
                          <span v-if="item.rating_count > 0"><i class="fas fa-star"></i><b>{{ item.rating.toFixed(1) }}</b></span>
                          <span><i class="fas fa-download"></i><b>{{ formatNumber(item.downloads || 0) }}</b></span>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              </section>

              <!-- ── Collections (derived from live categories — no hardcoded ids) ── -->
              <section v-if="showCollections" class="mk-section">
                <div class="mk-sec-head">
                  <div class="mk-sec-title">Collections</div>
                  <div class="mk-sec-sub">The most-installed set in each category — grab the whole stack</div>
                </div>
                <div class="mk-collections">
                  <article v-for="c in collections" :key="'col-' + c.name" class="mk-collection" @click="filterToCategory(c.name)">
                    <div class="mk-stack">
                      <div v-for="it in c.items" :key="'st-' + it.id" class="mk-stack-chip" :style="iconStyle(it)">
                        <i :class="getAssetIcon(it)"></i>
                      </div>
                    </div>
                    <div class="mk-collection-main">
                      <div class="mk-collection-name">{{ c.name }}</div>
                      <div class="mk-collection-desc">{{ c.blurb }}</div>
                    </div>                    <div class="mk-collection-foot">
                      <span>{{ c.total }} items</span>
                      <button class="mk-collection-cta" data-sound="chaChingMoney" @click.stop="installCollection(c)">
                        <i :class="c.freeCount > 0 ? 'fas fa-download' : 'fas fa-arrow-right'"></i>
                        {{ c.freeCount > 0 ? 'Install ' + c.freeCount + ' free' : 'Browse set' }}
                      </button>
                    </div>
                  </article>
                </div>
              </section>

              <!-- ── One flat grid: category never affects layout ── -->
              <div class="mk-grid" :class="{ 'mk-grid-fit': profileUserId, solo: profileUserId && visibleItems.length === 1 }">
                <template v-if="isLoading && !filteredWorkflows.length">
                  <div v-for="n in 8" :key="'sk-' + n" class="mk-sk"></div>
                </template>

                <div v-else-if="!visibleItems.length" class="mk-empty">
                  <div class="mk-empty-ico"><i :class="profileUserId ? 'fas fa-box-open' : 'fas fa-search'"></i></div>
                  <h3>{{ profileUserId ? 'Nothing published yet' : 'Nothing matches that yet' }}</h3>
                  <p>
                    {{
                      profileUserId
                        ? 'This publisher has not shipped anything to the marketplace.'
                        : 'Try a different category, clear the search, or browse everything.'
                    }}
                  </p>
                  <button v-if="!profileUserId" class="mk-empty-cta" @click="resetFilters">
                    <i class="fas fa-undo"></i> Reset filters
                  </button>
                </div>                <template v-else>
                <article
                  v-for="(item, idx) in visibleItems"
                  :key="item.id"
                  class="mk-card"
                  :class="{ selected: selectedWorkflow?.id === item.id, installed: isInstalled(item) || isPurchased(item) }"
                  :style="{ '--i': Math.min(idx, 14) }"
                  @click="handleWorkflowClick(item)"
                >
                  <span v-if="isInstalled(item) || isPurchased(item)" class="mk-ribbon"><i class="fas fa-check"></i> Installed</span>

                  <div class="mk-card-art" :style="artStyle(item)">
                    <img
                      v-if="item.preview_image"
                      class="mk-art-img"
                      :src="item.preview_image"
                      :alt="item.title"
                      @error="item.preview_image = null"
                    />
                    <div v-else class="mk-card-glyph"><i :class="getAssetIcon(item)"></i></div>
                    <!-- An installed card keeps its TYPE badge: rank/trending/new and
                         price stop being useful once you own it, but the type still is,
                         and dropping the whole strip made that one card read as broken. -->
                    <div class="mk-art-tags">
                      <template v-if="!(isInstalled(item) || isPurchased(item))">
                        <span v-if="rankBadge(item)" class="mk-tag rank">#{{ rankBadge(item) }} in {{ item.category }}</span>
                        <span v-else-if="isTrending(item)" class="mk-tag hot"><i class="fas fa-fire"></i> Trending</span>
                        <span v-else-if="isNew(item)" class="mk-tag new">New</span>
                      </template>
                      <span class="mk-tag">{{ getAssetTypeLabel(item) }}</span>
                      <span
                        v-if="!(isInstalled(item) || isPurchased(item))"
                        class="mk-tag price"
                        :class="{ free: !(item.price > 0) }"
                      >
                        {{ item.price > 0 ? '$' + item.price.toFixed(2) : 'FREE' }}
                      </span>
                    </div>
                  </div>

                  <div class="mk-card-icon" :style="iconStyle(item)"><i :class="getAssetIcon(item)"></i></div>

                  <div class="mk-card-body">
                    <h3 class="mk-card-title">{{ item.title }}</h3>
                    <!-- the author is redundant on a profile: every card is theirs -->
                    <div v-if="!profileUserId || pluginTrust(item)" class="mk-card-by">
                      <button
                        v-if="!profileUserId && item.publisher_id"
                        class="mk-card-author is-link"
                        v-tooltip="`View ${item.publisher_pseudonym || 'publisher'}'s profile`"
                        @click.stop="openProfile(item)"
                      >
                        {{ item.publisher_pseudonym || 'Anonymous' }}
                      </button>
                      <span v-else-if="!profileUserId" class="mk-card-author">{{ item.publisher_pseudonym || 'Anonymous' }}</span>
                      <!-- trust system: pre-install trust badge for plugin items -->
                      <Tooltip
                        v-if="pluginTrust(item)"
                        :title="trustTierLabel(pluginTrust(item).trustTier)"
                        :text="trustTooltipText(pluginTrust(item))"
                        position="top"
                        width="300px"
                      >
                        <span class="trust-badge" :class="'trust-' + pluginTrust(item).trustTier">
                          <span class="trust-dot"></span>
                          {{ pluginTrust(item).trustTier }}
                        </span>
                      </Tooltip>
                    </div>
                    <p class="mk-card-desc">{{ item.tagline || item.description || 'No description available' }}</p>
                    <div class="mk-card-meta">
                      <!-- an unrated item is "Unrated", never a fake 0.0 — most of
                           the catalogue has no ratings yet, and 0.0 reads as bad -->
                      <span v-if="item.rating_count > 0" class="mk-m mk-m-star">
                        <i class="fas fa-star"></i>
                        <b>{{ item.rating.toFixed(1) }}</b>
                        <span class="mk-m-count">({{ item.rating_count }})</span>
                      </span>
                      <span v-else class="mk-m mk-m-unrated">Unrated</span>
                      <span class="mk-m"><i class="fas fa-download"></i><b>{{ formatNumber(item.downloads || 0) }}</b></span>
                      <span v-if="item.category" class="mk-cat">{{ item.category }}</span>
                    </div>
                  </div>

                  <div class="mk-card-foot">
                    <button
                      class="mk-inst"
                      :class="{ done: isInstalled(item) || isPurchased(item), busy: installingIds.has(item.id) }"
                      data-sound="chaChingMoney"
                      :disabled="isInstalled(item) || isPurchased(item) || installingIds.has(item.id)"
                      @click.stop="installWithBusy(item)"
                    >
                      <i :class="installIcon(item)"></i>
                      <span class="mk-lbl">{{ installLabel(item) }}</span>
                    </button>                    <button class="mk-ghost" v-tooltip="'Quick look'" @click.stop="handleWorkflowClick(item)">
                      <i class="fas fa-eye"></i><span class="mk-glabel">Quick look</span>
                    </button>
                  </div>
                </article>
                </template>
              </div>
            </div>
          </main>
        </div>
      </div>
    </template>
  </BaseScreen>

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="MarketplaceScreen" @close="onTutorialClose" />
</template>

<script>
import { ref, computed, nextTick, inject, watch, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import BaseScreen from '../../BaseScreen.vue';
import BaseTabControls from '../../../_components/BaseTabControls.vue';
import BaseTable from '../../../_components/BaseTable.vue';import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { API_CONFIG } from '@/tt.config.js';
import { useMarketplaceTutorial } from './useMarketplaceTutorial.js';
// One definition of what a marketplace card looks like, shared with
// MarketplaceShelf. See composables/useMarketplaceCard.js for why.
import {
  assetIcon,
  assetTypeLabel,
  artStyle,
  iconStyle,
  isNew,
  daysSince,
  buildTrendingIds,
  buildCategoryRankMap,
  formatCount,
} from '@/composables/useMarketplaceCard';

export default {
  name: 'MarketplaceScreen',
  components: { CustomSelect, BaseScreen, BaseTabControls, BaseTable, SimpleModal, PopupTutorial, Tooltip },
  emits: ['screen-change'],
  setup(props, { emit }) {
    // Initialize tutorial
    const { tutorialConfig, startTutorial, onTutorialClose, initializeMarketplaceTutorial } = useMarketplaceTutorial();
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const simpleModal = ref(null);
    const terminalLines = ref([]);
    const selectedWorkflow = ref(null);
    const activeTab = ref('all');
    const currentLayout = ref('grid');
    const selectedCategory = ref('all');

    // trust system Layer 6: trust metadata for plugin cards, keyed by plugin
    // name. Sourced from the local bundled marketplace records (stamped at
    // build time); remote-only plugins have no trust data until the 0.7.0
    // marketplace API carries hashes — their cards simply show no badge.
    const pluginTrustMap = ref({});

    async function loadPluginTrust() {
      try {
        const resp = await fetch(`${API_CONFIG.BASE_URL}/plugins/marketplace`);
        const data = await resp.json();
        const map = {};
        for (const p of data.plugins || []) {
          if (p.trustTier) {
            map[p.name] = {
              trustTier: p.trustTier,
              declaredPermissions: p.declaredPermissions || [],
              detectedCapabilities: p.detectedCapabilities || [],
            };
          }
        }
        pluginTrustMap.value = map;
      } catch (err) {
        console.warn('[Marketplace] Plugin trust metadata unavailable:', err.message);
      }
    }

    function pluginTrust(item) {
      if ((item.asset_type || 'workflow') !== 'plugin') return null;
      return pluginTrustMap.value[item.asset_id] || pluginTrustMap.value[item.name] || null;
    }

    function trustTierLabel(tier) {
      if (tier === 'official') return 'Official — built & maintained by AGNT';
      if (tier === 'community') return 'Community — verified & fully declared';
      if (tier === 'unverified') return 'Unverified — undeclared capabilities';
      return 'Unaudited — could not be scanned';
    }

    function trustTooltipText(trust) {
      const parts = [];
      if (trust.trustTier === 'official') {
        parts.push('First-party AGNT plugin — built, scanned, and integrity-tracked by the AGNT team.');
      } else if (trust.trustTier === 'community') {
        parts.push('This plugin is integrity-tracked and every capability it uses is declared by its author.');
      } else if (trust.trustTier === 'unverified') {
        parts.push('This plugin uses capabilities its author has not declared yet.');
      } else {
        parts.push('This plugin could not be scanned.');
      }
      parts.push('Package will be verified against its marketplace record during installation.');
      const caps = (trust.declaredPermissions.length && trust.declaredPermissions) || trust.detectedCapabilities;
      if (caps.length) parts.push('Requests: ' + caps.join(', ') + '.');
      return parts.join(' ');
    }

    // Define table columns
    const tableColumns = [
      { key: 'title', label: 'Name', width: '2fr' },
      { key: 'publisher', label: 'Publisher', width: '1.5fr' },
      { key: 'price', label: 'Price', width: '100px' },
      { key: 'rating', label: 'Rating', width: '120px' },
      { key: 'downloads', label: 'Downloads', width: '120px' },
      { key: 'actions', label: 'Actions', width: '140px' },
    ];

    // Define earnings table columns
    const earningsColumns = [
      { key: 'title', label: 'Item', width: '2fr' },
      { key: 'sales', label: 'Sales', width: '100px' },
      { key: 'revenue', label: 'Revenue', width: '120px' },
      { key: 'earnings', label: 'Your Earnings', width: '140px' },
    ];    // Define tabs - NOW WITH ASSET TYPES
    const tabs = [
      { id: 'all', name: 'All', icon: 'fas fa-list' },
      { id: 'workflows', name: 'Workflows', icon: 'fas fa-project-diagram' },
      { id: 'agents', name: 'Agents', icon: 'fas fa-robot' },
      { id: 'tools', name: 'Tools', icon: 'fas fa-wrench' },
      { id: 'plugins', name: 'Plugins', icon: 'fas fa-puzzle-piece' },
      // { id: 'featured', name: 'Featured', icon: 'fas fa-star' },
      { id: 'my-installs', name: 'My Installs', icon: 'fas fa-box-open' },
      { id: 'my-listings', name: 'My Listings', icon: 'fas fa-user-circle' },
      { id: 'my-earnings', name: 'My Earnings', icon: 'fas fa-dollar-sign' },
      // { id: 'free', name: 'Free', icon: 'fas fa-gift' },
      // { id: 'paid', name: 'Paid', icon: 'fas fa-coins' },
    ];

    // Computed properties from store
    const marketplaceWorkflows = computed(() => store.getters['marketplace/filteredMarketplaceWorkflows'] || []);
    const marketplaceAgents = computed(() => store.getters['marketplace/filteredMarketplaceAgents'] || []);
    const marketplaceTools = computed(() => store.getters['marketplace/filteredMarketplaceTools'] || []);
    const marketplacePlugins = computed(() => store.getters['marketplace/filteredMarketplacePlugins'] || []);
    const marketplaceItems = computed(() => store.getters['marketplace/filteredMarketplaceItems'] || []);
    const myPublishedItems = computed(() => store.state.marketplace.myPublishedItems || []);
    const myInstalls = computed(() => store.state.marketplace.myInstalls || []);
    const myPurchases = computed(() => store.state.marketplace.myPurchases || []);
    const featuredWorkflows = computed(() => store.state.marketplace.featuredWorkflows || []);
    const filters = computed(() => store.state.marketplace.filters);
    const isLoading = computed(() => store.state.marketplace.isLoading);
    const myEarnings = computed(() => store.state.marketplace.myEarnings || {});

    // Watch for category changes and close right panel
    watch(selectedCategory, () => {
      selectedWorkflow.value = null;
    });

    // Watch for filter changes from left panel and close right panel
    watch(
      () => filters.value.priceRange,
      () => {
        selectedWorkflow.value = null;
      }
    );

    watch(
      () => filters.value.minRating,
      () => {
        selectedWorkflow.value = null;
      }
    );

    watch(
      () => filters.value.sortBy,
      () => {
        selectedWorkflow.value = null;
      }
    );

    // Filtered workflows based on active tab
    const filteredWorkflows = computed(() => {
      // Select the correct data source based on active tab
      let items;
      switch (activeTab.value) {
        case 'workflows':
          items = marketplaceWorkflows.value;
          break;
        case 'agents':
          items = marketplaceAgents.value;
          break;
        case 'tools':
          items = marketplaceTools.value;
          break;
        case 'plugins':
          items = marketplacePlugins.value;
          break;
        case 'featured':
          items = featuredWorkflows.value;
          break;
        case 'my-installs':
          // Show installed items - combine installs and purchases
          items = myInstalls.value;
          break;
        case 'my-listings':
          // Show ONLY published items (filter out unpublished/draft)
          items = myPublishedItems.value.filter((item) => item.status === 'published');
          break;
        case 'all':
          // Combine ALL asset types and remove duplicates by ID
          // Union every asset type — plugins included. The remote /marketplace/items
          // endpoint already returns all four types; this union was workflows+agents+
          // tools only, which silently hid every plugin from the All tab.
          const allItems = [...marketplaceWorkflows.value, ...marketplaceAgents.value, ...marketplaceTools.value, ...marketplacePlugins.value];
          const uniqueIds = new Set();
          items = allItems.filter((item) => {
            if (uniqueIds.has(item.id)) {
              return false;
            }
            uniqueIds.add(item.id);
            return true;
          });
          break;
        case 'free':
        case 'paid':
          // For free/paid, also combine all asset types and remove duplicates
          // Same union as 'all' — free/paid must not hide plugins either.
          const combinedItems = [...marketplaceWorkflows.value, ...marketplaceAgents.value, ...marketplaceTools.value, ...marketplacePlugins.value];
          const seenIds = new Set();
          items = combinedItems.filter((item) => {
            if (seenIds.has(item.id)) {
              return false;
            }
            seenIds.add(item.id);
            return true;
          });
          break;
        default:
          items = marketplaceWorkflows.value;
      }

      // Apply price filters from left panel OR from free/paid tabs
      const priceFilter = filters.value.priceRange || (activeTab.value === 'free' ? 'free' : activeTab.value === 'paid' ? 'paid' : 'all');

      if (priceFilter === 'free') {
        items = items.filter((w) => !w.price || w.price === 0);
      } else if (priceFilter === 'paid') {
        items = items.filter((w) => w.price && w.price > 0);
      }

      // Apply rating filter from left panel
      if (filters.value.minRating && filters.value.minRating > 0) {
        items = items.filter((w) => (w.rating || 0) >= filters.value.minRating);
      }

      // Apply search filter
      if (filters.value.search && filters.value.search.trim()) {
        const searchLower = filters.value.search.toLowerCase().trim();
        items = items.filter((w) => {
          const title = (w.title || '').toLowerCase();
          const description = (w.description || '').toLowerCase();
          const tagline = (w.tagline || '').toLowerCase();
          const category = (w.category || '').toLowerCase();
          const publisher = (w.publisher_name || '').toLowerCase();

          // Handle tags - can be array or comma-separated string
          let tagsString = '';
          if (Array.isArray(w.tags)) {
            tagsString = w.tags.join(' ').toLowerCase();
          } else if (typeof w.tags === 'string') {
            tagsString = w.tags.toLowerCase();
          }

          return (
            title.includes(searchLower) ||
            description.includes(searchLower) ||
            tagline.includes(searchLower) ||
            category.includes(searchLower) ||
            publisher.includes(searchLower) ||
            tagsString.includes(searchLower)
          );
        });
      }

      // Apply sorting from left panel
      const sortBy = filters.value.sortBy || 'popular';
      const sorted = [...items];

      switch (sortBy) {
        case 'recent':
          sorted.sort((a, b) => new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0));
          break;
        case 'rating':
          sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
          break;
        case 'downloads':
          sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
          break;
        case 'price-low':
          sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
          break;
        case 'price-high':
          sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
          break;
        case 'popular':
        default:
          sorted.sort((a, b) => {
            const aScore = (b.downloads || 0) * 0.7 + (b.rating || 0) * 0.3;
            const bScore = (a.downloads || 0) * 0.7 + (a.rating || 0) * 0.3;
            return bScore - aScore;
          });
      }

      return sorted;
    });

    // Get unique categories from workflows
    const availableCategories = computed(() => {
      const categories = new Set();
      filteredWorkflows.value.forEach((workflow) => {
        if (workflow.category) {
          categories.add(workflow.category);
        }
      });
      return Array.from(categories).sort();
    });

    // Category counts
    const categoryCounts = computed(() => {
      const counts = { all: filteredWorkflows.value.length };
      availableCategories.value.forEach((cat) => {
        counts[cat] = filteredWorkflows.value.filter((w) => w.category === cat).length;
      });
      return counts;
    });

    // Workflows filtered by selected category
    const displayedWorkflows = computed(() => {
      if (selectedCategory.value === 'all') {
        return filteredWorkflows.value;
      }
      return filteredWorkflows.value.filter((w) => w.category === selectedCategory.value);
    });

    // Dynamic label for current asset type
    const currentAssetTypeLabel = computed(() => {
      switch (activeTab.value) {
        case 'workflows':
          return 'workflows';
        case 'agents':
          return 'agents';
        case 'tools':
          return 'tools';
        case 'plugins':
          return 'plugins';
        case 'featured':
          return 'items';
        case 'free':
        case 'paid':
        case 'all':
        default:
          return 'items';
      }
    });

    /* ══════════════════════════════════════════════════════════════════
       MARKETPLACE PRESENTATION LAYER
       Everything below is derived client-side from data already in the
       store. No new endpoints, no new state, no fabricated metrics.
       ══════════════════════════════════════════════════════════════════ */

    // Per-item install busy flags. Reassigned (not mutated) so reactivity is
    // guaranteed regardless of collection-proxy behaviour.
    const installingIds = ref(new Set());

    const chipRailEl = ref(null);
    const railHasMore = ref(false);

    const priceSegments = [
      { value: 'all', label: 'All' },
      { value: 'free', label: 'Free' },
      { value: 'paid', label: 'Paid' },
    ];

    // Values must match the switch in filteredWorkflows / the left panel.
    const sortOptions = [
      { value: 'popular', label: 'Most popular' },
      { value: 'downloads', label: 'Most installed' },
      { value: 'rating', label: 'Highest rated' },
      { value: 'recent', label: 'Recently added' },
      { value: 'price-low', label: 'Price: low → high' },
      { value: 'price-high', label: 'Price: high → low' },
    ];

    // Badge rules live in useMarketplaceCard so this screen and MarketplaceShelf
    // cannot disagree about what "New" or "#1 in" means.
    const trendingIds = computed(() => buildTrendingIds(filteredWorkflows.value));
    const isTrending = (i) => trendingIds.value.has(i.id);

    const categoryRankMap = computed(() => buildCategoryRankMap(filteredWorkflows.value));
    const rankBadge = (i) => categoryRankMap.value[i.id] || null;

    const pulseStats = computed(() => {
      const all = marketplaceItems.value || [];
      return {
        installs: all.reduce((s, i) => s + (i.downloads || 0), 0),
        builders: new Set(all.map((i) => i.publisher_pseudonym).filter(Boolean)).size,
        free: all.filter((i) => !(i.price > 0)).length,
        paid: all.filter((i) => i.price > 0).length,
        fresh: all.filter((i) => daysSince(i) <= 30).length,
      };
    });

    // The editorial layer only appears on an unfiltered Discover view, so the
    // page never shows curation that contradicts an active filter.
    const showEditorial = computed(
      () =>
        currentLayout.value === 'grid' &&
        !profileUserId.value &&
        activeTab.value === 'all' &&
        !filters.value.search &&
        selectedCategory.value === 'all' &&
        (filters.value.priceRange || 'all') === 'all'
    );

    // Prefer the store's real featured list; fall back to top-3 by popularity.
    // Requires exactly 3 so the 1-large + 2-small grid can never render a hole.
    const spotlightItems = computed(() => {
      if (!showEditorial.value) return [];
      const pool = filteredWorkflows.value;
      if (pool.length < 6) return [];
      const byId = new Map(pool.map((i) => [i.id, i]));
      const picks = [];
      const push = (i) => {
        if (i && picks.length < 3 && !picks.some((p) => p.id === i.id)) picks.push(i);
      };
      for (const f of featuredWorkflows.value) push(byId.get(f.id));
      if (picks.length < 3) {
        const ranked = [...pool].sort(
          (a, b) => (b.downloads || 0) - (a.downloads || 0) || (b.rating || 0) - (a.rating || 0)
        );
        for (const i of ranked) push(i);
      }
      return picks.length === 3 ? picks : [];
    });
    const spotlightIds = computed(() => new Set(spotlightItems.value.map((i) => i.id)));
    const showSpotlight = computed(() => spotlightItems.value.length === 3);

    // Spotlit items are lifted out of the grid so the page never repeats itself.
    const gridItems = computed(() =>
      showSpotlight.value ? displayedWorkflows.value.filter((i) => !spotlightIds.value.has(i.id)) : displayedWorkflows.value
    );

    const collections = computed(() => {
      if (!showEditorial.value) return [];
      const byCat = {};
      for (const i of filteredWorkflows.value) {
        if (spotlightIds.value.has(i.id)) continue;
        const c = i.category;
        if (!c || c === 'Uncategorized') continue;
        if (!byCat[c]) byCat[c] = [];
        byCat[c].push(i);
      }
      return Object.keys(byCat)
        .filter((c) => byCat[c].length >= 3)
        .sort((a, b) => byCat[b].length - byCat[a].length || a.localeCompare(b))
        .slice(0, 4)
        .map((name) => {
          const list = byCat[name];
          const items = [...list].sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 4);
          const freeItems = items.filter((i) => !(i.price > 0) && !isInstalled(i) && !isPurchased(i));
          return {
            name,
            total: list.length,
            items,
            freeItems,
            freeCount: freeItems.length,
            blurb: `The ${items.length} most-installed ${name.toLowerCase()} items on the marketplace.`,
          };
        });
    });
    const showCollections = computed(() => showEditorial.value && collections.value.length >= 2);

    /* ══════════════════════════════════════════════════════════════════
       PUBLISHER PROFILE
       A view STATE of this screen (like activeTab / currentLayout), not a
       separate route. That keeps the right panel, the install flow and every
       filter working with zero changes, and needs no new endpoint: the item
       list already carries publisher_id and publisher_pseudonym.
       ══════════════════════════════════════════════════════════════════ */
    const profileUserId = ref(null);
    const mainContentEl = ref(null);

    // Resolve from the real user store (store/features/user.js), which exposes the
    // getUserId getter — not a guessed userAuth.user shape. Only used for the
    // profile's "This is you" marker, so it degrades to never-self if unset.
    const currentUserId = computed(
      () =>
        store.getters['user/getUserId'] ||
        store.getters['user/currentUser']?.id ||
        store.state.user?.currentUser?.id ||
        null
    );

    // Deliberately reads marketplaceItems, not filteredWorkflows: a profile shows
    // everything that publisher has shipped, independent of the active tab,
    // search or category filter.
    const profileItems = computed(() => {
      if (!profileUserId.value) return [];
      return (marketplaceItems.value || [])
        .filter((i) => i.publisher_id === profileUserId.value)
        .sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    });

    const profileInfo = computed(() => {
      const list = profileItems.value;
      if (!list.length) return null;
      const rated = list.filter((i) => (i.rating_count || 0) > 0);
      const totalRatings = rated.reduce((s, i) => s + (i.rating_count || 0), 0);
      return {
        id: profileUserId.value,
        name: list[0].publisher_pseudonym || 'Anonymous',
        count: list.length,
        installs: list.reduce((s, i) => s + (i.downloads || 0), 0),
        // weighted by rating_count — a lone 5.0 must not outrank a 4.8 from many
        rating: totalRatings ? rated.reduce((s, i) => s + i.rating * i.rating_count, 0) / totalRatings : 0,
        ratingCount: totalRatings,
        categories: [...new Set(list.map((i) => i.category).filter(Boolean))],
        since: list.reduce((min, i) => {
          const d = itemDate(i);
          return d && (!min || d < min) ? d : min;
        }, null),
        installedByMe: list.filter((i) => isInstalled(i) || isPurchased(i)).length,
        isSelf: !!currentUserId.value && profileUserId.value === currentUserId.value,
      };
    });

    // One source for the grid, so profile mode reuses the card markup verbatim.
    const visibleItems = computed(() => (profileUserId.value ? profileItems.value : gridItems.value));

    /**
     * The toolbar renders outside <main>, so it can no longer inherit its
     * visibility from the branch it used to sit in. This states that branch
     * explicitly and in one place: it was the v-else arm of the
     * earnings/table/grid chain, carrying its own v-if="!profileUserId".
     * Pinned to the template by Marketplace.toolbar.spec.js.
     */
    const showToolbar = computed(
      () => activeTab.value !== 'my-earnings' && currentLayout.value !== 'table' && !profileUserId.value
    );

    const openProfile = (item) => {
      if (!item || !item.publisher_id) return; // anonymous publishers stay unlinked
      playSound('typewriterKeyPress');
      profileUserId.value = item.publisher_id;
      selectedWorkflow.value = null;
      addLine(`[Marketplace] Viewing publisher: ${item.publisher_pseudonym || 'Anonymous'}`, 'info');
      nextTick(() => mainContentEl.value?.scrollTo({ top: 0 }));
    };
    const closeProfile = () => {
      profileUserId.value = null;
    };

    const formatJoined = (value) => {
      if (!value) return 'unknown';
      // API dates arrive as 'YYYY-MM-DD HH:MM:SS'; normalise for Safari/Firefox
      const d = new Date(String(value).replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    };

    // Identity mark, seeded the same deterministic way as the card art so a
    // publisher and their catalogue read as one family. No upload infra needed.
    // Both gradient stops are held at >=67% lightness deliberately: the initials
    // are painted in fixed dark ink, and below that the worst-case hue (blue,
    // ~240) drops to 1.99:1. At these values every possible publisher id clears
    // AA 4.5 in every theme.
    const avatarStyle = (id) => {
      const seed = String(id || '')
        .split('')
        .reduce((a, c) => a + c.charCodeAt(0), 0);
      const h = (seed * 29) % 360;
      return {
        backgroundImage: `linear-gradient(140deg, hsl(${h} 62% 70%), hsl(${(h + 52) % 360} 58% 67%))`,
        color: '#0a0a14',
      };
    };
    const initials = (name) =>
      String(name || '?')
        .split(/[\s&]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();

    // ── install choreography ──────────────────────────────────────────────
    const installLabel = (item) => {
      if (isInstalled(item)) return 'Installed';
      if (isPurchased(item)) return 'Purchased';
      if (installingIds.value.has(item.id)) return item.price > 0 ? 'Opening…' : 'Installing…';
      return item.price > 0 ? `Get · $${item.price.toFixed(2)}` : 'Install';
    };
    const installIcon = (item) => {
      if (isInstalled(item) || isPurchased(item)) return 'fas fa-check';
      if (installingIds.value.has(item.id)) return 'fas fa-spinner fa-spin';
      return 'fas fa-download';
    };
    // Thin wrapper around the untouched handleInstallWorkflow — adds only the
    // per-card busy flag; all payment / dependency / plugin logic is unchanged.
    const installWithBusy = async (item) => {
      if (!item || isInstalled(item) || isPurchased(item) || installingIds.value.has(item.id)) return;
      const next = new Set(installingIds.value);
      next.add(item.id);
      installingIds.value = next;
      try {
        await handleInstallWorkflow(item);
      } finally {
        const done = new Set(installingIds.value);
        done.delete(item.id);
        installingIds.value = done;
      }
    };
    const installCollection = async (c) => {
      if (!c.freeItems.length) {
        selectedCategory.value = c.name;
        return;
      }
      for (const it of c.freeItems) {
        // sequential on purpose: keeps terminal output ordered and avoids a
        // burst of concurrent saves against the local API
        // eslint-disable-next-line no-await-in-loop
        await installWithBusy(it);
      }
    };

    // ── toolbar handlers: always round-trip through the store so the left
    //    panel and this toolbar can never disagree ──────────────────────────
    const setPriceRange = (value) => store.dispatch('marketplace/updateFilters', { priceRange: value });
    const setSortBy = (value) => store.dispatch('marketplace/updateFilters', { sortBy: value });
    const showNewest = () => store.dispatch('marketplace/updateFilters', { sortBy: 'recent' });
    const filterToCategory = (name) => {
      selectedCategory.value = name;
    };
    const resetFilters = () => {
      selectedCategory.value = 'all';
      store.dispatch('marketplace/updateFilters', { search: '', priceRange: 'all', minRating: 0 });
    };

    // ── category rail overflow affordance ─────────────────────────────────
    const syncRail = () => {
      const el = chipRailEl.value;
      railHasMore.value = el ? el.scrollWidth - el.clientWidth - el.scrollLeft > 2 : false;
    };
    const scrollRail = () => {
      if (chipRailEl.value) chipRailEl.value.scrollBy({ left: 280, behavior: 'smooth' });
    };

    // Deterministic per-item art now lives in useMarketplaceCard (imported
    // above) so the shelf renders byte-identical cards.
    // Re-measure the rail whenever its contents or width can have changed.
    watch([availableCategories, selectedCategory, activeTab, currentLayout], () => nextTick(syncRail));

    // NOTE: tab counts were trialled here and removed — the badges pushed the
    // fixed 1048px tab strip into overflow, clipping "My Earnings". The same
    // numbers are already surfaced by the category rail ("All 29") and the
    // results line ("Showing 26 of 29 items").

    // Helper methods
    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();

    const addLine = (content, type = 'default') => {
      terminalLines.value.push({ content, type });
      nextTick(() => scrollToBottom());
    };

    // Kept as local aliases so the template reads the same; the definitions are
    // shared with MarketplaceShelf.
    const formatNumber = formatCount;
    const getAssetIcon = assetIcon;
    const getAssetTypeLabel = assetTypeLabel;

    const isInstalled = (item) => {
      // Check both id and marketplace_item_id to handle different data structures
      return myInstalls.value.some((installed) => installed.id === item.id || installed.marketplace_item_id === item.id);
    };

    const isPurchased = (item) => {
      // Check both id and marketplace_item_id to handle different data structures
      return myPurchases.value.some((purchased) => purchased.id === item.id || purchased.marketplace_item_id === item.id);
    };

    const handleWorkflowClick = (workflow) => {
      playSound('typewriterKeyPress');
      // If clicking the same workflow, close it
      if (selectedWorkflow.value?.id === workflow.id) {
        selectedWorkflow.value = null;
        addLine(`Closed workflow details`, 'info');
      } else {
        selectedWorkflow.value = workflow;
        addLine(`Selected workflow: ${workflow.title}`, 'info');
      }
    };

    const handleSearch = (query) => {
      // searching is a browse action — leave the profile so results aren't
      // silently filtered out of view behind it
      profileUserId.value = null;
      store.dispatch('marketplace/updateFilters', { search: query });
    };

    const selectTab = async (tabId) => {
      activeTab.value = tabId;
      selectedWorkflow.value = null;
      profileUserId.value = null;

      // Update filters based on tab
      const filterUpdates = { search: filters.value.search };

      // Handle asset type tabs
      switch (tabId) {
        case 'workflows':
          filterUpdates.assetType = 'workflow';
          addLine(`[Marketplace] Viewing workflows`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'agents':
          filterUpdates.assetType = 'agent';
          addLine(`[Marketplace] Viewing agents`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'tools':
          filterUpdates.assetType = 'tool';
          addLine(`[Marketplace] Viewing tools`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'plugins':
          filterUpdates.assetType = 'plugin';
          addLine(`[Marketplace] Viewing plugins`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        case 'free':
          filterUpdates.priceRange = 'free';
          filterUpdates.assetType = 'all';
          addLine(`[Marketplace] Viewing free items`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          break;
        case 'paid':
          filterUpdates.priceRange = 'paid';
          filterUpdates.assetType = 'all';
          addLine(`[Marketplace] Viewing paid items`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          break;
        case 'my-installs':
          addLine(`[Marketplace] Viewing my installed items`, 'info');
          await store.dispatch('marketplace/fetchMyInstalls');
          break;
        case 'my-listings':
          addLine(`[Marketplace] Viewing my published items`, 'info');
          await store.dispatch('marketplace/fetchMyPublishedItems');
          break;
        case 'my-earnings':
          addLine(`[Marketplace] Viewing my earnings`, 'info');
          await store.dispatch('marketplace/fetchMyEarnings');
          break;
        case 'all':
          filterUpdates.priceRange = 'all';
          filterUpdates.assetType = 'all';
          addLine(`[Marketplace] Viewing all items`, 'info');
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
          break;
        default:
          filterUpdates.priceRange = 'all';
          filterUpdates.assetType = 'all';
          await store.dispatch('marketplace/updateFilters', filterUpdates);
          await store.dispatch('marketplace/fetchMarketplaceItems');
      }
    };

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    const handleInstallWorkflow = async (workflow) => {
      const assetType = workflow.asset_type || 'workflow';
      const assetTypeLabel = assetType.charAt(0).toUpperCase() + assetType.slice(1);

      try {
        // Check if this is a paid item
        if (workflow.price && workflow.price > 0) {
          // Check if user has already purchased
          const hasPurchased = await store.dispatch('marketplace/checkPurchaseStatus', workflow.id);

          if (!hasPurchased) {
            // Show purchase confirmation modal
            const confirmed = await simpleModal.value.showModal({
              title: 'Purchase Required',
              message: `"${workflow.title}" costs $${workflow.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
              confirmText: 'Purchase Now',
              cancelText: 'Cancel',
              showCancel: true,
              confirmClass: 'btn-primary',
            });

            if (confirmed) {
              addLine(`[Marketplace] Redirecting to checkout for "${workflow.title}"...`, 'info');
              // Redirect to Stripe checkout
              await store.dispatch('marketplace/purchaseItem', {
                itemId: workflow.id,
              });
              // Note: User will be redirected to Stripe, so code after this won't execute
            }
            return;
          }
        }

        // If free or already purchased, proceed with installation
        addLine(`[Marketplace] Installing "${workflow.title}"...`, 'info');

        let result = await store.dispatch('marketplace/installWorkflow', {
          workflowId: workflow.id,
          auto_update: false,
        });

        // Check if missing plugins need to be installed
        if (result && result.needsPlugins && result.missingPlugins?.length > 0) {
          const pluginList = result.missingPlugins.map((p) => `• ${p.displayName || p.name}`).join('\n');

          const confirmed = await simpleModal.value.showModal({
            title: 'Plugins Required',
            message: `This ${assetType} requires plugins that aren't installed:\n\n${pluginList}\n\nInstall them now?`,
            confirmText: 'Install Plugins',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (!confirmed) {
            addLine(`[Marketplace] Installation cancelled - missing required plugins`, 'warning');
            return;
          }

          // Install each missing plugin with progress feedback
          const totalPlugins = result.missingPlugins.length;
          const installedPlugins = [];

          for (let i = 0; i < result.missingPlugins.length; i++) {
            const plugin = result.missingPlugins[i];
            const pluginName = plugin.displayName || plugin.name;

            addLine(`[Marketplace] Installing plugin ${i + 1}/${totalPlugins}: ${pluginName}...`, 'info');

            try {
              // Skip refresh during batch install - we'll refresh once at the end
              await store.dispatch('marketplace/installPlugin', {
                pluginName: plugin.name,
                skipRefresh: true
              });
              installedPlugins.push(pluginName);
              addLine(`[Marketplace] ✓ ${pluginName} installed`, 'success');
            } catch (pluginError) {
              addLine(`[Marketplace] ✗ Failed to install ${pluginName}: ${pluginError.message}`, 'error');
              await simpleModal.value.showModal({
                title: '✗ Plugin Installation Failed',
                message: `Failed to install required plugin "${pluginName}":\n\n${pluginError.message}\n\nThe ${assetType} was not installed.`,
                confirmText: 'OK',
                showCancel: false,
                confirmClass: 'btn-danger',
              });
              return;
            }
          }

          // Refresh tools once after all plugins are installed
          addLine(`[Marketplace] Refreshing tools...`, 'info');
          await store.dispatch('tools/refreshAllTools');

          // Notify all components that plugins were installed (for ToolSidebar, etc.)
          window.dispatchEvent(new CustomEvent('plugin-installed', { detail: { count: installedPlugins.length } }));

          // Show summary of installed plugins
          const pluginSummary = installedPlugins.map((p) => `• ${p}`).join('\n');
          await simpleModal.value.showModal({
            title: '✓ Plugins Installed',
            message: `Successfully installed ${installedPlugins.length} plugin(s):\n\n${pluginSummary}\n\nNow installing the ${assetType}...`,
            confirmText: 'Continue',
            showCancel: false,
            confirmClass: 'btn-primary',
          });

          // Now save the asset
          addLine(`[Marketplace] Saving ${assetType}...`, 'info');
          await store.dispatch('marketplace/saveInstalledAsset', {
            assetType: result.assetType,
            assetData: result.assetData,
          });

          // Update result to have assetId for the success message
          result = { assetId: result.assetData?.id || result.assetId };
        }

        addLine(`✓ ${assetTypeLabel} installed successfully!`, 'success');
        addLine(`  New ${assetType} ID: ${result.assetId}`, 'info');
        addLine(`  You can now find it in your ${assetType}s list`, 'info');

        // Refresh myInstalls and myPurchases to update UI immediately
        await Promise.all([store.dispatch('marketplace/fetchMyInstalls'), store.dispatch('marketplace/fetchMyPurchases')]);

        // Trigger confetti animation
        triggerConfetti();

        // Show success modal
        await simpleModal.value.showModal({
          title: '✓ Installed Successfully',
          message: `"${workflow.title}" has been installed!\n\nNew ${assetType} ID: ${result.assetId}\n\nYou can now find it in your ${assetType}s list.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Install error:', error);

        if (error.code === 'PAYMENT_REQUIRED') {
          addLine(`✗ This ${assetType} costs $${workflow.price}. Payment required.`, 'error');
          const confirmed = await simpleModal.value.showModal({
            title: 'Payment Required',
            message: `This ${assetType} costs $${workflow.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
            confirmText: 'Purchase Now',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (confirmed) {
            await store.dispatch('marketplace/purchaseItem', {
              itemId: workflow.id,
            });
          }
        } else if (error.message.includes('already installed')) {
          addLine(`✗ You have already installed this ${assetType}.`, 'error');
          await simpleModal.value.showModal({
            title: '✗ Already Installed',
            message: `You have already installed this ${assetType}.`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-secondary',
          });
        } else if (error.message.includes('invalid payment setup')) {
          addLine(`✗ This item has invalid payment configuration.`, 'error');
          await simpleModal.value.showModal({
            title: '✗ Payment Setup Error',
            message: `This item cannot be purchased due to invalid payment configuration.\n\nThe publisher needs to fix their Stripe Connect setup.\n\nError: ${error.message}`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
        } else {
          addLine(`✗ Error installing ${assetType}: ${error.message}`, 'error');
          await simpleModal.value.showModal({
            title: '✗ Installation Error',
            message: `Failed to install ${assetType}:\n\n${error.message}`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
        }
      }
    };

    const handlePanelAction = async (action, payload) => {
      console.log('Marketplace panel action:', action, payload);

      switch (action) {
        case 'navigate':
          emit('screen-change', payload);
          break;
        case 'update-filters':
          await store.dispatch('marketplace/updateFilters', payload);
          // Trigger fetch after updating filters
          await store.dispatch('marketplace/fetchMarketplaceWorkflows');
          addLine(`[Marketplace] Filters updated`, 'info');
          break;
        case 'refresh-marketplace':
          await store.dispatch('marketplace/fetchMarketplaceWorkflows');
          await store.dispatch('marketplace/fetchFeaturedWorkflows');
          addLine(`[Marketplace] Refreshed marketplace data`, 'info');
          break;
        case 'install-workflow':
          await handleInstallWorkflow(payload);
          break;
        case 'view-publisher':
          // raised by the right panel's publisher line
          openProfile(payload);
          break;
        case 'close-workflow-details':
          selectedWorkflow.value = null;
          addLine(`[Marketplace] Closed workflow details`, 'info');
          break;
        case 'item-updated':
          // Refresh the marketplace items after edit
          if (activeTab.value === 'my-listings') {
            await store.dispatch('marketplace/fetchMyPublishedItems');
            addLine(`[Marketplace] Listing updated - refreshed my listings`, 'success');
          }
          break;
        case 'item-unpublished':
          // Refresh both marketplace and my listings after unpublish
          await Promise.all([store.dispatch('marketplace/fetchMyPublishedItems'), store.dispatch('marketplace/fetchMarketplaceItems')]);
          selectedWorkflow.value = null;
          addLine(`[Marketplace] Item unpublished - refreshed listings`, 'success');
          break;
        case 'item-deleted':
          // Refresh both marketplace and my listings after delete
          await Promise.all([store.dispatch('marketplace/fetchMyPublishedItems'), store.dispatch('marketplace/fetchMarketplaceItems')]);
          selectedWorkflow.value = null;
          addLine(`[Marketplace] Item deleted - refreshed listings`, 'success');
          break;
        case 'item-republished':
          // Refresh both marketplace and my listings after republish
          await Promise.all([store.dispatch('marketplace/fetchMyPublishedItems'), store.dispatch('marketplace/fetchMarketplaceItems')]);
          addLine(`[Marketplace] Item republished - refreshed listings`, 'success');
          break;
        default:
          console.warn('Unhandled panel action:', action);
      }
    };

    const handleUserInputSubmit = async (input) => {
      addLine(`> ${input}`, 'input');
      // Handle any commands if needed
    };

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

    const initializeScreen = () => {
      terminalLines.value = [];
      addLine('Loading marketplace...', 'info');

      // Check for payment status in URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const paymentStatus = urlParams.get('payment');
      const itemId = urlParams.get('itemId');

      // Non-blocking: fetch all data in parallel, then handle payment redirects
      store.dispatch('marketplace/updateFilters', { assetType: 'all' }).then(() => {
        return Promise.all([
          // fetchMarketplaceItems (not fetchMarketplaceWorkflows): the workflows-only
          // fetch commits SET_MARKETPLACE_WORKFLOWS, which overwrites marketplaceItems
          // with just workflows and leaves the All tab empty of agents/tools/plugins on
          // first load. fetchMarketplaceItems populates all four type buckets.
          store.dispatch('marketplace/fetchMarketplaceItems'),
          store.dispatch('marketplace/fetchFeaturedWorkflows'),
          store.dispatch('marketplace/fetchMyInstalls'),
          store.dispatch('marketplace/fetchMyPurchases'),
        ]);
      }).then(async () => {
        const workflowCount = marketplaceWorkflows.value.length;
        const agentCount = marketplaceAgents.value.length;
        const toolCount = marketplaceTools.value.length;
        const totalCount = workflowCount + agentCount + toolCount;
        const featuredCount = featuredWorkflows.value.length;

        if (totalCount > 0) {
          addLine(`Found ${totalCount} items in marketplace`, 'success');
          if (workflowCount > 0) addLine(`  - ${workflowCount} workflows`, 'info');
          if (agentCount > 0) addLine(`  - ${agentCount} agents`, 'info');
          if (toolCount > 0) addLine(`  - ${toolCount} tools`, 'info');
        } else {
          addLine(`No items found in marketplace`, 'info');
        }

        if (featuredCount > 0) {
          addLine(`${featuredCount} featured items available`, 'success');
        }

        // Handle payment status from URL (needs data to be loaded first)
        if (paymentStatus === 'success' && itemId) {
          addLine(`✓ Payment successful! You can now install the item.`, 'success');

          const item = filteredWorkflows.value.find((w) => w.id === itemId);
          if (item) {
            const shouldInstall = await simpleModal.value.showModal({
              title: '✓ Payment Successful',
              message: `Your purchase of "${item.title}" was successful!\n\nWould you like to install it now?`,
              confirmText: 'Install Now',
              cancelText: 'Later',
              showCancel: true,
              confirmClass: 'btn-primary',
            });

            if (shouldInstall) {
              await handleInstallWorkflow(item);
            }
          }

          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (paymentStatus === 'cancelled') {
          addLine(`Payment was cancelled.`, 'info');
          await simpleModal.value.showModal({
            title: 'Payment Cancelled',
            message: 'Your payment was cancelled. You can try again anytime.',
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-secondary',
          });

          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }).catch((error) => {
        addLine(`Error loading marketplace: ${error.message}`, 'error');
      });

      // Show tutorial after a short delay
      setTimeout(() => {
        initializeMarketplaceTutorial();
      }, 2000);
    };    onMounted(() => {
      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }

      // trust system: trust metadata for plugin card badges (non-blocking)
      loadPluginTrust();

      // category rail overflow affordance
      nextTick(syncRail);
      window.addEventListener('resize', syncRail);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', syncRail);
    });

    return {
      baseScreenRef,
      simpleModal,
      terminalLines,
      selectedWorkflow,
      profileUserId,
      profileInfo,
      visibleItems,
      mainContentEl,
      openProfile,
      closeProfile,
      formatJoined,
      avatarStyle,
      initials,
      pluginTrust,
      trustTierLabel,
      trustTooltipText,
      activeTab,
      currentLayout,
      tabs,
      tableColumns,
      earningsColumns,
      marketplaceWorkflows,
      featuredWorkflows,
      filters,
      isLoading,
      myEarnings,
      filteredWorkflows,
      selectedCategory,
      availableCategories,
      categoryCounts,
      displayedWorkflows,
      currentAssetTypeLabel,
      handleWorkflowClick,
      handleSearch,
      selectTab,
      setLayout,
      handleInstallWorkflow,
      handlePanelAction,
      handleUserInputSubmit,
      initializeScreen,
      formatNumber,
      getAssetIcon,
      getAssetTypeLabel,
      isInstalled,
      isPurchased,
      triggerConfetti,
      tutorialConfig,
      startTutorial,
      onTutorialClose,
      emit,
      installingIds,
      chipRailEl,
      railHasMore,
      priceSegments,
      sortOptions,
      isNew,
      isTrending,
      rankBadge,
      pulseStats,
      showEditorial,
      spotlightItems,
      showSpotlight,
      gridItems,
      collections,
      showCollections,
      showToolbar,
      installLabel,
      installIcon,
      installWithBusy,
      installCollection,
      setPriceRange,
      setSortBy,
      showNewest,
      filterToCategory,
      resetFilters,
      syncRail,
      scrollRail,
      artStyle,
      iconStyle,
    };
  },
};
</script>

<style scoped>
/* trust system Layer 6: trust tier badge (display-only) */
.trust-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72em;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  cursor: help;
}

.trust-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.trust-badge.trust-official {
  color: var(--color-green);
  background: color-mix(in srgb, var(--color-green) 12%, transparent);
}

.trust-badge.trust-community {
  color: var(--color-green);
  background: color-mix(in srgb, var(--color-green) 12%, transparent);
}

.trust-badge.trust-unverified {
  color: var(--color-yellow);
  background: color-mix(in srgb, var(--color-yellow) 12%, transparent);
}

.trust-badge.trust-unaudited {
  color: var(--color-red);
  background: color-mix(in srgb, var(--color-red) 12%, transparent);
}

.marketplace-panel {
  /* isolation: isolate confines every z-index in this screen to a private
     stacking context. Without it the screen's local layering values compete
     directly against the app chrome — .mk-toolbar's z-index of 5 outranked the
     side panels' z-index of 3, so the toolbar painted over panel-hosted UI.
     That toolbar no longer carries a z-index, but the card internals
     (.mk-art-*) still do, so the confinement remains load-bearing.
     Screen-internal layering is a screen-internal concern; it must not be
     expressible against elements outside the screen. */
  isolation: isolate;
  position: relative;
  top: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 0;
  width: 100%;
  height: 100%;
}

.sticky-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  border-radius: 8px;
}

.sticky-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0.85;
  z-index: -1;
}

/* Controls Bar */
.controls-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-wrapper {
  flex: 1;
  min-width: 0;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-light-green);
  font-size: 0.9em;
}

.search-input:focus {
  outline: none;
  border-color: rgba(var(--green-rgb), 0.5);
}

.controls-group {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.view-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  overflow: hidden;
}

body.dark .view-toggle {
  border-color: var(--terminal-border-color);
}

.view-btn {
  background: transparent;
  border: none;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--color-text);
  transition: all 0.2s ease;
  font-size: 0.9em;
}

.view-btn:hover {
  background: rgba(127, 129, 147, 0.1);
}

.view-btn.active {
  background: var(--color-green);
  color: var(--color-dark-navy);
}

.view-btn:not(:last-child) {
  border-right: 1px solid var(--color-light-navy);
}

body.dark .view-btn:not(:last-child) {
  border-right-color: var(--terminal-border-color);
}

/* Category Pills */

/* Results Info */

.marketplace-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-top: 16px;
}

.marketplace-main-content {
  flex: 1;
  height: 100%;
  overflow-y: scroll !important;
  scrollbar-width: thin !important;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.marketplace-main-content::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.marketplace-main-content::-webkit-scrollbar-track {
  background: var(--color-darker-1) !important;
}

.marketplace-main-content::-webkit-scrollbar-thumb {
  background: var(--color-darker-3) !important;
  border-radius: 4px;
}

.marketplace-main-content > * {
  width: 100%;
  max-width: 1048px;
  /* .mk-toolbar-slot mirrors this width and the scrollbar gutter from outside
     the scroller, so the bar and the grid share one centre axis. */
}

/* Featured Section */

.section-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 20px;
  padding-left: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title i {
  color: var(--color-yellow);
  font-size: 16px;
}

/* Category Cards */

/* Asset Type Color Variants */

.table-install-button:disabled {
  background: transparent;
  color: var(--color-yellow);
  border-color: var(--color-yellow);
}

/* Table View Styles */
.price-badge {
  padding: 4px 8px 2px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  display: inline-block;
}

.price-badge.paid {
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
}

.price-badge.free {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.rating-display {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text);
}

.rating-display i {
  color: var(--color-yellow);
  font-size: 11px;
}

.rating-count {
  opacity: 0.6;
  font-size: 10px;
  margin-left: 2px;
}

.downloads-display {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text);
}

.downloads-display i {
  color: var(--color-green);
  font-size: 11px;
}

.table-install-button {
  padding: 6px 12px;
  background: var(--color-green);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  white-space: nowrap;
}

.table-install-button:hover {
  background: rgba(var(--green-rgb), 0.9);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.3);
}

.table-install-button:active {
  transform: translateY(0);
}

.table-install-button i {
  font-size: 10px;
}

/* Earnings Dashboard Styles */
.earnings-dashboard {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.earnings-header {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.earnings-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.earnings-title i {
  color: var(--color-green);
  font-size: 22px;
}

.earnings-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.earnings-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all 0.2s ease;
}

.earnings-card:hover {
  border-color: rgba(var(--green-rgb), 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.earnings-card-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(var(--green-rgb), 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.earnings-card-icon i {
  font-size: 20px;
  color: var(--color-green);
}

.earnings-card-content {
  flex: 1;
  min-width: 0;
}

.earnings-card-label {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.earnings-card-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
}

.earnings-card-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
  opacity: 0.7;
}

/* Earnings Breakdown */
.earnings-breakdown {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
}

.earnings-breakdown .section-title {
  margin-bottom: 16px;
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.breakdown-item {
  padding: 16px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.breakdown-item.fee {
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.2);
}

.breakdown-item.net {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
}

.breakdown-label {
  font-size: 12px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.breakdown-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
}

.breakdown-item.fee .breakdown-value {
  color: var(--color-red);
}

.breakdown-item.net .breakdown-value {
  color: var(--color-green);
}

.earnings-section {
  display: flex;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

:deep(.earnings-section .table-row:last-child) {
  border-bottom: none;
}

.earnings-section .section-title {
  margin-bottom: 16px;
}

.no-earnings {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--color-text-muted);
  gap: 16px;
  text-align: center;
  width: 100%;
}

.no-earnings i {
  font-size: 48px;
  opacity: 0.3;
}

.no-earnings p {
  font-size: 14px;
  opacity: 0.7;
  margin: 0;
}

/* Responsive */
@media (max-width: 640px) {

  .earnings-summary {
    grid-template-columns: 1fr;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   MARKETPLACE GRID SYSTEM

   ART-INK RULE — read before editing:
   .mk-art and .mk-card-art paint a generated HSL gradient that is DARK in
   EVERY theme. Anything drawn on top of them must use literal white or a
   fixed dark scrim, never a theme token — --color-dull-white and friends
   flip to dark ink in the light and rose themes and would vanish.
   Everywhere ELSE in this block: theme tokens only, no hardcoded colour.
   ══════════════════════════════════════════════════════════════════════ */

.items-grid-container {
  display: flex;
  flex-direction: column;
  padding-bottom: 32px;
}

/* ─────────────────────── live pulse strip ─────────────────────── */
.mk-pulse {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 16px;
  margin-bottom: 24px;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  background: linear-gradient(90deg, rgba(var(--primary-rgb), 0.06), transparent 55%);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.mk-pulse b {
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-weight: var(--font-weight-semibold);
}
.mk-pulse-live {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 10px;
}
.mk-beacon {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-green);
  animation: mkBeacon 2s infinite;
}
@keyframes mkBeacon {
  0% { box-shadow: 0 0 0 0 rgba(var(--green-rgb), 0.55); }
  70% { box-shadow: 0 0 0 9px rgba(var(--green-rgb), 0); }
  100% { box-shadow: 0 0 0 0 rgba(var(--green-rgb), 0); }
}
.mk-dot { opacity: 0.35; }
.mk-pulse-cta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  color: var(--color-secondary);
  font-family: var(--font-family-primary);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-xs);
}
.mk-pulse-cta:hover { opacity: 0.75; }

/* ─────────────────────── section headers ─────────────────────── */
.mk-section { width: 100%; margin-bottom: 32px; }
.mk-sec-head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.mk-sec-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  color: var(--color-text);
}
.mk-sec-sub { font-size: var(--font-size-xs); color: var(--color-text-muted); }

/* ─────────────────────── spotlight ─────────────────────── */
.mk-spotlight {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 16px;
}

.mk-hero {
  position: relative;
  overflow: hidden;
  border-radius: 0;
  border: 1px solid var(--terminal-border-color);
  min-height: 270px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 28px;
  cursor: pointer;
  transition: transform var(--transition-medium), border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.mk-hero:first-child { grid-row: 1 / span 2; }
.mk-hero:hover {
  transform: translateY(-3px);
  border-color: rgba(var(--primary-rgb), 0.45);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
}
.mk-hero.selected { border-color: var(--color-primary); }
.mk-hero-sm { min-height: 0; padding: 20px; }
.mk-hero-sm .mk-hero-desc,
.mk-hero-sm .mk-hero-chips,
.mk-hero-sm .mk-hero-cta { display: none; }
.mk-hero-sm .mk-hero-title { font-size: var(--font-size-lg); }
.mk-hero-sm .mk-hero-glyph { font-size: 130px; right: -34px; bottom: -46px; opacity: 0.1; }

.mk-art { position: absolute; inset: 0; z-index: 0; background-size: cover; background-position: center; }
.mk-art-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.mk-hero-scrim {
  position: absolute;
  inset: 0;
  z-index: 0;
  /* art-ink rule: fixed dark scrim, identical in all themes */
  background: linear-gradient(to top, rgba(7, 7, 16, 0.94) 4%, rgba(7, 7, 16, 0.72) 42%, rgba(7, 7, 16, 0.12) 92%);
}
.mk-hero-glyph {
  position: absolute;
  right: -46px;
  bottom: -54px;
  z-index: 0;
  font-size: 210px;
  line-height: 1;
  color: var(--text-on-scrim);
  opacity: 0.13;
  transition: transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.mk-hero:hover .mk-hero-glyph { transform: scale(1.07) rotate(-5deg); }

.mk-hero-top { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.mk-hero-sm .mk-hero-top { margin-bottom: 8px; }
.mk-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  font-weight: var(--font-weight-bold);
  padding: 5px 12px;
  border-radius: var(--border-radius-full);
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
}
.mk-eyebrow.alt { background: var(--color-secondary); }
.mk-hero-badge {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  padding: 4px 11px;
  border-radius: var(--border-radius-full);
  /* art-ink rule */
  color: var(--text-on-scrim);
  background: rgba(7, 7, 16, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.14);
  text-transform: capitalize;
}
.mk-hero-body { position: relative; z-index: 1; }
.mk-hero-title {
  font-size: var(--font-size-xxl);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.025em;
  line-height: 1.12;
  margin: 0 0 6px;
  color: var(--text-on-scrim); /* art-ink rule */
}

.mk-hero-by {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  margin-bottom: 10px;
  color: var(--text-on-scrim-muted); /* art-ink rule */
}
/* ART-INK RULE: this link sits on the always-dark banner gradient, so its ink is
   pinned to white. A theme token would flip to dark in light/rose and vanish. */
.mk-hero-author {
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  color: var(--text-on-scrim);
  opacity: 0.88;
  transition: opacity var(--transition-fast);
}
.mk-hero-author:hover {
  opacity: 1;
  text-decoration: underline;
}

.mk-hero-desc {
  font-size: var(--font-size-sm);
  line-height: 1.5;
  max-width: 440px;
  margin: 0 0 14px;
  color: var(--text-on-scrim); /* art-ink rule */
}
.mk-hero-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.mk-hero-chips span {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: var(--font-weight-semibold);
  padding: 3px 10px;
  border-radius: var(--border-radius-full);
  /* art-ink rule */
  color: var(--text-on-scrim);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.13);
}
.mk-hero-foot { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.mk-hero-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: none;
  border-radius: var(--border-radius-full);
  cursor: pointer;
  font-family: var(--font-family-primary);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.mk-hero-cta:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(var(--primary-rgb), 0.4); }
.mk-hero-cta.done,
.mk-hero-cta:disabled {
  background: rgba(var(--green-rgb), 0.16);
  color: var(--color-green);
  cursor: default;
  transform: none;
  box-shadow: none;
}
.mk-hero-stats { display: flex; gap: 16px; font-size: var(--font-size-xs); color: var(--text-on-scrim-muted); }
.mk-hero-stats span { display: flex; align-items: center; gap: 5px; }
.mk-hero-stats b { color: var(--text-on-scrim); font-family: var(--font-family-mono); } /* art-ink rule */

/* ─────────────────────── collections ─────────────────────── */
.mk-collections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.mk-collection {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  /* A relative darkening layer follows the active theme instead of selecting
     a fixed navy-family palette value. */
  background: var(--color-darker-1);
  cursor: pointer;
  transition: transform var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
}
.mk-collection:hover {
  transform: translateY(-3px);
  border-color: rgba(var(--primary-rgb), 0.38);
}
.mk-stack { display: flex; }
.mk-stack-chip {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 15px;
  margin-left: -11px;
  border: 1.5px solid var(--color-black-navy);
  transition: transform var(--transition-fast);
}
.mk-stack-chip:first-child { margin-left: 0; }
.mk-collection:hover .mk-stack-chip:first-child { transform: translateX(-3px); }
.mk-collection:hover .mk-stack-chip:last-child { transform: translateX(3px); }
.mk-collection-main { flex: 1; }
.mk-collection-name { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); color: var(--color-text); }
/* SECONDARY-INK RULE (long-form text only):
   --color-text-muted measures 3.1-4.4:1 against a raised card in the ember,
   nord, midnight and hacker palettes — under AA at 12px. Deriving from each
   theme's own --color-text keeps the palette correct while staying legible.
   Used only where there are no emphasised child elements, since opacity
   cannot be reset by a descendant.

   ALPHA IS 0.82, AND THAT NUMBER IS LOAD-BEARING.
   This rule previously said 0.72 / ">=4.8:1 in all eight themes". That was
   true when it was written and silently became false: the light theme later
   moved --color-navy from #131322 to #ffffff, which brightened the raised card
   under this ink and dropped the real measurement to 4.00:1 — below AA 4.5.
   Measured against the live theme files, across all eight palettes on BOTH the
   card and the page fill, 0.77 is the floor and light is the binding surface;
   0.82 measures 5.16:1 worst-case and leaves headroom for future palette work.
   secondaryInkContrast.spec.js now pins this, so it cannot rot again. */
.mk-collection-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text);
  opacity: 0.82;
  line-height: 1.45;
  margin-top: 2px;
}
.mk-collection-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.mk-collection-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
  color: var(--color-text);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.mk-collection:hover .mk-collection-cta {
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
  border-color: var(--color-primary);
}

/* ─────────────────────── toolbar ─────────────────────── */
/* Screen chrome, rendered OUTSIDE .marketplace-main-content (see template).

   It therefore declares NO background: nothing can pass behind it, so the
   scroller's own overflow does the cutting and the theme's canvas — including
   a custom wallpaper — shows through untouched. It needs no z-index either;
   it no longer overlaps anything.

   The bar previously sat inside the scroll flow and relied on painting an
   opaque background to conceal the cards passing under it. That is
   unsatisfiable with a transparent canvas: theme.js sets --color-background to
   `transparent` whenever a custom background is on, so the bar became glass and
   the whole grid read through it. A pinned surface cannot clip what scrolls
   behind it — verified: masking the scroller erases the sticky bar along with
   the content, and even a position:fixed child cannot escape that mask. Moving
   the chrome out of the scroll flow is the only fix that keeps it transparent. */
.mk-toolbar-slot {
  /* Width comes from the flex stretch of .marketplace-content, so this padding
     subtracts rather than overflows (there is no global border-box here).
     It reproduces the scroller's permanent scrollbar
     (overflow-y: scroll !important) — without it the bar centres on an axis
     10px wider than the grid's and sits 5px right of the cards it labels. */
  padding-right: 10px;
}
.mk-toolbar {
  width: 100%;
  max-width: 1048px; /* matches .marketplace-main-content > * */
  margin: 0 auto 8px;
  padding: 12px 0;
  /* Hairline only. The old drop shadow implied content sliding underneath,
     which can no longer happen. */
  box-shadow: 0 1px 0 var(--terminal-border-color);
}
.mk-tb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mk-tb-controls { margin-bottom: 10px; }
.mk-tb-filters { flex-wrap: nowrap; }
.mk-spacer { flex: 1 1 auto; }
.mk-count { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.mk-count b { color: var(--color-text); font-family: var(--font-family-mono); }
.mk-count-note { opacity: 0.65; }
.mk-tb-label {
  flex: 0 0 auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.11em;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-muted);
}
.mk-seg {
  display: flex;
  gap: 2px;
  padding: 3px;
  flex: 0 0 auto;
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
}
.mk-seg button {
  padding: 5px 13px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--border-radius-full);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
  transition: all var(--transition-fast);
}
.mk-seg button:hover { color: var(--color-text); }
.mk-seg button.on {
  background: var(--color-darker-1);
  color: var(--color-text);
  box-shadow: inset 0 0 0 1px var(--terminal-border-color);
}
.mk-sort {
  -webkit-appearance: none;
  appearance: none;
  flex: 0 0 auto;
  padding: 7px 30px 7px 14px;
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background-color: var(--color-darker-2);
  color: var(--color-text);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 15px) 52%, calc(100% - 10px) 52%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  transition: border-color var(--transition-fast);
}
.mk-sort:hover { border-color: var(--terminal-border-color-light); }
.mk-sort:focus { outline: none; border-color: rgba(var(--primary-rgb), 0.45); }
.mk-sort option { background: var(--color-dark-navy); color: var(--color-text); }

.mk-chip-rail { position: relative; flex: 1 1 0; min-width: 0; }
/* mask-image clips to the PADDING box — keep vertical inset or the pills get shaved */
.mk-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding: 5px 4px 5px 0;
  margin: -5px 0;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 48px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 48px), transparent);
}
.mk-chips::-webkit-scrollbar { display: none; }
.mk-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 7px 14px;
  white-space: nowrap;
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-1);
  color: var(--color-text-muted);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.mk-chip:hover { color: var(--color-text); border-color: var(--terminal-border-color-light); }
.mk-chip.on {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.45);
  background: rgba(var(--primary-rgb), 0.1);
}
.mk-chip-n { font-family: var(--font-family-mono); font-size: 10px; opacity: 0.6; }
/* sibling of the rail, never overlapping it */
.mk-rail-next {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  cursor: pointer;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
  color: var(--color-text-muted);
  transition: all var(--transition-fast);
}
.mk-rail-next:hover { color: var(--color-text); border-color: var(--terminal-border-color-light); }
.mk-rail-next.hide { visibility: hidden; }

/* ─────────────────────── the flat grid ─────────────────────── */
/* ONE grid over every item. Category no longer influences layout, so a
   category holding a single item can never produce a one-card row. */
.mk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  width: 100%;
  animation: mkGridIn 240ms ease-out;
}
@keyframes mkGridIn { from { opacity: 0; } to { opacity: 1; } }

.mk-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  /* see .mk-collection: --color-navy is the only fill that stays "raised"
     in all eight themes */
  background: var(--color-navy);
  cursor: pointer;
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color var(--transition-fast), box-shadow var(--transition-fast);
  /* Only the TRANSFORM is staggered. Opacity fades once on .mk-grid so a
     stalled animation clock can never leave a card permanently invisible. */
  animation: mkCardRise 300ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  animation-delay: calc(var(--i, 0) * 14ms);
}
@keyframes mkCardRise { from { transform: translateY(9px); } to { transform: none; } }
.mk-card:hover {
  transform: translateY(-4px);
  border-color: rgba(var(--primary-rgb), 0.4);
  box-shadow: 0 16px 40px -14px rgba(0, 0, 0, 0.55);
}
.mk-card.installed { border-color: rgba(var(--green-rgb), 0.32); }
.mk-card.selected { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary); }

.mk-card-art { position: relative; height: 116px; flex: 0 0 auto; overflow: hidden; }
.mk-card-glyph {
  position: absolute;
  right: -12px;
  bottom: -22px;
  font-size: 118px;
  line-height: 1;
  color: var(--text-on-scrim); /* art-ink rule */
  opacity: 0.17;
  transition: transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity var(--transition-fast);
}
.mk-card:hover .mk-card-glyph { transform: scale(1.13) rotate(-6deg); opacity: 0.23; }
.mk-art-tags { position: absolute; top: 11px; left: 12px; right: 12px; display: flex; align-items: center; gap: 6px; }
.mk-tag {
  font-size: 9.5px;
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.09em;
  padding: 4px 9px;
  border-radius: var(--border-radius-full);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* art-ink rule: fixed ink on the always-dark gradient */
  color: var(--text-on-scrim);
  background: rgba(7, 7, 16, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.13);
}
/* --color-red (#fe4e4e) puts white at only 3.87:1 at this size; this darkened
   red measures 5.6:1 while still reading as the same alert red. */
.mk-tag.hot { background: rgba(198, 40, 40, 0.95); border-color: transparent; }
.mk-tag.new { background: rgba(18, 224, 255, 0.9); border-color: transparent; color: #06131a; }
.mk-tag.rank { background: rgba(255, 215, 0, 0.92); border-color: transparent; color: #2a2000; }
.mk-tag.price { margin-left: auto; font-family: var(--font-family-mono); font-size: 10.5px; letter-spacing: 0.02em; }
/* The FREE label is the one tag painted in an accent rather than --text-on-scrim,
   and it sits on a generated gradient whose hue varies per item. Composited
   against the brightest stop the tool hue can produce (hsl(59 62% 52%)), the
   shared 0.55 scrim left it at 4.23:1 — under AA. 0.72 measures 7.08:1 at the
   worst hue of all four asset types. Kept identical in MarketplaceShelf.vue. */
.mk-tag.price.free { color: var(--color-green); background: rgba(7, 7, 16, 0.72); border-color: rgba(25, 239, 131, 0.35); }

.mk-card-icon {
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
.mk-card:hover .mk-card-icon { transform: translateY(-3px) scale(1.05); }

/* padding-top must clear the overlapping icon tile (top 90 + height 52 = 142
   against an art panel 116 tall, so 26px is the minimum) plus breathing room */
.mk-card-body { padding: 34px 16px 0; flex: 1 1 auto; display: flex; flex-direction: column; }
.mk-card-title {
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
.mk-card-by {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 9px;
  min-height: 18px;
}
.mk-card-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}
/* Button reset — the author is a link to the publisher profile.
   It does NOT inherit --color-text-muted like the surrounding byline: that
   measures 3.1-4.4:1 on a card in ember/nord/midnight/hacker, which is under
   the AA floor and unacceptable for something interactive. Derived from the
   theme's own ink instead (SECONDARY-INK RULE). */
.mk-card-author.is-link {
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  color: var(--color-text);
  opacity: 0.82;
  transition: color var(--transition-fast), opacity var(--transition-fast);
}
.mk-card-author.is-link:hover {
  opacity: 1;
  color: var(--color-secondary);
  text-decoration: underline;
}

.mk-card-desc {
  font-size: var(--font-size-xs);
  /* see SECONDARY-INK RULE above */
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
.mk-card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-bottom: 12px;
  font-size: var(--font-size-xs);
  /* SECONDARY-INK RULE. --color-text-muted here, further dimmed by a nested
     opacity on .mk-m-count, measured 2.19:1 in ember — less than half the AA
     floor. Deriving from the theme's own ink keeps the palette and clears AA
     on both the card and the darker category chip in all eight themes. */
  color: var(--color-text);
  opacity: 0.82;
}
.mk-m { display: flex; align-items: center; gap: 5px; }
.mk-m b { color: var(--color-text); font-weight: var(--font-weight-medium); }
.mk-m-star i { color: var(--color-yellow); }
/* kept only mildly secondary — opacity here multiplies with the parent's */
.mk-m-count {
  opacity: 0.9;
}
.mk-cat {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: var(--border-radius-sm);
  background: var(--color-darker-2);
  font-size: 10px;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mk-card-foot { display: flex; gap: 8px; padding: 0 16px 16px; }
.mk-inst {
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
.mk-card:hover .mk-inst:not(:disabled) {
  background: var(--color-primary);
  /* --on-fill-accent, not --color-black-navy: six themes alias that name to their
     own canvas, so it is near-WHITE in light/rose. See _semantic.css. */
  color: var(--on-fill-accent);
  border-color: var(--color-primary);
  box-shadow: 0 6px 18px rgba(var(--primary-rgb), 0.3);
}
.mk-inst.done,
.mk-card:hover .mk-inst.done {
  background: rgba(var(--green-rgb), 0.14);
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  box-shadow: none;
  cursor: default;
}
.mk-inst.busy { opacity: 0.75; cursor: progress; }
.mk-ghost {
  flex: 0 0 auto;
  width: 38px;
  display: grid;
  place-items: center;
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.mk-ghost:hover {
  color: var(--color-text);
  border-color: var(--terminal-border-color-light);
}
/* the secondary action is icon-only in the grid, but grows a label whenever it
   stops being a small square — a full-width icon-only button reads as a bug */
.mk-glabel {
  display: none;
}
.mk-m-unrated {
  opacity: 0.7;
}

.mk-ribbon {
  position: absolute;
  top: 11px;
  right: 12px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--border-radius-full);
  font-size: 9.5px;
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: rgba(25, 239, 131, 0.92);
  color: #05140c; /* sits on a fixed green chip, not on a theme surface */
}

/* ─────────────────────── skeleton + empty ─────────────────────── */

.mk-sk {
  height: 268px;
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-navy);
  position: relative;
  overflow: hidden;
}
.mk-sk::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, var(--color-lighter-0), transparent);
  animation: mkShimmer 1.35s infinite;
}
@keyframes mkShimmer { 100% { transform: translateX(100%); } }

.mk-empty { grid-column: 1 / -1; text-align: center; padding: 48px 24px; }
.mk-empty-ico {
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
.mk-empty h3 { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 0 0 6px; color: var(--color-text); }
.mk-empty p { font-size: var(--font-size-sm); color: var(--color-text-muted); margin: 0 0 16px; }
.mk-empty-cta {
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
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.mk-empty-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(var(--primary-rgb), 0.35); }

/* ═══════════════════════ PUBLISHER PROFILE ═══════════════════════ */
.mk-profile {
  margin-bottom: var(--spacing-lg);
}
.mk-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  margin-bottom: var(--spacing-md);
  border-radius: var(--border-radius-full);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-2);
  /* SECONDARY-INK RULE: --color-text-muted lands at 3.4-4.2:1 here in
     ember/nord/midnight/rose, under AA for an interactive control. */
  color: var(--color-text);
  opacity: 0.78;
  font-family: var(--font-family-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.mk-back:hover {
  opacity: 1;
  border-color: var(--terminal-border-color-light);
}

.mk-prof-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex-wrap: wrap;
  margin-bottom: var(--spacing-md);
}
/* generated identity mark — no avatar upload infrastructure needed for v1 */
.mk-prof-avatar {
  width: 72px;
  height: 72px;
  flex: 0 0 auto;
  border-radius: 20px;
  display: grid;
  place-items: center;
  font-size: 26px;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
}
.mk-prof-id {
  min-width: 0;
  flex: 1 1 auto;
}
.mk-prof-name {
  font-size: var(--font-size-xxl);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.025em;
  line-height: 1.15;
  margin: 0 0 5px;
  color: var(--color-text);
}
.mk-prof-sub {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: var(--font-size-xs);
  /* SECONDARY-INK RULE: derived from the theme's own ink so it clears AA on
     every surface (--color-text-muted lands ~3.1-4.4:1 in ember/nord/midnight).
     0.68 did NOT clear it — 3.64:1 light, 4.42:1 nord. 0.82 is the house alpha. */
  color: var(--color-text);
  opacity: 0.82;
}
.mk-prof-sub span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mk-prof-you {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 5px 12px;
  border-radius: var(--border-radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-secondary);
  border: 1px solid rgba(var(--blue-rgb), 0.35);
  background: rgba(var(--blue-rgb), 0.1);
}

.mk-prof-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  background: var(--terminal-border-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
}
.mk-prof-stat {
  flex: 1 1 160px;
  min-width: 0;
  padding: 13px 16px;
  background: var(--color-background);
}
.mk-prof-stat .v {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--color-text);
}
.mk-prof-stat .v i {
  color: var(--color-yellow);
  font-size: 15px;
}
.mk-prof-stat .k {
  margin-top: 3px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text);
  opacity: 0.82; /* was 0.68 -> 3.64:1 in light; see SECONDARY-INK RULE */
}

.mk-prof-rel {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: var(--spacing-md);
  padding: 12px 16px;
  border-radius: var(--border-radius-lg);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.07);
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.mk-prof-rel i {
  color: var(--color-green);
}
.mk-prof-rel b {
  font-family: var(--font-family-mono);
}

/* auto-FIT, not auto-fill: empty tracks collapse, so a publisher with two items
   gets two half-width cards instead of two cards and a hole. */
.mk-grid-fit {
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
/* Most publishers ship exactly one item. Stretched full-width that becomes a
   1100px poster, so a single listing lays out horizontally instead — it then
   reads as a deliberate feature rather than a grid with a hole in it. */
.mk-grid-fit.solo .mk-card {
  flex-direction: row;
  align-items: stretch;
}
.mk-grid-fit.solo .mk-card-art {
  width: 250px;
  height: auto;
  flex: 0 0 auto;
}
.mk-grid-fit.solo .mk-card-icon {
  top: auto;
  bottom: 14px;
}
.mk-grid-fit.solo .mk-card-body {
  padding: 18px var(--spacing-md) 0;
  justify-content: center;
}
.mk-grid-fit.solo .mk-card-desc {
  -webkit-line-clamp: 3;
  min-height: 0;
}
.mk-grid-fit.solo .mk-card-meta .mk-cat {
  margin-left: 0;
}
.mk-grid-fit.solo .mk-card-foot {
  flex-direction: column;
  justify-content: center;
  width: 200px;
  flex: 0 0 auto;
  padding: 18px var(--spacing-md);
}
.mk-grid-fit.solo .mk-inst {
  width: 100%;
}
.mk-grid-fit.solo .mk-ghost {
  width: 100%;
  height: 38px;
  gap: 8px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  display: flex;
  align-items: center;
  justify-content: center;
}
.mk-grid-fit.solo .mk-ghost .mk-glabel {
  display: inline;
}
@media (max-width: 820px) {
  .mk-grid-fit.solo .mk-card {
    flex-direction: column;
  }
  .mk-grid-fit.solo .mk-card-art {
    width: auto;
    height: 112px;
  }
  .mk-grid-fit.solo .mk-card-foot {
    width: auto;
    flex-direction: row;
  }
}

/* ──────────────── light-theme ink correction (AA) ────────────────
   In the light and rose themes --color-primary is a mid-tone, so 10-12px text
   on it measures ~4.0:1 — under the AA floor for small text. These are AA-
   corrected derivatives of each theme's own primary, applied ONLY to the small
   chips that failed. The token itself is untouched, so nothing else in the app
   shifts, and the rules are theme-scoped so they cannot leak into dark themes.
   (A bare `body {}` rule can't be used here: scoped CSS would compile it to
   `body[data-v-x]`, which never matches.) */
body:not(.dark) .mk-eyebrow,
body:not(.dark) .mk-empty-cta,
body:not(.dark) .mk-hero-cta:not(.done):not(:disabled),
body:not(.dark) .mk-card:hover .mk-inst:not(.done):not(:disabled),
body:not(.dark) .mk-collection:hover .mk-collection-cta {
  background: #a82a66;
  border-color: #a82a66;
  color: #fff;
}
body:not(.dark) .mk-chip.on {
  color: #a82a66;
  border-color: rgba(168, 42, 102, 0.45);
}
/* On a light page a white card on near-white needs a real (if quiet) shadow;
   in the dark themes the border alone already separates it. */
body:not(.dark) .mk-card,
body:not(.dark) .mk-collection {
  box-shadow: 0 1px 2px rgba(60, 60, 90, 0.09);
}
body:not(.dark) .mk-card:hover,
body:not(.dark) .mk-collection:hover {
  box-shadow: 0 12px 28px -12px rgba(60, 60, 90, 0.3);
}
body.rose .mk-eyebrow,
body.rose .mk-empty-cta,
body.rose .mk-hero-cta:not(.done):not(:disabled),
body.rose .mk-card:hover .mk-inst:not(.done):not(:disabled),
body.rose .mk-collection:hover .mk-collection-cta {
  background: #9c3459;
  border-color: #9c3459;
  color: #fff;
}
body.rose .mk-chip.on {
  color: #9c3459;
  border-color: rgba(156, 52, 89, 0.45);
}

/* ─────────────────────── responsive ─────────────────────── */
@media (max-width: 1080px) {
  .mk-spotlight { grid-template-columns: 1fr; grid-template-rows: auto; }
  .mk-hero:first-child { grid-row: auto; }
}
@media (max-width: 720px) {
  .mk-grid { grid-template-columns: 1fr; }
  .mk-tb-controls { gap: 6px; }
  .mk-pulse-cta { margin-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .mk-card,
  .mk-grid,
  .mk-beacon,
  .mk-sk::after { animation: none; }
  .mk-card:hover,
  .mk-hero:hover { transform: none; }
}

</style>
