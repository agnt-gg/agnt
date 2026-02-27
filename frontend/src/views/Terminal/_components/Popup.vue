<template>
  <transition name="popup-fade">
    <div v-if="show" class="popup-notification" :class="typeClass" @mouseenter="pauseTimer" @mouseleave="resumeTimer">
      <span v-if="icon" class="popup-icon"><i :class="icon"></i></span>
      <span class="popup-message">{{ message }}</span>
      <button class="popup-close" @click="closePopup" aria-label="Close">&times;</button>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  message: { type: String, required: true },
  type: { type: String, default: 'success' }, // success, error, info, warning
  duration: { type: Number, default: 3000 }, // ms
  icon: { type: String, default: '' }, // e.g. 'fas fa-check-circle'
  show: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const timer = ref(null);
const isPaused = ref(false);

const typeClass = computed(() => `popup-${props.type}`);

const playSuccessChime = () => {
  const audio = new Audio('/sounds/success-chime.mp3');
  audio.volume = 0.7;
  audio.play().catch(() => {});
};

const startTimer = () => {
  if (props.duration > 0) {
    timer.value = setTimeout(() => {
      closePopup();
    }, props.duration);
  }
};

const clearTimer = () => {
  if (timer.value) {
    clearTimeout(timer.value);
    timer.value = null;
  }
};

const pauseTimer = () => {
  isPaused.value = true;
  clearTimer();
};

const resumeTimer = () => {
  isPaused.value = false;
  startTimer();
};

const closePopup = () => {
  clearTimer();
  emit('close');
};

watch(() => props.show, (val) => {
  if (val) {
    if (props.type === 'success') playSuccessChime();
    startTimer();
  } else {
    clearTimer();
  }
});

onMounted(() => {
  if (props.show) {
    if (props.type === 'success') playSuccessChime();
    startTimer();
  }
});
onBeforeUnmount(clearTimer);
</script>

<style scoped>
.popup-notification {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 260px;
  max-width: 90vw;
  background: var(--color-popup);
  color: var(--color-text);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(25,239,131,0.18), 0 1.5px 8px rgba(0,0,0,0.18);
  padding: 24px 40px 24px 28px;
  display: flex;
  align-items: center;
  gap: 18px;
  z-index: 2000;
  font-size: 1.15em;
  animation: popup-bounce-in-center 0.5s;
}
.popup-icon {
  font-size: 2em;
  color: var(--color-green, #19ef83);
  flex-shrink: 0;
}
.popup-message {
  flex: 1;
  word-break: break-word;
}
.popup-close {
  background: none;
  border: none;
  color: var(--color-grey, #aaa);
  font-size: 1.5em;
  cursor: pointer;
  margin-left: 16px;
  transition: color 0.2s;
}
.popup-close:hover {
  color: var(--color-red, #ef1919);
}
.popup-success {
  border: 2.5px solid var(--color-green, #19ef83);
}
.popup-error {
  border: 2.5px solid var(--color-red, #ef1919);
  color: var(--color-red, #ef1919);
}
.popup-info {
  border: 2.5px solid var(--color-blue, #19b3ef);
  color: var(--color-blue, #19b3ef);
}
.popup-warning {
  border: 2.5px solid var(--color-yellow, #ffe066);
  color: var(--color-yellow, #ffe066);
}
.popup-fade-enter-active, .popup-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.popup-fade-enter-from, .popup-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -60%) scale(0.98);
}
@keyframes popup-bounce-in-center {
  0% { transform: translate(-50%, -60%) scale(0.8); opacity: 0; }
  60% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1); }
}
</style>
