<template>
  <BaseDashboardCard title="STATUS & INCIDENTS" footer-text="Click [INC-*] to /postmortem">
    <div class="incidents-summary">
      <div class="summary-line">
        <span class="label">Open:</span>
        <span class="value clickable">[INC-{{ openIncidents }} minor]</span>
        <span class="label">Past 24h:</span>
        <span class="value">{{ pastDayIncidents }}</span>
      </div>
    </div>
    <div class="incidents-list">
      <div v-for="incident in incidents" :key="incident.id" class="incident-item">
        <span class="incident-link clickable">[{{ incident.id }}]</span>
        <span class="incident-description">{{ incident.description }}</span>
        <span class="incident-status" :class="incident.statusClass">{{ incident.statusIcon }}</span>
      </div>
    </div>
    <div class="slo-metrics">
      <div class="slo-line">
        <span class="label">SLOs:</span>
        <span class="metric">API {{ sloData.api }}%</span>
        <span class="separator">|</span>
        <span class="metric">Runs {{ sloData.runs }}%</span>
        <span class="separator">|</span>
        <span class="metric">UX {{ sloData.ux }}%</span>
      </div>
    </div>
  </BaseDashboardCard>
</template>

<script>
import BaseDashboardCard from './BaseDashboardCard.vue';

export default {
  name: 'StatusIncidents',
  components: {
    BaseDashboardCard,
  },
  props: {
    incidentsData: {
      type: Object,
      default: () => ({
        open: 2,
        pastDay: 3,
        incidents: [
          {
            id: 'INC-441',
            description: 'tool timeout (auto-healed)',
            status: 'resolved',
            statusIcon: '✓',
            statusClass: 'status-resolved',
          },
          {
            id: 'INC-442',
            description: 'scraper drift (watch)',
            status: 'monitoring',
            statusIcon: '',
            statusClass: 'status-monitoring',
          },
          {
            id: 'INC-443',
            description: 'queue spike (mitigated)',
            status: 'resolved',
            statusIcon: '✓',
            statusClass: 'status-resolved',
          },
        ],
        slo: {
          api: 99.0,
          runs: 99.4,
          ux: 99.2,
        },
      }),
    },
  },
  computed: {
    openIncidents() {
      return this.incidentsData.open;
    },
    pastDayIncidents() {
      return this.incidentsData.pastDay;
    },
    incidents() {
      return this.incidentsData.incidents;
    },
    sloData() {
      return this.incidentsData.slo;
    },
  },
};
</script>

<style scoped>
.incidents-summary {
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.summary-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 0.8em;
}

.label {
  color: var(--color-text-muted);
  font-weight: bold;
}

.value {
  color: var(--color-text);
}

.value.clickable {
  color: var(--color-green);
  background: var(--color-darker-1);
  padding: 2px 4px;
  border-radius: 2px;
  border: 1px solid var(--terminal-border-color);
  cursor: pointer;
  transition: all 0.2s ease;
}

.value.clickable:hover {
  background: var(--color-darker-2);
  transform: translateY(-1px);
}

.incidents-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.incident-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 0.8em;
}

.incident-link {
  color: var(--color-green);
  background: var(--color-darker-1);
  padding: 1px 4px;
  border-radius: 2px;
  border: 1px solid var(--terminal-border-color);
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 60px;
  text-align: center;
}

.incident-link:hover {
  background: var(--color-darker-2);
  transform: translateY(-1px);
}

.incident-description {
  color: var(--color-text-muted);
  flex: 1;
}

.incident-status {
  font-weight: bold;
  min-width: 15px;
  text-align: center;
}

.status-resolved {
  color: #10b981;
}

.status-monitoring {
  color: #f59e0b;
}

.status-error {
  color: var(--color-red);
}

.slo-metrics {
  border-top: 1px solid var(--terminal-border-color);
  padding-top: 8px;
}

.slo-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 0.8em;
}

.metric {
  color: var(--color-text);
  font-weight: bold;
}

.separator {
  color: var(--color-text-muted);
}
</style>
