<template>
  <div class="terminal-header">
    <div class="terminal-title">
      === {{ title }} ===
    </div>
    <div class="terminal-subtitle">
      {{ subtitle }}
    </div>
  </div>
</template>

<script>
export default {
  name: 'TerminalHeader',
  props: {
    title: {
      type: String,
      default: 'Terminal'
    },
    subtitle: {
      type: String,
      default: 'Welcome to the terminal interface.'
    }
  }
}
</script>

<style>
.terminal-header {
  display: flex;
  flex-direction: row;
  width: 100%;
  justify-content: space-between;
}

.terminal-header.left {
  justify-content: flex-start;
  gap: 32px;
}

.terminal-header.map .terminal-subtitle {
  padding-right: 150px;
}
</style>
