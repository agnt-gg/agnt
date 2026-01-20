<template>
  <div class="ball-jumper-container">
    <canvas ref="canvas" id="world"></canvas>
    <div id="notification-popup"></div>
    <Tooltip text="Exit to Settings" width="auto">
      <button class="exit-btn" @click="emitExit">×</button>
    </Tooltip>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import runBallJumperGame from './js/main.js';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const canvas = ref(null);
let cleanup = null;
const emit = defineEmits(['exit']);

function emitExit() {
  if (typeof cleanup === 'function') cleanup();
  emit('exit');
}

onMounted(() => {
  cleanup = runBallJumperGame(canvas.value);
});

onBeforeUnmount(() => {
  if (typeof cleanup === 'function') cleanup();
});
</script>

<style scoped>
.ball-jumper-container {
  width: 100vw;
  height: 100vh;
  position: relative;
  /* background: #111; */
}
canvas#world {
  display: block;
  /* background: #222; */
  width: 100vw;
  height: 100vh;
}
#notification-popup {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1003;
  pointer-events: none;
}
.exit-btn {
  position: fixed;
  top: 18px;
  right: 58px;
  z-index: 1002;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: #fff;
  font-size: 2em;
  border: none;
  cursor: pointer;
  opacity: 0.85;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.exit-btn:hover {
  background: #444;
}
</style>
