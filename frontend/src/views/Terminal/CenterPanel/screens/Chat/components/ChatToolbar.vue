<template>
  <div v-if="message.role === 'assistant'" class="chat-toolbar-wrap">
    <div class="chat-toolbar" role="toolbar" aria-label="Message actions">
      <!-- Regenerate -->
      <button class="chat-toolbar-btn" data-accent="cyan" type="button" title="Regenerate" :disabled="isBusy" @click="onRegenerate">
        <span class="btn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 4v6h-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>

      <!-- Copy -->
      <button class="chat-toolbar-btn" data-accent="pink" type="button" title="Copy" @click="onCopy">
        <span class="btn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M9 9h10v10H9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </span>
      </button>

      <!-- Share / Upload -->
      <button class="chat-toolbar-btn" data-accent="green" type="button" title="Share / Upload" @click="onShare">
        <span class="btn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 7l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </span>
      </button>

      <!-- Copy Conversation (α) -->
      <button class="chat-toolbar-btn" data-accent="indigo" type="button" title="Copy conversation" @click="onCopyConversation">
        <span class="btn-icon alpha-icon" aria-hidden="true">α</span>
      </button>

      <!-- Generate Artifact (▶▶) -->
      <button class="chat-toolbar-btn" data-accent="orange" type="button" title="Generate artifact" @click="onGenerateArtifact">
        <span class="btn-icon artifact-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 3l9 9-9 9V3z"/><path d="M13 8l5 5-5 5V8z" opacity="0.6"/></svg>
        </span>
      </button>

      <span class="chat-toolbar-sep" aria-hidden="true"></span>

      <!-- Thumbs Up -->
      <button class="chat-toolbar-btn" data-accent="gold" type="button" title="Thumbs up" @click="onFeedback('up')">
        <span class="btn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M7 11v10H4V11h3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 11l5-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2l-1 6a2 2 0 0 1-2 2H7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>
        </span>
      </button>

      <!-- Thumbs Down -->
      <button class="chat-toolbar-btn" data-accent="violet" type="button" title="Thumbs down" @click="onFeedback('down')">
        <span class="btn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M17 13V3h3v10h-3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M17 13l-5 7a2 2 0 0 1-3-2l1-5H4a2 2 0 0 1-2-2l1-6a2 2 0 0 1 2-2h12" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>
        </span>
      </button>

      <span class="chat-toolbar-spacer"></span>
      <span v-if="actionNote" class="chat-toolbar-note">{{ actionNote }}</span>
    </div>
  </div>
</template>

<script>
import { computed, ref } from 'vue';

export default {
  name: 'ChatToolbar',
  props: {
    message: { type: Object, required: true },
    status: { type: Object, default: null },
  },
  emits: ['assistant-action'],
  setup(props, { emit }) {
    const isBusy = computed(() => {
      const t = props.status?.type;
      return t === 'thinking' || t === 'running' || t === 'streaming';
    });

    const actionNote = ref('');
    const flashNote = (msg) => {
      actionNote.value = msg || '';
      clearTimeout(flashNote._t);
      flashNote._t = setTimeout(() => { actionNote.value = ''; }, 1400);
    };

    const onRegenerate = () => {
      emit('assistant-action', { action: 'regenerate', messageId: props.message?.id });
      flashNote('Regenerating…');
    };

    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(String(props.message?.content || ''));
        flashNote('Copied');
      } catch { flashNote('Copy failed'); }
    };

    const onShare = async () => {
      const text = String(props.message?.content || '');
      try {
        if (navigator.share) {
          await navigator.share({ title: 'AGNT Output', text: text.slice(0, 4000) });
          flashNote('Shared');
        } else {
          await navigator.clipboard.writeText(text);
          flashNote('Copied');
        }
      } catch { flashNote('Share canceled'); }
    };

    const onCopyConversation = () => {
      emit('assistant-action', { action: 'copy-conversation', messageId: props.message?.id });
      flashNote('Copying…');
    };

    const onGenerateArtifact = () => {
      emit('assistant-action', { action: 'generate-artifact', messageId: props.message?.id });
      flashNote('Generating…');
    };

    const onFeedback = (vote) => {
      emit('assistant-action', { action: 'feedback', vote, messageId: props.message?.id });
      flashNote(vote === 'up' ? 'Thanks' : 'Noted');
    };

    return { isBusy, actionNote, onRegenerate, onCopy, onShare, onCopyConversation, onGenerateArtifact, onFeedback };
  },
};
</script>

