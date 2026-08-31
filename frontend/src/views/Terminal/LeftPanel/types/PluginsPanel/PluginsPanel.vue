<!-- PluginsPanel — the left panel for the Plugins screen.

     This file has to exist. BaseScreen derives a left panel name from the
     screen id (PluginsScreen -> PluginsPanel), and LeftPanel falls back to
     ChatPanel for any name that fails to import — so a screen without its own
     panel does not render an empty column, it renders the conversation list.

     It is deliberately just a heading. Everything you would otherwise put here
     — the Installed / Marketplace tabs, the search box, the counts — is
     already on the screen itself, and repeating a menu one gap to the left of
     the menu is the exact duplication that collapsed Connect's six sidebar
     rows into one. -->
<template>
  <div class="plugins-panel">
    <div class="panel-header">
      <h2 class="title">/ Plugins</h2>
    </div>
    <p class="panel-note">Installed plugins add tools, nodes and integrations to AGNT without bloating the app.</p>
  </div>
</template>

<script>
export default {
  name: 'PluginsPanel',
  emits: ['panel-action'],
};
</script>

<style scoped>
.plugins-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}

.panel-header .title {
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.panel-note {
  color: var(--color-text-muted);
  font-size: 0.85em;
  line-height: 1.5;
  opacity: 0.8;
  margin: 0;
}
</style>
