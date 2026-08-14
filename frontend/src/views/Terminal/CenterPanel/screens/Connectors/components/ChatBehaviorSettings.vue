<template>
  <div class="chat-behavior">
    <!-- ── CARD 03 · INSTRUCTIONS ───────────────────────────────────── -->
    <SettingsCard num="03" title="Instructions" question="— how should she behave?">
      <template #value>
        <span v-if="customInstructionsStatus === 'saving'" class="status-indicator saving">Saving…</span>
        <span v-else-if="customInstructionsStatus === 'saved'" class="status-indicator saved">
          <i class="fas fa-check"></i> Saved
        </span>
      </template>

      <div class="custom-instructions-section">
        <div class="custom-instructions-header">
          <label for="custom-instructions-textarea">Custom system instructions</label>
          <Tooltip
            title="Applies system-wide"
            text="These instructions are appended to Annie's system prompt in every orchestrator chat. Use this for persistent tone/style preferences, default context about you, or rules you want followed everywhere. Takes effect on new chats."
            position="top"
            width="320px"
          >
            <i class="fas fa-info-circle info-icon"></i>
          </Tooltip>
        </div>
        <textarea
          id="custom-instructions-textarea"
          v-model="customInstructionsDraft"
          class="custom-instructions-textarea"
          rows="4"
          maxlength="10000"
          placeholder="e.g. Always respond concisely. I'm a senior engineer — skip the hand-holding. Prefer bullet points over prose."
          @blur="saveCustomInstructions"
        ></textarea>
        <div class="custom-instructions-footer">
          <span>Takes effect on new chats.</span>
          <span class="char-count" :class="{ 'char-count-warn': customInstructionsDraft.length > 9000 }">
            {{ customInstructionsDraft.length }} / 10000
          </span>
        </div>
      </div>
    </SettingsCard>

    <!--
      ── CARD 04 · LIMITS & EXECUTION ────────────────────────────────
      Collapsed by default because these are set once and then never touched,
      and because none of them is actually about PROVIDERS — they govern every
      chat surface in the app. They sit on this page for historical reasons.

      Collapsed is not the same as hidden: all three values are printed in the
      header, so you never have to open the drawer just to read a number.
    -->
    <SettingsCard
      num="04"
      title="Limits &amp; execution"
      question="— guardrails you set once"
      collapsible
    >
      <template #value>
        <span class="limits-summary">{{ limitsSummary }}</span>
      </template>

      <div class="limits-rows">
        <!-- Async tool execution -->
        <div class="limits-row">
          <div class="limits-main">
            <div class="async-tools-label">
              <span>Async tool execution</span>
              <span class="experimental-badge">Experimental</span>
              <Tooltip
                title="Background &amp; scheduled tool calls (experimental)"
                text="Off by default. When on, Annie can run tools in the background, schedule recurring tasks, and delay actions (e.g. 'do this in 15 seconds'). The capability is still being hardened — turn it on if you want to try it. With it off, every tool call runs synchronously, just like a normal chat. Takes effect on new chats."
              >
                <i class="fas fa-info-circle info-icon"></i>
              </Tooltip>
            </div>
            <p class="async-tools-help">
              {{
                asyncToolsEnabled
                  ? 'On — Annie can queue tools to run in the background and on a schedule.'
                  : 'Off — every tool call runs synchronously. No background tasks, no scheduled actions.'
              }}
            </p>
          </div>
          <div class="limits-control">
            <button
              id="async-tools-toggle"
              type="button"
              role="switch"
              class="async-tools-switch"
              :class="{ 'is-on': asyncToolsEnabled }"
              :aria-checked="asyncToolsEnabled"
              @click="toggleAsyncTools"
            >
              <span class="switch-thumb" :class="{ 'is-on': asyncToolsEnabled }"></span>
            </button>
          </div>
        </div>

        <!-- Tool output limit -->
        <div class="limits-row">
          <div class="limits-main">
            <div class="async-tools-label">
              <label for="tool-output-cap-input">Tool output limit</label>
              <Tooltip
                title="Per-call cap on tool result size"
                text="Maximum characters of any single tool result returned to the LLM. Results above this size are replaced with a short JSON note telling Annie to narrow the query or paginate. Raise this if you keep hitting truncations on big reads — every ~4 characters is roughly 1 token, so 100k chars ≈ 28k tokens."
                position="top"
                width="340px"
              >
                <i class="fas fa-info-circle info-icon"></i>
              </Tooltip>
              <span v-if="toolOutputCapStatus === 'saving'" class="status-indicator saving">Saving…</span>
              <span v-else-if="toolOutputCapStatus === 'saved'" class="status-indicator saved"><i class="fas fa-check"></i> Saved</span>
            </div>
            <p class="async-tools-help">Raise it if large file reads keep getting truncated.</p>
          </div>
          <div class="limits-control">
            <div class="tool-output-cap-presets">
              <button
                v-for="preset in [50000, 100000, 200000, 400000]"
                :key="preset"
                type="button"
                class="preset-chip"
                :class="{ active: Number(toolOutputCapDraft) === preset }"
                @click="applyToolOutputCapPreset(preset)"
              >
                {{ preset / 1000 }}k
              </button>
            </div>
            <input
              id="tool-output-cap-input"
              v-model.number="toolOutputCapDraft"
              type="number"
              min="25000"
              max="500000"
              step="5000"
              class="tool-output-cap-input"
              @blur="saveToolOutputCap"
            />
            <span class="tool-output-cap-unit">chars (~{{ Math.round((Number(toolOutputCapDraft) || 0) / 4 / 1000) }}k tokens)</span>
          </div>
        </div>

        <!-- Max tool runs -->
        <div class="limits-row">
          <div class="limits-main">
            <div class="async-tools-label">
              <label for="max-tool-rounds-input">Max tool runs</label>
              <Tooltip
                title="Cap on tool-loop rounds per turn"
                text="Maximum number of tool execution rounds Annie can run in a single turn before the loop is forced to end. Raise this for long autonomous tasks; lower it to fail fast on runaway loops. Applies to every chat (orchestrator, agent, workflow, widget, plugin tool, goal, artifact). Default 100."
                position="top"
                width="340px"
              >
                <i class="fas fa-info-circle info-icon"></i>
              </Tooltip>
              <span v-if="maxToolRoundsStatus === 'saving'" class="status-indicator saving">Saving…</span>
              <span v-else-if="maxToolRoundsStatus === 'saved'" class="status-indicator saved"><i class="fas fa-check"></i> Saved</span>
            </div>
            <p class="async-tools-help">Tool-loop rounds allowed in a single turn before the loop is forced to end.</p>
          </div>
          <div class="limits-control">
            <div class="tool-output-cap-presets">
              <button
                v-for="preset in [25, 50, 100, 200]"
                :key="preset"
                type="button"
                class="preset-chip"
                :class="{ active: Number(maxToolRoundsDraft) === preset }"
                @click="applyMaxToolRoundsPreset(preset)"
              >
                {{ preset }}
              </button>
            </div>
            <input
              id="max-tool-rounds-input"
              v-model.number="maxToolRoundsDraft"
              type="number"
              min="1"
              max="999999"
              step="5"
              class="tool-output-cap-input"
              @blur="saveMaxToolRounds"
            />
            <span class="tool-output-cap-unit">rounds per turn</span>
          </div>
        </div>
      </div>
    </SettingsCard>
  </div>
