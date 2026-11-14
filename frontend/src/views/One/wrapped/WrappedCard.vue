<template>
  <section
    class="wr-card"
    :class="[`wr-${card.id}`, { 'is-active': active }]"
    :aria-hidden="active ? 'false' : 'true'"
    :inert="active ? null : ''"
    :aria-label="card.label"
    :data-card="card.id"
  >
    <!-- The year, opened: the mark breathing over a field of dots. -->
    <template v-if="card.id === 'intro'">
      <svg class="wr-stars" viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <circle v-for="(s, i) in card.stars" :key="i" :cx="s.cx" :cy="s.cy" :r="s.r" :style="{ '--o': s.o, '--delay': Math.round(s.delay * 1000) }" />
      </svg>
      <svg class="wr-intro-mark wr-rv wr-pop" style="--delay: 0" viewBox="0 0 37 36" aria-hidden="true">
        <circle v-for="([cx, cy], k) in MARK_DOTS" :key="k" :cx="cx" :cy="cy" r="4.5" :style="{ '--i': k }" />
      </svg>
      <div class="wr-grow"></div>
      <p class="wr-kicker wr-rv" style="--delay: 250">AGNT · Year in review</p>
      <h2 class="wr-display wr-rv" style="--delay: 380">{{ card.year }},<br /><span class="wr-accent">wrapped.</span></h2>
      <p class="wr-lead wr-rv" style="--delay: 560">Annie kept count. Here’s what you and your agents did this year.</p>
      <p class="wr-fine wr-rv" style="--delay: 720">{{ card.from }} – {{ card.through }}, {{ card.year }}</p>
    </template>

    <!-- Days in a row, and a dot for every active day. -->
    <template v-else-if="card.id === 'streak'">
      <span class="wr-wm wr-wm-br" aria-hidden="true"></span>
      <p class="wr-kicker wr-rv" style="--delay: 0">Your streak</p>
      <p class="wr-mega wr-rv wr-pop" style="--delay: 100"><WrappedCount :value="card.length" :active="active" :still="still" /></p>
      <p class="wr-title wr-rv" style="--delay: 240">days in a row.</p>
      <p class="wr-body wr-rv" style="--delay: 380">{{ card.sentence }}</p>
      <div class="wr-grow"></div>
      <svg class="wr-cal wr-rv" style="--delay: 420" :viewBox="`0 0 ${card.calendar.width} ${card.calendar.height}`" aria-hidden="true">
        <circle v-for="d in card.calendar.dots" :key="d.k" class="wr-day" :cx="d.cx" :cy="d.cy" r="3.6" :style="{ '--o': d.o, '--i': d.k }" />
        <circle v-if="card.calendar.ring" class="wr-ring" :cx="card.calendar.ring.cx" :cy="card.calendar.ring.cy" r="6.4" />
        <text v-for="l in card.calendar.labels" :key="l.x" :x="l.x" y="81">{{ l.text }}</text>
      </svg>
      <p class="wr-callout wr-rv" style="--delay: 1500"><span class="wr-ring-key" aria-hidden="true"></span><span><b>{{ card.busiest.date }}</b> · {{ card.busiest.runs }} runs, your busiest day</span></p>
      <p class="wr-fine wr-rv" style="--delay: 1600">{{ card.activeLine }}</p>
    </template>

    <!-- Runs, month by month. -->
    <template v-else-if="card.id === 'volume'">
      <p class="wr-kicker wr-rv" style="--delay: 0">Runs</p>
      <p class="wr-huge wr-rv wr-pop" style="--delay: 100"><WrappedCount :value="card.runs" :active="active" :still="still" /></p>
      <p class="wr-lead wr-rv" style="--delay: 240">workflow and agent runs<template v-if="card.calls">, and <b class="wr-accent">{{ card.calls }}</b> model calls across <b class="wr-accent">{{ card.models }}</b> models and <b class="wr-accent">{{ card.providers }}</b> providers</template>.</p>
      <div class="wr-grow"></div>
      <svg class="wr-mdots wr-rv" style="--delay: 400" :viewBox="`0 0 ${card.chart.width} ${card.chart.height}`" aria-hidden="true">
        <circle v-for="(d, i) in card.chart.dots" :key="i" class="wr-md" :class="d.kind ? `is-${d.kind}` : ''" :cx="d.cx" :cy="d.cy" r="3.8" :style="{ '--i': d.k }" />
        <text v-for="(l, i) in card.chart.labels" :key="`m${i}`" class="wr-ml" :x="l.x" :y="card.chart.height - 2" text-anchor="middle">{{ l.text }}</text>
        <text v-if="card.chart.peakLabel" class="wr-mv" :x="card.chart.peakLabel.x" :y="card.chart.peakLabel.y" text-anchor="middle">{{ card.chart.peakLabel.text }}</text>
      </svg>
      <p class="wr-body wr-rv" style="--delay: 1100"><b>{{ card.peak.name }}</b> alone: {{ card.peak.runs }} runs<template v-if="card.growth"> — {{ card.growth }}</template>.</p>
      <p class="wr-fine wr-rv" style="--delay: 1200">1 dot = {{ card.perDot }} runs<template v-if="card.partialMonth"> · {{ card.partialMonth }} so far</template><template v-if="card.calls && card.ledgerSince"> · model calls since {{ card.ledgerSince }}</template></p>
    </template>

    <!-- Every token, and what the agents wrote as a shelf of books. -->
    <template v-else-if="card.id === 'words'">
      <span class="wr-wm wr-wm-tr" aria-hidden="true"></span>
      <p class="wr-kicker wr-rv" style="--delay: 0">Tokens</p>
      <p class="wr-mega is-wide wr-rv wr-pop" style="--delay: 100">{{ card.tokens }}</p>
      <p class="wr-title wr-rv" style="--delay: 240">tokens, read and written.</p>
      <p v-if="card.written" class="wr-lead wr-rv" style="--delay: 360">Your agents wrote <b>{{ card.written }}</b> of them: about <b>{{ card.books }}</b> of <i>War and Peace</i>.</p>
      <div class="wr-grow"></div>
      <svg v-if="card.shelf" class="wr-shelf wr-rv" style="--delay: 420" :viewBox="`-4 0 ${card.shelf.width} ${card.shelf.height}`" aria-hidden="true">
        <rect v-for="s in card.shelf.spines" :key="s.k" class="wr-spine" :x="s.x" :y="s.y" :width="s.w" :height="s.h" rx="1.3" :style="{ '--i': s.k }" />
        <rect v-for="(s, i) in card.shelf.shelves" :key="`s${i}`" class="wr-board" x="-4" :y="s.y" :width="s.width" height="2.2" rx="1.1" />
      </svg>
      <p v-if="card.cachePct !== null" class="wr-body wr-rv" style="--delay: 1300">{{ card.cachePct }}% of what they read came straight from cache.</p>
      <p v-if="card.tokensSince || card.books" class="wr-fine wr-rv" style="--delay: 1400">
        <template v-if="card.tokensSince">Recorded from {{ card.tokensSince }}.</template>
        <template v-if="card.books"> ≈ {{ card.wordsPerToken }} words per token · War and Peace ≈ {{ card.novelWords }} words<template v-if="card.perSpine"> · 1 spine = {{ card.perSpine }} copies</template></template>
      </p>
    </template>

    <!-- The model used most, and the four after it. -->
    <template v-else-if="card.id === 'model'">
      <p class="wr-kicker wr-rv" style="--delay: 0">Your #1 model</p>
      <p class="wr-rank1 wr-rv wr-pop" style="--delay: 100" aria-hidden="true">#1</p>
      <p class="wr-model-name wr-rv" style="--delay: 240">{{ card.name }}</p>
      <p class="wr-lead wr-rv" style="--delay: 360"><b>{{ card.calls }}</b> calls. {{ card.share }} of all your model calls.</p>
      <div class="wr-grow"></div>
      <ol class="wr-ranks">
        <li v-for="(m, i) in card.rest" :key="m.name" class="wr-rv" :style="{ '--delay': 560 + i * 110 }">
          <span class="wr-rk">{{ m.rank }}</span><span class="wr-nm">{{ m.name }}</span><span class="wr-ct">{{ m.calls }}</span>
          <span class="wr-track"><i :style="{ '--w': m.ratio, '--delay': 800 + i * 110 }"></i></span>
        </li>
      </ol>
      <p class="wr-fine wr-rv" style="--delay: 1100">{{ card.modelCount }} models from {{ card.providerCount }} providers {{ card.ledgerSince ? `since ${card.ledgerSince}` : 'this year' }}</p>
    </template>

    <!-- The goals that ran most. -->
    <template v-else-if="card.id === 'goals'">
      <span class="wr-wm wr-wm-bl" aria-hidden="true"></span>
      <p class="wr-kicker wr-rv" style="--delay: 0">On repeat</p>
      <h2 class="wr-title is-big wr-rv" style="--delay: 100">Your most-run goals</h2>
      <ol class="wr-goal-list">
        <li v-for="(g, i) in card.top" :key="g.rank" class="wr-rv" :style="{ '--delay': 320 + i * 150 }">
          <span class="wr-gn" aria-hidden="true">{{ g.rank }}</span>
          <div><p class="wr-gt">{{ g.title }}</p><p class="wr-gm">{{ g.calls }} model calls</p></div>
        </li>
      </ol>
      <div class="wr-grow"></div>
      <p v-if="card.passed" class="wr-body wr-rv" style="--delay: 900"><b>{{ card.passed }}</b> goals you set this year passed evaluation.</p>
    </template>

    <!-- What was built. -->
    <template v-else-if="card.id === 'built'">
      <p class="wr-kicker wr-rv" style="--delay: 0">This year you built</p>
      <div class="wr-built-grid">
        <div v-for="(c, i) in card.cells" :key="c.kind" class="wr-cell wr-rv" :class="{ 'is-hero wr-pop': i === 0 }" :style="{ '--delay': i === 0 ? 100 : 180 + i * 90 }">
          <span class="wr-bn"><WrappedCount :value="c.count" :active="active" :still="still" /></span><span class="wr-bl">{{ c.kind }}</span>
        </div>
      </div>
      <div class="wr-grow"></div>
      <p v-if="card.peak" class="wr-body wr-rv" style="--delay: 800">Your biggest build month was <b>{{ card.peak.month }}</b>: {{ card.peak.parts }}.</p>
    </template>

    <!-- The money, on the ledger's own axes. -->
    <template v-else-if="card.id === 'money'">
      <span class="wr-wm wr-wm-br" aria-hidden="true"></span>
      <p class="wr-kicker wr-rv" style="--delay: 0">{{ card.notional ? 'At API list prices' : 'Metered spend' }}</p>
      <p class="wr-huge wr-rv wr-pop" style="--delay: 100"><WrappedCount :value="card.amount" prefix="$" :active="active" :still="still" /></p>
      <p class="wr-lead wr-rv" style="--delay: 240">{{ card.notional ? 'is what this year’s subscription work would have cost on metered APIs.' : 'is what you spent on metered APIs this year.' }}</p>
      <div class="wr-grow"></div>
      <template v-if="card.saved">
        <div class="wr-strike wr-rv" style="--delay: 500"><span class="wr-was">{{ card.uncached }}</span><span class="wr-was-label">without caching</span></div>
        <p class="wr-saved wr-rv" style="--delay: 900">Caching saved <span class="wr-hl">{{ card.saved }}</span>.</p>
      </template>
      <p class="wr-fine wr-rv" style="--delay: 1050">
        Estimates from the AGNT ledger<template v-if="card.ledgerSince">, from {{ card.ledgerSince }}</template>.<template v-if="card.notional"> Metered spend: {{ card.charged }}</template><template v-if="card.unpriced"> · {{ card.unpriced }} calls unpriced</template>.
      </p>
    </template>

    <!-- Getting better on their own. -->
    <template v-else-if="card.id === 'learning'">
      <p class="wr-kicker wr-rv" style="--delay: 0">Getting better on their own</p>
      <p class="wr-mega wr-accent wr-rv wr-pop" style="--delay: 100"><WrappedCount :value="card.applied" :active="active" :still="still" /></p>
      <p class="wr-title wr-rv" style="--delay: 240">improvements applied.</p>
      <p class="wr-body wr-rv" style="--delay: 380">Your agents learned from their own runs: {{ card.applied.toLocaleString('en-US') }} changes went in, {{ card.rejected }} were turned down.</p>
      <div class="wr-grow"></div>
      <svg v-if="card.funnel" class="wr-funnel wr-rv" style="--delay: 420" :viewBox="`0 0 ${card.funnel.width} ${card.funnel.height}`" aria-hidden="true">
        <circle v-for="(d, i) in card.funnel.dots" :key="i" :class="`is-${d.kind}`" :cx="d.cx" :cy="d.cy" r="1.45" :style="{ '--i': d.k }" />
        <template v-for="(l, i) in card.funnel.labels" :key="`f${i}`">
          <text class="wr-fl" :x="l.x" :y="card.funnel.base + 10">{{ l.top }}</text>
          <text class="wr-fl2" :x="l.x" :y="card.funnel.base + 17">{{ l.sub }}</text>
        </template>
        <path v-for="(a, i) in card.funnel.arrows" :key="`a${i}`" class="wr-farrow" :d="`M${a.x} ${a.y} l3.5 3.5 l-3.5 3.5`" />
      </svg>
      <p v-if="card.memories" class="wr-fine wr-rv" style="--delay: 1900">Plus {{ card.memories }} memories saved.</p>
    </template>

    <!-- The mark becomes a conductor and five players. -->
    <template v-else-if="card.id === 'persona'">
      <p class="wr-kicker wr-rv" style="--delay: 0">Your AGNT type</p>
      <svg class="wr-conductor wr-rv" style="--delay: 100" viewBox="-1 -1 39 38" aria-hidden="true">
        <line class="wr-baton" x1="18.77" y1="31.5" x2="11.5" y2="24.8" />
        <g v-for="d in card.dots" :key="d.k" class="wr-cd" :style="{ '--x': `${d.tx}px`, '--y': `${d.ty}px` }">
          <circle :class="d.lead ? 'wr-lead-dot' : 'wr-play-dot'" :cx="d.cx" :cy="d.cy" :r="d.lead ? 5 : 4.5" :style="{ '--i': d.k }" />
        </g>
      </svg>
      <h2 class="wr-persona-name wr-rv wr-pop" style="--delay: 300">The<br /><span>{{ card.name }}</span></h2>
      <p class="wr-body wr-rv" style="--delay: 460">{{ card.line }}</p>
      <div class="wr-grow"></div>
      <div class="wr-badges">
        <span v-for="(b, i) in card.badges" :key="b.key" class="wr-rv" :style="{ '--delay': 700 + i * 100 }"><em>{{ b.key }}</em>{{ b.value }}</span>
      </div>
    </template>

    <!-- The card people share. -->
    <template v-else-if="card.id === 'summary'">
      <div class="wr-poster wr-rv wr-pop" style="--delay: 0">
        <div class="wr-p-head">
          <svg viewBox="0 0 37 36" aria-hidden="true"><circle v-for="([cx, cy], k) in MARK_DOTS" :key="k" :cx="cx" :cy="cy" r="4.5" /></svg>{{ card.year }} Wrapped
        </div>
        <p class="wr-p-title">My {{ card.year }}<br />in AGNT</p>
        <div class="wr-p-grid">
          <div v-for="f in pairs[0]" :key="f.label"><b>{{ f.value }}</b><span>{{ f.label }}</span></div>
          <div v-if="card.topModel" class="is-wide"><span>#1 model</span><b class="is-mono">{{ card.topModel }}</b></div>
          <div v-if="card.topGoal" class="is-wide"><span>Most-run goal</span><b class="is-small">{{ card.topGoal }}</b></div>
          <div v-for="f in pairs[1]" :key="f.label"><b>{{ f.value }}</b><span>{{ f.label }}</span></div>
        </div>
        <div class="wr-p-foot"><span>{{ card.persona ? `The ${card.persona}` : '' }}</span><span>agnt.gg</span></div>
      </div>
      <div class="wr-actions wr-rv" style="--delay: 250">
        <button type="button" class="wr-cta" data-action="share" @click="emit('share')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="SHARE_ICON" /></svg>Share your year
        </button>
        <button type="button" class="wr-textbtn" data-action="replay" @click="emit('replay')">Watch again</button>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import WrappedCount from './WrappedCount.vue';
import { MARK_DOTS } from './wrappedModel.js';
import { posterPairs } from './wrappedShare.js';

const props = defineProps({
  card: { type: Object, required: true },
  active: { type: Boolean, default: false },
  still: { type: Boolean, default: false },
});
const emit = defineEmits(['share', 'replay']);

// The summary's figures, laid out as the shared image lays them out.
const pairs = computed(() => (props.card.id === 'summary' ? posterPairs(props.card) : [[], []]));

const SHARE_ICON = 'M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6';
</script>
