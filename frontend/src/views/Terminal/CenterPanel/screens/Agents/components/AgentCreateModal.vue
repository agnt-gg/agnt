<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="close" @keydown.esc.stop="close">
      <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="agent-create-title">
        <div class="modal-header">
          <h3 id="agent-create-title">New agent</h3>
          <button class="modal-close-btn" type="button" aria-label="Close" @click="close"><i class="fas fa-times"></i></button>
        </div>

        <!-- Never a blank page: pick a starting point, then adjust. -->
        <div class="quickstarts" role="radiogroup" aria-label="Start from">
          <span class="modal-label">Start from</span>
          <button
            v-for="template in quickstarts"
            :key="template.id"
            type="button"
            role="radio"
            class="quickstart"
            :class="{ active: templateId === template.id }"
            :aria-checked="templateId === template.id"
            v-tooltip="template.description"
            @click="applyTemplate(template.id)"
          >
            <i :class="template.icon" aria-hidden="true"></i>{{ template.name }}
          </button>
          <button type="button" role="radio" class="quickstart" :class="{ active: !templateId }" :aria-checked="!templateId" @click="applyTemplate(null)">
            <i class="far fa-file" aria-hidden="true"></i>Blank
          </button>
        </div>

        <div class="modal-body two-col">
          <div class="modal-col">
            <div class="identity">
              <button type="button" class="avatar" :aria-label="form.avatar ? 'Change avatar' : 'Add an avatar'" @click="fileInput?.click()">
                <img v-if="form.avatar" :src="form.avatar" alt="" />
                <i v-else class="fas fa-camera" aria-hidden="true"></i>
              </button>
              <input ref="fileInput" type="file" accept="image/*" hidden @change="onAvatarPicked" />
              <div class="identity-name">
                <label class="modal-label" for="agent-create-name">Name</label>
                <input id="agent-create-name" ref="nameInput" v-model="form.name" class="text-input" placeholder="e.g. Research Analyst" maxlength="80" @keydown.ctrl.enter="submit" />
                <button v-if="form.avatar" type="button" class="link-btn" @click="form.avatar = null">Remove avatar</button>
              </div>
            </div>

            <label class="modal-label" for="agent-create-description">What it does <span class="optional">(optional)</span></label>
            <textarea id="agent-create-description" v-model="form.description" class="goal-input compact" rows="2" placeholder="One line people will see on its card"></textarea>

            <label class="modal-label" for="agent-create-instructions">Instructions <span class="optional">(optional)</span></label>
            <textarea id="agent-create-instructions" v-model="form.systemPrompt" class="goal-input" rows="6" placeholder="How it should behave, what to prioritise, what never to do" @keydown.ctrl.enter="submit"></textarea>
          </div>

          <div class="modal-col">
            <span class="modal-label">Model</span>
            <div class="model-row">
              <span class="model-chip" :class="{ muted: !form.provider }">{{ form.provider ? form.provider + ' · ' + (form.model || 'default') : 'Your default model' }}</span>
              <button v-if="form.provider" type="button" class="link-btn" @click="form.provider = ''; form.model = ''">Use default</button>
            </div>
            <ProviderModelSearch :apply-globally="false" placeholder="Search a specific model…" @selected="(pick) => { form.provider = pick.provider; form.model = pick.model || ''; }" />

            <span class="modal-label">Tools <span class="optional">{{ form.tools.length }} selected</span></span>
            <ListWithSearch v-model="form.tools" :items="tools" label-key="title" id-key="id" placeholder="Search tools…" empty-message="No tools selected" />

            <span class="modal-label">Skills <span class="optional">{{ form.skills.length }} selected</span></span>
            <ListWithSearch v-model="form.skills" :items="skills" label-key="name" id-key="id" placeholder="Search skills…" empty-message="No skills selected" />
          </div>
        </div>

        <div class="modal-footer">
          <span v-if="error" class="modal-error" role="alert">{{ error }}</span>
          <span v-else class="modal-hint">Ctrl+Enter to create · Esc to close</span>
          <div class="modal-actions">
            <button class="modal-btn modal-cancel" type="button" @click="close">Cancel</button>
            <button class="modal-btn create" type="button" :disabled="!form.name.trim() || saving" @click="submit">
              <i :class="saving ? 'fas fa-spinner fa-spin' : 'fas fa-plus'" aria-hidden="true"></i>
              {{ saving ? 'Creating…' : 'Create agent' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, reactive, ref, watch } from 'vue';
import { useStore } from 'vuex';
import ListWithSearch from '@/views/Terminal/_components/ListWithSearch.vue';
import ProviderModelSearch from '@/components/common/ProviderModelSearch.vue';
import { readAvatarFile } from '@/utils/avatarImage.js';
import { AGENT_QUICKSTARTS, quickstartDraft } from '../agentQuickstarts.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  /** Template to pre-select when the modal opens (e.g. from the right panel). */
  initialTemplate: { type: String, default: null },
  tools: { type: Array, default: () => [] },
  skills: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'created']);

