<template>
  <div class="ui-panel settings-panel">
    <h2>Settings</h2>
    <div class="panel-section about-section">
      <div class="about-row">AGNT Terminal UI v0.3.1</div>
      <div class="about-row">Settings let you personalize your experience.</div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';

export default {
  name: 'SettingsPanel',
  components: { BaseButton },
  setup() {
    const theme = ref('dark');
    const soundOn = ref(true);
    const toggleTheme = () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
    };
    const toggleSound = () => {
      soundOn.value = !soundOn.value;
    };
    return {
      theme,
      soundOn,
      toggleTheme,
      toggleSound,
    };
  },
};
</script>

<style scoped>
.ui-panel.settings-panel {
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.panel-section {
  margin-bottom: 18px;
}
.panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(25, 239, 131, 0.1);
}
.about-section {
  /* margin-top: 18px; */
  color: var(--color-grey);
}
.about-row {
  margin-bottom: 6px;
}
</style>
