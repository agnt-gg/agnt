// useArtifactChatContext — page-state capture for the Artifacts panel.
// Replaces the per-container `artifacts-open-file` CustomEvent listener with
// a reactive composable that exposes `pageContext` and `pageState` for the
// unified chatUnified store + UnifiedChatContainer.

import { ref, onMounted, onUnmounted, computed } from 'vue';

export function useArtifactChatContext({ sessionId = 'artifacts' } = {}) {
  const openFile = ref({ path: null, content: null });
  const consoleMessages = ref([]);

  const handleOpenFileUpdate = (e) => {
    if (e?.detail) openFile.value = { ...e.detail };
  };

  const handleConsoleUpdate = (e) => {
    const msgs = e?.detail?.messages;
    consoleMessages.value = Array.isArray(msgs) ? msgs : [];
  };

  onMounted(() => {
    window.addEventListener('artifacts-open-file', handleOpenFileUpdate);
    window.addEventListener('artifacts-console-update', handleConsoleUpdate);
  });
  onUnmounted(() => {
    window.removeEventListener('artifacts-open-file', handleOpenFileUpdate);
    window.removeEventListener('artifacts-console-update', handleConsoleUpdate);
  });

  const channelKey = computed(() => `artifact:${sessionId}`);
  const pageContext = computed(() => ({ codeId: sessionId }));
  const pageState = computed(() => ({
    codeContext: {
      openFilePath: openFile.value.path,
      openFileContent: openFile.value.content,
      consoleMessages: consoleMessages.value,
    },
  }));

  // Side-effect handler for tool-result frontend events: forward `file_written`
  // to the artifact workspace so open tabs refresh.
  const onFrontendEvent = (eventType, eventData) => {
    if (eventType === 'file_written') {
      window.dispatchEvent(new CustomEvent('code-file-written', { detail: eventData }));
    }
  };

  return {
    channelKey,
    chatType: 'artifact',
    pageContext,
    pageState,
    onFrontendEvent,
  };
}