</template>

<script>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import SettingsCard from '@/views/_components/common/SettingsCard.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

/**
 * ChatBehaviorSettings — cards 03 (Instructions) and 04 (Limits & execution).
 *
 * WHY THESE LEFT ProviderSelector
 * ───────────────────────────────
 * They were never about providers. Custom instructions, async tools, the tool
 * output cap and the tool-round limit govern EVERY chat surface in the app;
 * they lived in the provider component only because that is where they happened
 * to be added. Keeping them there forced one component to own four unrelated
 * concerns and made the page impossible to order by importance.
 *
 * Splitting them out is also what lets Connectors.vue render the cards in
 * frequency order — Model, Fallback, Instructions, Limits — because the
 * fallback card now sits BETWEEN the model pickers and these.
 */
export default {
  name: 'ChatBehaviorSettings',
  components: { SettingsCard, Tooltip },
  setup() {
    const store = useStore();

    // ── Custom system instructions — edited locally, persisted on blur ──
    const customInstructionsDraft = ref(store.state.aiProvider.customInstructions || '');
    const customInstructionsStatus = ref(''); // '' | 'saving' | 'saved'
    let savedResetTimer = null;

    // Keep the local draft in sync if the store changes underneath (e.g. after
    // loadUserSettings), but never yank text out from under a live cursor.
    watch(
      () => store.state.aiProvider.customInstructions,
      (val) => {
        if (document.activeElement?.id !== 'custom-instructions-textarea') {
          customInstructionsDraft.value = val || '';
        }
      },
    );

    const saveCustomInstructions = async () => {
      const next = (customInstructionsDraft.value || '').trim();
      const current = (store.state.aiProvider.customInstructions || '').trim();
      if (next === current) return;

      customInstructionsStatus.value = 'saving';
      try {
        await store.dispatch('aiProvider/setCustomInstructions', next);
        customInstructionsStatus.value = 'saved';
        clearTimeout(savedResetTimer);
        savedResetTimer = setTimeout(() => {
          if (customInstructionsStatus.value === 'saved') customInstructionsStatus.value = '';
        }, 2000);
      } catch (error) {
        console.error('Failed to save custom instructions:', error);
        customInstructionsStatus.value = '';
      }
    };

    // ── Async tool execution ────────────────────────────────────────────
    const asyncToolsEnabled = computed(() => store.state.aiProvider.asyncToolsEnabled !== false);
    const toggleAsyncTools = () => {
      store.dispatch('aiProvider/setAsyncToolsEnabled', !asyncToolsEnabled.value);
    };

    // ── Tool output cap ─────────────────────────────────────────────────
    const toolOutputCapDraft = ref(store.state.aiProvider.toolOutputCap || 100000);
    const toolOutputCapStatus = ref('');
    let toolOutputCapSavedResetTimer = null;

    watch(
      () => store.state.aiProvider.toolOutputCap,
      (val) => {
        if (document.activeElement?.id !== 'tool-output-cap-input') {
          toolOutputCapDraft.value = val || 100000;
        }
      },
    );

    const saveToolOutputCap = async () => {
      const raw = Number(toolOutputCapDraft.value);
      const next = Number.isFinite(raw) ? Math.max(25000, Math.min(500000, Math.round(raw))) : 100000;
      toolOutputCapDraft.value = next;
      if (next === store.state.aiProvider.toolOutputCap) return;

      toolOutputCapStatus.value = 'saving';
      try {
        await store.dispatch('aiProvider/setToolOutputCap', next);
        toolOutputCapStatus.value = 'saved';
        clearTimeout(toolOutputCapSavedResetTimer);
        toolOutputCapSavedResetTimer = setTimeout(() => {
          if (toolOutputCapStatus.value === 'saved') toolOutputCapStatus.value = '';
        }, 2000);
      } catch (error) {
        console.error('Failed to save tool output cap:', error);
        toolOutputCapStatus.value = '';
      }
    };

    const applyToolOutputCapPreset = (value) => {
      toolOutputCapDraft.value = value;
      saveToolOutputCap();
    };

    // ── Max tool runs — same shape as the cap above ─────────────────────
    const maxToolRoundsDraft = ref(store.state.aiProvider.maxToolRounds || 100);
    const maxToolRoundsStatus = ref('');
    let maxToolRoundsSavedResetTimer = null;

    watch(
      () => store.state.aiProvider.maxToolRounds,
      (val) => {
        if (document.activeElement?.id !== 'max-tool-rounds-input') {
          maxToolRoundsDraft.value = val || 100;
        }
      },
    );

    const saveMaxToolRounds = async () => {
      const raw = Number(maxToolRoundsDraft.value);
      const next = Number.isFinite(raw) ? Math.max(1, Math.min(999999, Math.round(raw))) : 100;
      maxToolRoundsDraft.value = next;
      if (next === store.state.aiProvider.maxToolRounds) return;

      maxToolRoundsStatus.value = 'saving';
      try {
        await store.dispatch('aiProvider/setMaxToolRounds', next);
        maxToolRoundsStatus.value = 'saved';
        clearTimeout(maxToolRoundsSavedResetTimer);
        maxToolRoundsSavedResetTimer = setTimeout(() => {
          if (maxToolRoundsStatus.value === 'saved') maxToolRoundsStatus.value = '';
        }, 2000);
      } catch (error) {
        console.error('Failed to save max tool rounds:', error);
        maxToolRoundsStatus.value = '';
      }
    };

    const applyMaxToolRoundsPreset = (value) => {
      maxToolRoundsDraft.value = value;
      saveMaxToolRounds();
    };

    /**
     * All three values, printed in the collapsed header.
     *
     * This is what makes collapsing honest — the drawer hides the CONTROLS, not
     * the information. Nobody should have to expand a section to find out what
     * it is currently set to.
     */
    const limitsSummary = computed(() => {
      const cap = Number(toolOutputCapDraft.value) || 0;
      const capLabel = cap >= 1000 ? `${Math.round(cap / 1000)}k chars` : `${cap} chars`;
      return `${capLabel} · ${Number(maxToolRoundsDraft.value) || 0} rounds · async ${asyncToolsEnabled.value ? 'on' : 'off'}`;
    });

    onUnmounted(() => {
      clearTimeout(savedResetTimer);
      clearTimeout(toolOutputCapSavedResetTimer);
      clearTimeout(maxToolRoundsSavedResetTimer);
    });

    return {
      customInstructionsDraft,
      customInstructionsStatus,
      saveCustomInstructions,
      asyncToolsEnabled,
      toggleAsyncTools,
      toolOutputCapDraft,
      toolOutputCapStatus,
      saveToolOutputCap,
      applyToolOutputCapPreset,
      maxToolRoundsDraft,
      maxToolRoundsStatus,
      saveMaxToolRounds,
      applyMaxToolRoundsPreset,
      limitsSummary,
    };
  },
};
</script>

