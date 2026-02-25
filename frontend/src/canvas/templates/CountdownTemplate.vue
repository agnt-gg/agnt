<template>
  <div class="cd-root">
    <div class="cd-label">{{ displayLabel }}</div>
    <div class="cd-time">
      <div class="cd-unit">
        <span class="cd-num">{{ days }}</span>
        <span class="cd-tag">DAYS</span>
      </div>
      <span class="cd-sep">:</span>
      <div class="cd-unit">
        <span class="cd-num">{{ hours }}</span>
        <span class="cd-tag">HRS</span>
      </div>
      <span class="cd-sep">:</span>
      <div class="cd-unit">
        <span class="cd-num">{{ minutes }}</span>
        <span class="cd-tag">MIN</span>
      </div>
      <span class="cd-sep">:</span>
      <div class="cd-unit">
        <span class="cd-num">{{ seconds }}</span>
        <span class="cd-tag">SEC</span>
      </div>
    </div>
    <div v-if="isExpired" class="cd-expired">EXPIRED</div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

export default {
  name: 'CountdownTemplate',
  props: {
    config: { type: Object, default: () => ({}) },
    definition: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const now = ref(Date.now());
    let timer = null;

    const displayLabel = computed(() => props.config.label || 'Countdown');
    const targetDate = computed(() => {
      const d = props.config.target_date;
      if (!d) return Date.now() + 86400000; // Default: 24h from now
      return new Date(d).getTime();
    });

    const remaining = computed(() => Math.max(0, targetDate.value - now.value));
    const isExpired = computed(() => remaining.value <= 0);

    const days = computed(() => String(Math.floor(remaining.value / 86400000)).padStart(2, '0'));
    const hours = computed(() => String(Math.floor((remaining.value % 86400000) / 3600000)).padStart(2, '0'));
    const minutes = computed(() => String(Math.floor((remaining.value % 3600000) / 60000)).padStart(2, '0'));
    const seconds = computed(() => String(Math.floor((remaining.value % 60000) / 1000)).padStart(2, '0'));

    onMounted(() => {
      timer = setInterval(() => { now.value = Date.now(); }, 1000);
    });

    onBeforeUnmount(() => {
      if (timer) clearInterval(timer);
    });

    return { displayLabel, days, hours, minutes, seconds, isExpired };
  },
};
</script>

<style scoped>
.cd-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  padding: 16px;
}

.cd-label {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--color-text-muted, #556);
  font-weight: 600;
}

.cd-time {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cd-unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.cd-num {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-green);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.cd-tag {
  font-size: 8px;
  letter-spacing: 1.5px;
  color: var(--color-text-muted, #445);
}

.cd-sep {
  font-size: 22px;
  color: var(--color-text-muted, #334);
  margin: 0 2px;
  margin-bottom: 14px;
}

.cd-expired {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--color-red);
  padding: 3px 10px;
  border: 1px solid rgba(var(--red-rgb), 0.2);
  border-radius: 4px;
  background: rgba(var(--red-rgb), 0.06);
}
</style>
