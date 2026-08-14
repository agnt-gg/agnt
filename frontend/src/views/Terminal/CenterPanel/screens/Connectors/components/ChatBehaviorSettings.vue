<template>
  <div class="chat-behavior">
    <!-- Custom instructions -->
    <div class="behavior-section">
      <div class="section-header">
        <div class="section-header-row">
          <h3>Custom Instructions</h3>
          <span v-if="customInstructionsStatus === 'saving'" class="status-indicator saving">Saving…</span>
          <span v-else-if="customInstructionsStatus === 'saved'" class="status-indicator saved">
            <i class="fas fa-check"></i> Saved
          </span>
        </div>
        <p class="subtitle">Appended to Annie's system prompt in every orchestrator chat. Takes effect on new chats.</p>
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
        <span class="char-count" :class="{ 'char-count-warn': customInstructionsDraft.length > 9000 }">
          {{ customInstructionsDraft.length }} / 10000
        </span>
      </div>
    </div>

    <!--
      Limits & execution.

      None of these is actually about PROVIDERS — they govern every chat surface
      in the app, and sit on this page only because that is where they were
      added. Left here rather than moved, because moving them is a product
      decision, not a styling one.
    -->
    <div class="behavior-section">
      <div class="section-header">
        <h3>Limits &amp; Execution</h3>
        <p class="subtitle">Guardrails applied to every chat, agent, workflow and tool run.</p>
      </div>

      <div class="limits-rows">
        <!-- Async tool execution -->
        <div class="limits-row">
          <div class="limits-main">
            <div class="limits-label">
              <span>Async tool execution</span>
              <span class="experimental-badge">Experimental</span>
              <Tooltip
                title="Background &amp; scheduled tool calls (experimental)"
                text="Off by default. When on, Annie can run tools in the background, schedule recurring tasks, and delay actions (e.g. 'do this in 15 seconds'). The capability is still being hardened — turn it on if you want to try it. With it off, every tool call runs synchronously, just like a normal chat. Takes effect on new chats."
              >
                <i class="fas fa-info-circle info-icon"></i>
              </Tooltip>
            </div>
            <p class="limits-help">
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
            <div class="limits-label">
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
            <p class="limits-help">Raise it if large file reads keep getting truncated.</p>
          </div>
          <div class="limits-control">
            <div class="preset-chips">
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
            <span class="limits-unit">chars (~{{ Math.round((Number(toolOutputCapDraft) || 0) / 4 / 1000) }}k tokens)</span>
          </div>
        </div>

        <!-- Max tool runs -->
        <div class="limits-row">
          <div class="limits-main">
            <div class="limits-label">
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
            <p class="limits-help">Tool-loop rounds allowed in a single turn before the loop is forced to end.</p>
          </div>
          <div class="limits-control">
            <div class="preset-chips">
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
            <span class="limits-unit">rounds per turn</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

/**
 * ChatBehaviorSettings — the Custom Instructions and Limits sections.
 *
 * WHY THESE LEFT ProviderSelector
 * ───────────────────────────────
 * They were never about providers. Custom instructions, async tools, the tool
 * output cap and the tool-round limit govern EVERY chat surface in the app;
 * they lived in the provider component only because that is where they happened
 * to be added. Keeping them there forced one component to own four unrelated
 * concerns and made the page impossible to order by importance.
 *
 * Both sections use the page's existing section idiom verbatim
 * (.connectors-section + .webhooks-header/h3 + .subtitle): transparent, no
 * border, 24px padding.
 */
export default {
  name: 'ChatBehaviorSettings',
  components: { Tooltip },
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
    };
  },
};
</script>

<style scoped>
/* Two sections, spaced by the same 16px the .connectors-grid uses. */
.chat-behavior {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

/* Verbatim .connectors-section, the section idiom every other block on this
   page uses. Transparent and borderless is the house style, not an omission. */
.behavior-section {
  background: transparent;
  border: none;
  padding: 24px;
  transition: all 0.3s ease;
  border-radius: 16px;
  width: 100%;
  box-sizing: border-box;
}

/* Verbatim .webhooks-header / .plugins-header and their h3 + .subtitle. */
.section-header {
  margin-bottom: 24px;
}

.section-header-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-header h3 {
  margin: 0 0 8px 0;
  font-size: 1.5em;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-header-row h3 {
  margin: 0 0 8px 0;
}

.subtitle {
  margin: 0;
  color: var(--color-light-med-navy);
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

/* ── custom instructions ──────────────────────────────────────────────── */
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
  justify-content: flex-end;
  align-items: center;
  margin-top: 6px;
  font-size: 0.75em;
  color: var(--color-med-navy);
  min-height: 16px;
}

.char-count-warn {
  color: var(--color-yellow);
}

/* ── limits ───────────────────────────────────────────────────────────── */
.limits-rows {
  display: flex;
  flex-direction: column;
}

.limits-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-top: 1px dashed var(--terminal-border-color);
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

.limits-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  cursor: default;
  font-size: 0.9em;
}

.limits-label label {
  font-weight: 500;
  cursor: default;
}

.limits-help {
  margin: 3px 0 0;
  font-size: 0.75em;
  color: var(--color-med-navy);
  line-height: 1.4;
  max-width: 62ch;
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

.limits-unit {
  font-size: 0.8em;
  color: var(--color-med-navy);
  white-space: nowrap;
}

.preset-chips {
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