<style scoped>
.chat-behavior {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

/* ── card 03 · instructions ───────────────────────────────────────────── */
.custom-instructions-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.custom-instructions-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-instructions-header label {
  font-weight: 500;
  width: auto;
  font-size: 0.9em;
}

.info-icon {
  color: var(--color-med-navy);
  font-size: 0.95em;
  cursor: help;
  transition: color 0.15s ease;
}

.info-icon:hover {
  color: var(--color-primary);
}

.custom-instructions-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  background: var(--color-darker-0);
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.9em;
  line-height: 1.5;
  resize: vertical;
  min-height: 96px;
  transition: border-color 0.15s ease;
}

.custom-instructions-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.custom-instructions-textarea::placeholder {
  color: var(--color-med-navy);
  opacity: 0.7;
}

.custom-instructions-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75em;
  color: var(--color-med-navy);
  min-height: 16px;
}

.char-count-warn {
  color: var(--color-yellow);
}

/* One save-status idiom, shared by all three settings. */
.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
}

.status-indicator.saving {
  color: var(--color-med-navy);
}

.status-indicator.saved {
  color: var(--color-green);
}

/* ── card 04 · limits ─────────────────────────────────────────────────── */
.limits-summary {
  font-family: var(--font-family-mono);
  font-size: 0.72em;
  color: var(--color-text-muted);
}

