<template>
  <div class="referral-card milestones-card">
    <div class="card-header">
      <div class="header-left">
        <div class="icon-container"><i class="fas fa-gift" aria-hidden="true"></i></div>
        <div>
          <h3 class="card-title">Give a month, get a month</h3>
          <p class="card-subtitle">Friends you invite get their first month of AGNT Cloud free. When they start paying, you're rewarded too.</p>
        </div>
      </div>
      <div class="header-right" v-if="program">
        <div class="balance-display">
          <span class="balance-label">Paying friends</span>
          <span class="balance-value">{{ program.paidFriends }}</span>
        </div>
      </div>
    </div>

    <p v-if="error" class="ms-muted">{{ error }}</p>
    <p v-else-if="!program" class="ms-muted"><i class="fas fa-spinner fa-spin"></i> Loading your rewards…</p>
    <template v-else>
      <div class="ms-reward">
        <template v-if="program.partner">
          <strong>You're a partner.</strong> You earn {{ percent }}% of every payment from the customers you refer, for their first
          {{ program.program.commissionMonths }} months, paid to your Stripe account.
        </template>
        <template v-else>
          <strong>{{ program.credits.granted }} free {{ program.credits.granted === 1 ? 'month' : 'months' }} earned.</strong>
          Each friend who becomes a paying customer adds a month of Personal Cloud to your account
          ({{ program.credits.remainingThisYear }} more available this year).
        </template>
      </div>

      <div class="ms-progress" role="progressbar" :aria-valuenow="program.paidFriends" aria-valuemin="0" :aria-valuemax="progressMax">
        <div class="ms-bar" :style="{ width: progressPct + '%' }"></div>
      </div>
      <p class="ms-next" v-if="program.next">
        <strong>{{ program.next.remaining }}</strong> more paying {{ program.next.remaining === 1 ? 'friend' : 'friends' }} to unlock
        <strong>{{ label(program.next) }}</strong>
      </p>
      <p class="ms-next" v-else><strong>Every milestone unlocked.</strong> Thank you.</p>

      <ul class="ms-ladder">
        <li v-for="m in program.milestones" :key="m.at" :class="{ done: m.grantedAt }">
          <span class="ms-at">{{ m.at }}</span>
          <span class="ms-label">{{ label(m) }}</span>
          <span class="ms-state"><i :class="m.grantedAt ? 'fas fa-check' : 'fas fa-lock'" aria-hidden="true"></i> {{ m.grantedAt ? 'Unlocked' : 'Locked' }}</span>
        </li>
      </ul>
      <p v-if="program.alwaysOnUntil" class="ms-muted">Always-On active on your cloud instance until {{ formatDate(program.alwaysOnUntil) }}.</p>

      <div class="ms-actions">
        <button v-if="!program.partner" class="ms-button" @click="openExternal('https://agnt.gg/partners')"><i class="fas fa-handshake" aria-hidden="true"></i> Earn 30% as a partner</button>
        <button class="ms-button alt" @click="openExternal('https://agnt.gg/referrals/leaderboard')"><i class="fas fa-trophy" aria-hidden="true"></i> Monthly leaderboard</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { milestoneLabel } from '@/services/referral/referralProgram.js';

const store = useStore();
const error = ref('');
const program = computed(() => store.state.userStats.referralMilestones || null);
const percent = computed(() => Math.round((program.value?.program?.commissionRate || 0.3) * 100));
const progressMax = computed(() => program.value?.next?.at || program.value?.milestones?.at(-1)?.at || 25);
const progressPct = computed(() => Math.min(100, Math.round(((program.value?.paidFriends || 0) / progressMax.value) * 100)));
const label = milestoneLabel;
const formatDate = (value) => new Date(value).toLocaleDateString();

function openExternal(url) {
  if (window.electron?.openExternalUrl) window.electron.openExternalUrl(url);
  else window.open(url, '_blank', 'noopener');
}

onMounted(async () => {
  const result = await store.dispatch('userStats/fetchReferralMilestones').catch(() => null);
  if (!result && !program.value) error.value = 'Your rewards could not be loaded right now.';
});
</script>

<style scoped>
.ms-reward { margin: 4px 0 14px; font-size: 14px; line-height: 1.55; color: var(--color-text); }
.ms-progress { height: 8px; border-radius: 99px; background: var(--color-darker-0); border: 1px solid var(--terminal-border-color); overflow: hidden; }
.ms-bar { height: 100%; background: var(--color-primary); transition: width 0.4s ease; }
.ms-next { margin: 10px 0 14px; font-size: 13px; color: var(--color-text-muted); }
.ms-ladder { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ms-ladder li { display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--terminal-border-color); border-radius: 8px; font-size: 13px; }
.ms-ladder li.done { border-color: rgba(var(--primary-rgb), 0.5); }
.ms-at { font-weight: 800; font-size: 18px; color: var(--color-primary); }
.ms-state { color: var(--color-text-muted); white-space: nowrap; }
.ms-ladder li.done .ms-state { color: var(--color-green); }
.ms-muted { font-size: 13px; color: var(--color-text-muted); margin: 10px 0 0; }
.ms-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.ms-button { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--color-primary); background: var(--color-primary); color: var(--color-darker-0); font-weight: 700; cursor: pointer; font-size: 13px; }
.ms-button.alt { background: transparent; color: var(--color-text); border-color: var(--terminal-border-color); }
</style>