const store = useStore();
const quickstarts = AGENT_QUICKSTARTS;
const fileInput = ref(null);
const nameInput = ref(null);
const templateId = ref(null);
const saving = ref(false);
const error = ref('');
const blank = () => ({ name: '', description: '', systemPrompt: '', avatar: null, provider: '', model: '', tools: [], skills: [] });
const form = reactive(blank());

function applyTemplate(id) {
  templateId.value = id;
  const template = quickstarts.find((t) => t.id === id);
  // Identity and model survive a template switch; the job description does not.
  const keep = { avatar: form.avatar, provider: form.provider, model: form.model };
  Object.assign(form, blank(), keep, template ? quickstartDraft(template, props.tools) : {});
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    error.value = '';
    saving.value = false;
    Object.assign(form, blank());
    applyTemplate(props.initialTemplate);
    await nextTick();
    nameInput.value?.focus();
  },
  { immediate: true },
);

async function onAvatarPicked(event) {
  const [file] = event.target.files || [];
  event.target.value = '';
  if (!file) return;
  try {
    form.avatar = await readAvatarFile(file);
    error.value = '';
  } catch (e) {
    error.value = e.message;
  }
}

function close() {
  if (!saving.value) emit('close');
}

async function submit() {
  if (!form.name.trim() || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const data = await store.dispatch('agents/createAgent', {
      name: form.name.trim(),
      description: form.description.trim(),
      systemPrompt: form.systemPrompt.trim(),
      avatar: form.avatar,
      provider: form.provider,
      model: form.model,
      assignedTools: [...form.tools],
      assignedSkills: [...form.skills],
      assignedWorkflows: [],
    });
    emit('created', data?.agent || null);
  } catch (e) {
    error.value = `Could not create the agent: ${e.message}`;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
/* Frame and fields match the Goals "Create New Goal" modal. */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}
.modal-container {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 920px;
  max-width: 94vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.modal-header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 600;
}
.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 0.9em;
}
.modal-close-btn:hover {
  color: var(--color-text);
}

.quickstarts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 14px 20px 4px;
}
.quickstarts .modal-label {
  margin: 0 4px 0 0;
}
.quickstart {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 999px;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.85em;
  cursor: pointer;
}
.quickstart i {
  font-size: 0.9em;
}
.quickstart:hover {
  color: var(--color-text);
}
.quickstart.active {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.5);
  background: rgba(var(--primary-rgb), 0.08);
}

.modal-body.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
  padding: 14px 20px 18px;
}
.modal-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.modal-label {
  display: block;
  font-size: 0.78em;
  color: var(--color-text-muted);
  margin-top: 6px;
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.modal-label .optional {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  opacity: 0.7;
  margin-left: 4px;
}

.identity {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.avatar {
  width: 68px;
  height: 68px;
  flex-shrink: 0;
  margin-top: 8px;
  border-radius: 50%;
  border: 1px dashed var(--terminal-border-color);
  background: var(--color-darker-0);
  color: var(--color-text-muted);
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: pointer;
}
.avatar:hover {
  border-color: rgba(var(--primary-rgb), 0.6);
  color: var(--color-primary);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.identity-name {
  flex: 1;
  min-width: 0;
}

.text-input,
.goal-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-family: inherit;
  transition: border-color 0.2s ease;
}
.text-input {
  padding: 8px 12px;
  font-size: 0.9em;
}
.goal-input {
  padding: 10px 14px;
  font-size: 0.92em;
  resize: vertical;
  min-height: 84px;
}
.goal-input.compact {
  min-height: 52px;
}
.text-input:focus,
.goal-input:focus {
  outline: none;
  border-color: rgba(var(--primary-rgb), 0.5);
}

.model-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.model-chip {
  font-size: 0.85em;
  color: var(--color-text);
}
.model-chip.muted {
  color: var(--color-text-muted);
}
.link-btn {
  border: 0;
  background: none;
  padding: 2px 0;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.8em;
  text-decoration: underline;
  cursor: pointer;
}
.link-btn:hover {
  color: var(--color-text);
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--terminal-border-color);
}
.modal-hint {
  font-size: 0.75em;
  color: var(--color-text-muted);
  opacity: 0.7;
}
.modal-error {
  font-size: 0.8em;
  color: var(--color-red);
}
.modal-actions {
  display: flex;
  gap: 8px;
}
.modal-btn {
  padding: 7px 16px;
  border-radius: 4px;
  font-size: 0.88em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.modal-cancel {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}
.modal-cancel:hover {
  color: var(--color-text);
}
.modal-btn.create {
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  color: var(--color-primary);
}
.modal-btn.create:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.2);
}
.modal-btn.create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 760px) {
  .modal-body.two-col {
    grid-template-columns: 1fr;
  }
}
</style>
