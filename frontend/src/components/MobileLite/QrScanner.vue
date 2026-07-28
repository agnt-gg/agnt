<template>
  <div class="qr-scan" role="dialog" aria-modal="true" aria-label="Scan pairing QR code">
    <div class="qr-scan-bar">
      <span>Scan Phone Access QR</span>
      <button type="button" class="qr-scan-close" aria-label="Close scanner" @click="close">
        ×
      </button>
    </div>

    <div v-if="mode === 'live'" class="qr-scan-stage">
      <video ref="videoEl" class="qr-scan-video" playsinline muted autoplay></video>
      <canvas ref="canvasEl" class="qr-scan-canvas" hidden></canvas>
      <div class="qr-scan-frame" aria-hidden="true"></div>
    </div>

    <div v-else class="qr-scan-photo">
      <p class="qr-scan-status">
        Live camera is blocked on this page (http). Take a photo of the desktop QR instead —
        that still works.
      </p>
      <button type="button" class="qr-scan-primary" :disabled="decoding" @click="triggerPhoto">
        {{ decoding ? 'Reading…' : 'Take photo of QR' }}
      </button>
    </div>

    <p v-if="status && mode === 'live'" class="qr-scan-status">{{ status }}</p>
    <p v-if="err" class="qr-scan-err">{{ err }}</p>

    <button
      v-if="mode === 'live'"
      type="button"
      class="qr-scan-cancel"
      @click="usePhotoFallback"
    >
      Take photo instead
    </button>
    <button type="button" class="qr-scan-cancel" @click="close">Cancel</button>

    <input
      ref="fileEl"
      class="qr-scan-file"
      type="file"
      accept="image/*"
      capture="environment"
      @change="onPhotoPicked"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { decodeQrFromImageFile } from '@/utils/qrDecodeFromImage.js';

const props = defineProps({
  /** Prefer photo capture immediately (http:// LAN — getUserMedia blocked). */
  preferPhoto: { type: Boolean, default: false },
});

const emit = defineEmits(['result', 'close']);

const videoEl = ref(null);
const canvasEl = ref(null);
const fileEl = ref(null);
const mode = ref(props.preferPhoto ? 'photo' : 'live');
const status = ref(props.preferPhoto ? '' : 'Starting camera…');
const err = ref('');
const decoding = ref(false);

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
  if (v) v.srcObject = null;
}

function usePhotoFallback() {
  stop();
  mode.value = 'photo';
  status.value = '';
  err.value = '';
}

function triggerPhoto() {
  err.value = '';
  fileEl.value?.click();
}

async function onPhotoPicked(ev) {
  const file = ev.target?.files?.[0];
  if (ev.target) ev.target.value = '';
  if (!file) return;
  decoding.value = true;
  err.value = '';
  status.value = 'Reading QR…';
  try {
    const text = await decodeQrFromImageFile(file);
    if (!text) {
      err.value = 'No QR code found in that photo. Try again closer, or paste the pair link.';
      status.value = '';
      return;
    }
    status.value = 'Code found';
    stop();
    emit('result', text);
  } catch (e) {
    err.value = e?.message || 'Could not read that photo.';
    status.value = '';
  } finally {
    decoding.value = false;
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

async function startLive() {
  mode.value = 'live';
  status.value = 'Starting camera…';
  err.value = '';
  stopped = false;
  await loadJsQR();
  if (!navigator.mediaDevices?.getUserMedia) {
    usePhotoFallback();
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
  if (!video) {
    usePhotoFallback();
    return;
  }
  video.srcObject = stream;
  await video.play();
  status.value = 'Point at the QR on your desktop';
  raf = requestAnimationFrame(tick);
}

onMounted(async () => {
  if (props.preferPhoto) {
    mode.value = 'photo';
    return;
  }
  try {
    await startLive();
  } catch (e) {
    usePhotoFallback();
    if (e?.name === 'NotAllowedError') {
      err.value = 'Live camera permission denied — take a photo of the QR instead.';
    }
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
.qr-scan-photo {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
  padding: 12px;
}
.qr-scan-primary {
  min-height: 52px;
  border: none;
  border-radius: 12px;
  background: #19ef83;
  color: #0b0b12;
  font-size: 16px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}
.qr-scan-primary:disabled {
  opacity: 0.55;
}
.qr-scan-status {
  margin: 12px 0 0;
  text-align: center;
  color: #8b93a7;
  font-size: 14px;
  line-height: 1.4;
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
.qr-scan-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
