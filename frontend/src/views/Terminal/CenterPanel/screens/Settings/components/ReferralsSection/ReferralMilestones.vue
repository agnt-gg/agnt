<template>
  <div class="referral-card milestones-card">
    <div class="card-header">
      <div class="header-left">
        <div class="icon-container"><i class="fas fa-gift" aria-hidden="true"></i></div>
        <div>
          <h3 class="card-title">Give 30 days, get a month</h3>
          <p class="card-subtitle">Friends you invite get 30 days of AGNT Pro free on their own computer. When they start paying, you're rewarded too.</p>
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
          Each friend who becomes a paying customer adds a month of AGNT Pro ($29) to your account as credit
          ({{ program.credits.remainingThisYear }} more available this year).
        </template>
      </div>

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

const store = useStore();
const error = ref('');
const program = computed(() => store.state.userStats.referralMilestones || null);
const percent = computed(() => Math.round((program.value?.program?.commissionRate || 0.3) * 100));

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
.ms-muted { font-size: 13px; color: var(--color-text-muted); margin: 10px 0 0; }
.ms-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.ms-button { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--color-primary); background: var(--color-primary); color: var(--color-darker-0); font-weight: 700; cursor: pointer; font-size: 13px; }
.ms-button.alt { background: transparent; color: var(--color-text); border-color: var(--terminal-border-color); }
</style>