<style scoped>
.chat-toolbar-wrap {
  width: 100%;
  display: flex;
  justify-content: flex-start;
  margin-top: 10px;
}

.chat-toolbar {
  --bg-rgb: var(--color-background-rgb, 11, 15, 26);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  flex-wrap: wrap;
  padding: 6px 8px;
  border-radius: var(--radius-md, 8px);
  background: linear-gradient(180deg, rgba(var(--bg-rgb), 0.34), rgba(var(--bg-rgb), 0.22));
  border: 1px solid var(--color-lighter-1, rgba(255, 255, 255, 0.1));
  box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: background var(--transition-fast, 150ms ease-in-out), border-color var(--transition-fast, 150ms ease-in-out);
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.chat-toolbar:hover {
  background: rgba(var(--bg-rgb), 0.40);
  border-color: var(--color-lighter-2, rgba(255, 255, 255, 0.2));
}

.chat-toolbar-btn {
  width: 30px;
  height: 26px;
  border-radius: var(--radius-sm, 4px);
  border: 1px solid transparent;
  background: transparent;
  padding: 0;
  opacity: 1 !important;
  color: var(--color-muted, rgba(255, 255, 255, 0.72)) !important;
  cursor: pointer;
  outline: none;
  position: relative;
  z-index: 1;
  transition: transform var(--transition-fast, 150ms ease-in-out), background var(--transition-fast, 150ms ease-in-out), border-color var(--transition-fast, 150ms ease-in-out), color var(--transition-fast, 150ms ease-in-out);
}

.chat-toolbar-btn:hover {
  opacity: 1 !important;
  background: var(--color-lighter-0, rgba(255, 255, 255, 0.1));
  border-color: var(--color-lighter-1, rgba(255, 255, 255, 0.2));
  color: rgba(255, 255, 255, 0.92) !important;
  transform: translateY(-1px);
}

.chat-toolbar-btn:active { transform: translateY(0) scale(0.98); }
.chat-toolbar-btn:disabled { opacity: 0.45 !important; cursor: not-allowed; }

.chat-toolbar-btn[data-accent="cyan"]   { --accent: var(--color-secondary, var(--color-blue, #12e0ff)); }
.chat-toolbar-btn[data-accent="pink"]   { --accent: var(--color-primary, var(--color-pink, #e53d8f)); }
.chat-toolbar-btn[data-accent="green"]  { --accent: var(--color-success, var(--color-green, #19ef83)); }
.chat-toolbar-btn[data-accent="gold"]   { --accent: var(--color-warning, var(--color-yellow, #ffd700)); }
.chat-toolbar-btn[data-accent="orange"] { --accent: var(--color-warning, var(--color-orange, #ff9500)); }
.chat-toolbar-btn[data-accent="indigo"] { --accent: var(--color-indigo, #7d3de5); }
.chat-toolbar-btn[data-accent="violet"] { --accent: var(--color-violet, var(--color-indigo, var(--color-secondary, #7d3de5))); }

.chat-toolbar-btn[data-accent]:hover {
  color: color-mix(in srgb, white 70%, var(--accent) 30%) !important;
}

.btn-icon {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
}

.btn-icon svg { width: 16px; height: 16px; }

.alpha-icon {
  font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
  transform: translateY(-1px);
}

.artifact-icon svg { width: 16px; height: 16px; }

.chat-toolbar-sep {
  width: 8px;
  height: 16px;
  border-left: 1px solid var(--color-lighter-1, rgba(255, 255, 255, 0.12));
  margin: 0 2px;
  position: relative;
  z-index: 1;
}

.chat-toolbar-spacer { flex: 1; }

.chat-toolbar-note {
  font-size: 11px;
  color: var(--color-muted, rgba(255, 255, 255, 0.72));
  user-select: none;
  padding-right: 2px;
  position: relative;
  z-index: 1;
}
</style>
