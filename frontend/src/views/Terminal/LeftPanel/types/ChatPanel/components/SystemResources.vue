<template>
    <div class="dashboard-section system-resources">
      <h3 class="section-title">RESOURCE ALLOCATION</h3>
  
      <div class="resources-grid">
        <div v-for="resource in resources" :key="resource.id" class="resource-indicator">
          <div class="indicator-ring" :class="resource.status">
            <span class="indicator-value">{{ resource.usage }}%</span>
          </div>
          <span class="indicator-label">{{ resource.name }}</span>
        </div>
      </div>
    </div>
  </template>
  
  <script>
  import { ref } from "vue";
  
  export default {
    name: "SystemResources",
    setup() {
      const resources = ref([
        { id: 1, name: "API Calls", usage: 42, status: "optimal" },
        { id: 2, name: "Storage", usage: 67, status: "optimal" },
        { id: 3, name: "Compute", usage: 74, status: "stable" },
        { id: 4, name: "Bandwidth", usage: 31, status: "optimal" },
      ]);
  
      return {
        resources,
      };
    },
  };
  </script>
  
  <style scoped>
  .dashboard-section {
    margin-bottom: 32px;
  }
  
  .section-title {
    font-size: 0.75em;
    font-weight: 500;
    color: var(--color-duller-navy);
    letter-spacing: 0.2em;
    margin-bottom: 16px;
    font-family: var(--font-family-primary);
  }
  
  .resources-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
  
  .resource-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  
  .indicator-ring {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    background: rgba(127, 129, 147, 0.05);
  }
  
  .indicator-ring.optimal {
    border-color: var(--color-green);
  }

  .indicator-ring.stable {
    border-color: var(--color-blue);
  }

  .indicator-ring.warning {
    border-color: var(--color-yellow);
  }

  .indicator-ring.critical {
    border-color: var(--color-red);
  }

  .indicator-value {
    font-size: 0.9em;
    font-weight: 500;
    color: var(--color-white);
  }

  .indicator-label {
    font-size: 0.75em;
    color: var(--color-med-navy);
    text-align: center;
  }

  @media (max-width: 768px) {
    .resources-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  </style>