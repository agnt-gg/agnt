<template>
  <div class="qr-scan" role="dialog" aria-modal="true" aria-label="Scan pairing QR code">
    <div class="qr-scan-bar">
      <span>Scan Phone Access QR</span>
      <button type="button" class="qr-scan-close" aria-label="Close scanner" @click="close">
        ×
      </button>
    </div>
    <div class="qr-scan-stage">
      <video ref="videoEl" class="qr-scan-video" playsinline muted autoplay></video>
      <canvas ref="canvasEl" class="qr-scan-canvas" hidden></canvas>
      <div class="qr-scan-frame" aria-hidden="true"></div>
    </div>
    <p v-if="status" class="qr-scan-status">{{ status }}</p>
    <p v-if="err" class="qr-scan-err">{{ err }}</p>
    <button type="button" class="qr-scan-cancel" @click="close">Cancel</button>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits(['result', 'close']);

const videoEl = ref(null);
const canvasEl = ref(null);
const status = ref('Starting camera…');
const err = ref('');

let stream = null;
let raf = 0;
let stopped = false;
let jsQR = null;

async function loadJsQR() {
  if (jsQR) return jsQR;
  const mod = await import('@/vendor/jsQR.mjs');
  jsQR = mod.default;
  return jsQR;
}

function close() {
  stop();
  emit('close');
}

function stop() {
  stopped = true;
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const v = videoEl.value;
  if (v) {
    v.srcObject = null;
  }
}

function tick() {
  if (stopped) return;
  const video = videoEl.value;
  const canvas = canvasEl.value;
  if (!video || !canvas || !jsQR || video.readyState < 2) {
    raf = requestAnimationFrame(tick);
    return;
  }

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    raf = requestAnimationFrame(tick);
    return;
  }

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
  if (code?.data) {
    status.value = 'Code found';
    stop();
    emit('result', String(code.data).trim());
    return;
  }
  raf = requestAnimationFrame(tick);
}

onMounted(async () => {
  try {
    await loadJsQR();
    if (!navigator.mediaDevices?.getUserMedia) {
      err.value = 'Camera not available in this browser.';
      status.value = '';
      return;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    const video = videoEl.value;
    video.srcObject = stream;
    await video.play();
    status.value = 'Point at the QR on your desktop';
    raf = requestAnimationFrame(tick);
  } catch (e) {
    status.value = '';
    err.value =
      e?.name === 'NotAllowedError'
        ? 'Camera permission denied. Enable camera for AGNT Chat in Settings.'
        : e?.message || 'Could not open camera.';
  }
});

onBeforeUnmount(stop);
</script>

<style scoped>
.qr-scan {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #000;
  display: flex;
  flex-direction: column;
  color: #e8e8f0;
  padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.qr-scan-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 12px;
}
.qr-scan-close {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 12px;
  background: #1b1b2b;
  color: #e8e8f0;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}
.qr-scan-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  border-radius: 16px;
  overflow: hidden;
  background: #111;
}
.qr-scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.qr-scan-frame {
  position: absolute;
  inset: 18% 12%;
  border: 2px solid #19ef83;
  border-radius: 16px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.qr-scan-status {
  margin: 12px 0 0;
  text-align: center;
  color: #8b93a7;
  font-size: 14px;
}
.qr-scan-err {
  margin: 12px 0 0;
  text-align: center;
  color: #ff7b7b;
  font-size: 14px;
}
.qr-scan-cancel {
  margin-top: 12px;
  min-height: 48px;
  border: 1px solid #2e3350;
  border-radius: 12px;
  background: transparent;
  color: #e8e8f0;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
</style>
