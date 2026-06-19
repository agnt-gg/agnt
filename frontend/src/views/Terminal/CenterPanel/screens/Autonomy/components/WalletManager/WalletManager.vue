<template>
  <div class="wallet-manager">
    <div class="manager-header">
      <h3>Capability Wallets</h3>
      <p class="subtitle">Linear token / API budget; sub-wallets can never duplicate funds. PRD-091 Layer 3.</p>
    </div>

    <div class="root-card">
      <div class="root-label">Root wallet</div>
      <div class="root-balance">{{ formatBalance(rootBalance) }}</div>
      <div class="root-meta" v-if="rootWallet">
        <span>kind: {{ rootWallet.kind }}</span>
        <span>consumed: {{ formatBalance(rootWallet.consumed) }}</span>
        <span>allocated: {{ formatBalance(rootWallet.allocated) }}</span>
      </div>
      <div class="topup-row">
        <input v-model.number="topupAmount" type="number" min="1" placeholder="Amount (tokens)" class="topup-input" />
        <input v-model="topupNote" type="text" placeholder="Optional note" class="topup-input" />
        <button class="btn" :disabled="!topupAmount" @click="topUp">
          <i class="fas fa-plus-circle"></i> Top up
        </button>
      </div>
    </div>

    <div class="section-label">Child wallets ({{ childWallets.length }})</div>
    <div v-if="!childWallets.length" class="empty-state">
      No child wallets active. Goals and workflows allocate their own from the root when autonomy is enabled.
    </div>
    <div v-else class="wallet-list">
      <div v-for="w in childWallets" :key="w.id" class="wallet-row">
        <div class="row-main">
          <div class="row-title">
            <span class="owner">{{ w.owner_type }}:{{ (w.owner_id || '').slice(0, 12) }}</span>
            <span class="balance-chip">{{ formatBalance(w.balance) }} / {{ formatBalance(w.allocated) }}</span>
            <span v-if="w.status !== 'active'" class="off-chip">{{ w.status }}</span>
          </div>
          <div class="row-meta">
            <span>consumed: {{ formatBalance(w.consumed) }}</span>
            <span>updated: {{ formatDate(w.updated_at) }}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" :disabled="w.status !== 'active'" title="Release (sweep balance back to parent)" @click="release(w.id)">
            <i class="fas fa-undo"></i>
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>
    <SimpleModal ref="simpleModalRef" />
  </div>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'WalletManager',
  components: { SimpleModal },
  setup() {
    const store = useStore();
    const simpleModalRef = ref(null);
    const topupAmount = ref(null);
    const topupNote = ref('');

    const rootWallet = computed(() => store.getters['wallets/rootWallet']);
    const rootBalance = computed(() => store.getters['wallets/rootBalance']);
    const childWallets = computed(() => store.getters['wallets/childWallets']);
    const error = computed(() => store.getters['wallets/error']);

    const formatBalance = (v) => Number(v || 0).toLocaleString();
    const formatDate = (s) => {
      if (!s) return '—';
      try { return new Date(s).toLocaleString(); } catch { return s; }
    };

    const topUp = async () => {
      if (!topupAmount.value) return;
      try {
        await store.dispatch('wallets/topUpRoot', { amount: topupAmount.value, note: topupNote.value || null });
        topupAmount.value = null;
        topupNote.value = '';
      } catch (e) { /* error surfaced */ }
    };

    const release = async (id) => {
      const ok = await simpleModalRef.value?.showModal({
        title: 'Release wallet?',
        message: 'The remaining balance will sweep back to the parent wallet and this wallet will be closed.',
        confirmText: 'Release', cancelText: 'Cancel',
      });
      if (!ok) return;
      try { await store.dispatch('wallets/releaseWallet', id); } catch (e) { /* error surfaced */ }
    };

    onMounted(() => {
      store.dispatch('wallets/fetchRoot');
      store.dispatch('wallets/fetchWallets');
    });

    return { simpleModalRef, rootWallet, rootBalance, childWallets, error, topupAmount, topupNote, formatBalance, formatDate, topUp, release };
  },
};
</script>

<style scoped>
.wallet-manager { display: flex; flex-direction: column; gap: 16px; }
.manager-header h3 { color: var(--color-light-green); font-size: 1.2em; font-weight: 500; margin: 0 0 4px 0; }
.subtitle { color: var(--color-text-muted); font-size: 0.85em; opacity: 0.8; margin: 0; }

.root-card {
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color); border-radius: 12px;
  padding: 20px; display: flex; flex-direction: column; gap: 12px;
}
.root-label { font-size: 0.85em; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.root-balance { font-size: 2.4em; font-family: var(--font-family-mono); color: var(--color-primary); font-weight: 600; line-height: 1; }
.root-meta { display: flex; gap: 16px; font-size: 0.8em; color: var(--color-text-muted); font-family: var(--font-family-mono); }
.topup-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.topup-input {
  flex: 1; min-width: 120px;
  background: var(--color-darker-2); border: 1px solid var(--terminal-border-color);
  color: var(--color-text); padding: 8px 12px; border-radius: 6px;
}
.btn {
  background: rgba(var(--primary-rgb), 0.15); color: var(--color-primary);
  border: 1px solid rgba(var(--primary-rgb), 0.4); padding: 8px 16px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn:hover:not(:disabled) { background: rgba(var(--primary-rgb), 0.25); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.section-label { color: var(--color-text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; }
.empty-state { padding: 24px; text-align: center; color: var(--color-text-muted); border: 1px dashed var(--terminal-border-color); border-radius: 8px; font-size: 0.9em; }
.wallet-list { display: flex; flex-direction: column; gap: 8px; }
.wallet-row {
  display: flex; justify-content: space-between; align-items: center;
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color);
  border-radius: 8px; padding: 12px 16px;
}
.row-main { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.row-title { display: flex; align-items: center; gap: 10px; }
.owner { font-family: var(--font-family-mono); font-size: 0.85em; }
.balance-chip {
  font-family: var(--font-family-mono); font-size: 0.85em; color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1); padding: 2px 8px; border-radius: 4px;
}
.off-chip { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; background: rgba(127,127,127,0.15); color: var(--color-text-muted); }
.row-meta { display: flex; gap: 12px; font-size: 0.8em; color: var(--color-text-muted); }
.row-actions { display: flex; gap: 6px; }
.icon-btn {
  background: transparent; border: 1px solid var(--terminal-border-color); color: var(--color-text-muted);
  width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.icon-btn:hover:not(:disabled) { background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); border-color: var(--color-primary); }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.error-banner { color: var(--color-red); padding: 8px 12px; border: 1px solid rgba(var(--red-rgb), 0.3); border-radius: 6px; }
</style>
