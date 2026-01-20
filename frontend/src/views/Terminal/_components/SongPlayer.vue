<template>
  <div class="song-player hidden-player">
    <audio ref="audioRef" :src="currentSongFileUrl" @ended="nextSong" @timeupdate="updateTime" @loadedmetadata="updateDuration" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useCleanup } from '@/composables/useCleanup';
const store = useStore();
const cleanup = useCleanup();

const audioRef = ref(null);

const songs = computed(() => store.state.songPlayer.songs);
const currentSongIndex = computed(() => store.state.songPlayer.currentSongIndex);
const isPlaying = computed(() => store.state.songPlayer.isPlaying);
const currentTime = computed(() => store.state.songPlayer.currentTime);
const duration = computed(() => store.state.songPlayer.duration);
const volume = ref(0.7); // Default volume

const soundtrackPath = '/soundtrack/';

const getSongObj = (idx) => {
  const s = songs.value[idx];
  if (!s) return { file: '', title: '', artist: '', url: '' };
  if (typeof s === 'string') return { file: s, title: s, artist: '', url: '' };
  return s;
};

const currentSongObj = computed(() => getSongObj(currentSongIndex.value));
const currentSongName = computed(() => currentSongObj.value.title || currentSongObj.value.file);
const currentSongArtist = computed(() => currentSongObj.value.artist || '');
const currentSongUrl = computed(() => currentSongObj.value.url || '');
const currentSongFileUrl = computed(() => (songs.value.length ? soundtrackPath + currentSongObj.value.file : ''));

function play() {
  audioRef.value?.play();
  store.dispatch('songPlayer/play');
}
function pause() {
  audioRef.value?.pause();
  store.dispatch('songPlayer/pause');
}
function togglePlay() {
  if (!songs.value.length) return;
  if (isPlaying.value) pause();
  else play();
}
function nextSong() {
  store.dispatch('songPlayer/next');
}
function prevSong() {
  store.dispatch('songPlayer/prev');
}
function selectSong(idx) {
  store.dispatch('songPlayer/setSongIndex', idx);
}
function seekAudio(e) {
  const t = parseFloat(e.target.value);
  audioRef.value.currentTime = t;
  store.dispatch('songPlayer/setCurrentTime', t);
}
function updateTime() {
  if (audioRef.value) {
    store.dispatch('songPlayer/setCurrentTime', audioRef.value.currentTime);
  }
}
function updateDuration() {
  if (audioRef.value) {
    store.dispatch('songPlayer/setDuration', audioRef.value.duration);
  }
}
function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setVolume(val) {
  volume.value = val;
  if (audioRef.value) audioRef.value.volume = val;
}

// Load songs on mount
onMounted(async () => {
  if (!songs.value.length) {
    try {
      const manifestRes = await fetch(soundtrackPath + 'manifest.json');
      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        if (Array.isArray(manifest) && manifest.length > 0) {
          store.dispatch('songPlayer/setSongs', manifest);
        }
      }
    } catch {}
  }
  setVolume(volume.value);
  // Listen for volume change events from the controller
  const volumeHandler = (e) => {
    if (typeof e.detail === 'number') setVolume(e.detail);
  };
  cleanup.addEventListener(window, 'songplayer-set-volume', volumeHandler);
  // Emit initial volume for controller sync
  window.dispatchEvent(new CustomEvent('songplayer-volume-sync', { detail: volume.value }));
});

// Watch for isPlaying and control audio
watch(isPlaying, (val) => {
  if (!audioRef.value) return;
  if (val) audioRef.value.play();
  else audioRef.value.pause();
});

// Watch for song change
watch(currentSongIndex, () => {
  if (audioRef.value) {
    audioRef.value.currentTime = 0;
    if (isPlaying.value) {
      nextTick(() => audioRef.value.play());
    }
  }
});

watch(volume, (val) => {
  if (audioRef.value) audioRef.value.volume = val;
});
</script>

<style scoped>
.song-player.hidden-player {
  display: none !important;
}
</style>
