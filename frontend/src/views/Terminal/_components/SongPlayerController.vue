<template>
  <div class="song-player-controller">
    <div class="current-song">
      <span class="song-label">Now Playing:</span>
      <div class="song-info">
        <span class="song-title">{{ currentSong?.title || 'No Song' }} by:</span>
        <span class="song-artist">
          <template v-if="currentSong?.url">
            <a :href="currentSong.url" target="_blank" rel="noopener noreferrer">{{ currentSong.artist }}</a>
          </template>
          <template v-else>
            {{ currentSong.artist }}
          </template>
        </span>
      </div>
    </div>

    <div class="controls-row-wrapper">
      <div class="controls-row">
        <Tooltip text="Previous" width="auto">
        <button class="player-btn" @click="prev" :disabled="!hasSongs">
          <i class="fas fa-step-backward"></i>
        </button>
        </Tooltip>
        <button class="player-btn" @click="togglePlay" :disabled="!hasSongs">
          <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'" />
        </button>
        <Tooltip text="Next" width="auto">
        <button class="player-btn" @click="next" :disabled="!hasSongs">
          <i class="fas fa-step-forward"></i>
        </button>
        </Tooltip>
      </div>
      <div class="controls-row">
        <Tooltip text="Volume" width="auto">
        <input type="range" min="0" max="1" step="0.01" v-model.number="volume" @input="onVolumeChange" class="volume-slider" />
        </Tooltip>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useCleanup } from '@/composables/useCleanup';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
const store = useStore();
const cleanup = useCleanup();
const songs = computed(() => store.state.songPlayer.songs);
const currentSongIndex = computed(() => store.state.songPlayer.currentSongIndex);
const currentSong = computed(() => songs.value[currentSongIndex.value] || {});
const isPlaying = computed(() => store.state.songPlayer.isPlaying);
const hasSongs = computed(() => songs.value.length > 0);

const volume = ref(0.7);

const togglePlay = () => {
  if (isPlaying.value) store.dispatch('songPlayer/pause');
  else store.dispatch('songPlayer/play');
};
const next = () => store.dispatch('songPlayer/next');
const prev = () => store.dispatch('songPlayer/prev');

function onVolumeChange() {
  window.dispatchEvent(new CustomEvent('songplayer-set-volume', { detail: volume.value }));
}

onMounted(() => {
  // Optionally sync with SongPlayer's default volume
  const volumeSyncHandler = (e) => {
    if (typeof e.detail === 'number') volume.value = e.detail;
  };
  cleanup.addEventListener(window, 'songplayer-volume-sync', volumeSyncHandler);
});
</script>

<style scoped>
.song-player-controller {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 16px 0 0;
  width: 100%;
  border-top: 1px solid var(--terminal-border-color);
  border-radius: 0px;
  font-size: 0.92em;
  color: var(--color-light-green, #baffc9);
  justify-content: space-between;
  padding-right: 48px;
  gap: 32px;
}
.current-song {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  font-size: 0.98em;
  margin-bottom: 2px;
}
.song-label {
  color: var(--color-grey, #aaa);
  margin-right: 6px;
}
.song-title {
  color: var(--color-white, #fff);
  font-weight: bold;
}
.song-artist {
  color: var(--color-grey, #aaa);
  font-size: 0.9em;
}
.song-artist a {
  color: var(--color-green, #19ef83);
  text-decoration: underline;
  margin-left: 2px;
}
.controls-row-wrapper {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}
.controls-row {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
  width: 100%;
}
.player-btn {
  background: none;
  border: none;
  color: var(--color-green, #19ef83);
  font-size: 1em;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 6px;
  transition: background 0.15s;
}
.player-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.player-btn:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.08);
}
.volume-slider {
  width: 100%;
  margin-left: 0;
  accent-color: var(--color-green, #19ef83);
}
.song-info {
  display: flex;
  flex-direction: row;
  align-items: center;
  font-size: 0.98em;
  margin-bottom: 2px;
  gap: 8px;
}
</style>