.limits-rows {
  display: flex;
  flex-direction: column;
}

.limits-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-top: 1px solid var(--terminal-border-color);
}

.limits-row:first-child {
  border-top: none;
  padding-top: 0;
}

.limits-row:last-child {
  padding-bottom: 0;
}

.limits-main {
  flex: 1;
  min-width: 0;
}

.limits-control {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.async-tools-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  cursor: default;
  font-size: 0.9em;
}

.async-tools-label label {
  font-weight: 500;
  cursor: default;
}

.experimental-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 0.7em;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-yellow);
  border: 1px solid var(--color-yellow);
  border-radius: 999px;
  background: rgba(255, 215, 0, 0.08);
  line-height: 1;
}

.async-tools-switch {
  position: relative;
  width: 38px;
  height: 22px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 11px;
  background: transparent;
  cursor: pointer;
  padding: 0;
  flex: 0 0 auto;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.async-tools-switch:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.async-tools-switch.is-on {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-med-navy);
  transition: transform 0.18s ease, background-color 0.18s ease;
}

.switch-thumb.is-on {
  transform: translateX(16px);
  background: var(--color-white);
}

.async-tools-help {
  margin: 3px 0 0;
  font-size: 0.75em;
  color: var(--color-med-navy);
  line-height: 1.4;
  max-width: 62ch;
}

.tool-output-cap-input {
  width: 140px;
  padding: 8px 10px;
  background: var(--color-darker-0);
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.9em;
  transition: border-color 0.15s ease;
}

.tool-output-cap-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.tool-output-cap-unit {
  font-size: 0.8em;
  color: var(--color-med-navy);
  white-space: nowrap;
}

.tool-output-cap-presets {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-chip {
  padding: 4px 10px;
  background: transparent;
  color: var(--color-med-navy);
  border: 1px solid var(--terminal-border-color);
  border-radius: 999px;
  font-family: inherit;
  font-size: 0.75em;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.preset-chip:hover {
  color: var(--color-light-med-navy);
  border-color: var(--color-light-med-navy);
}

.preset-chip.active {
  background: rgba(var(--green-rgb), 0.12);
  color: var(--color-green);
  border-color: var(--color-green);
}

@media (max-width: 760px) {
  .limits-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .limits-control {
    justify-content: flex-start;
  }
}
</style>
