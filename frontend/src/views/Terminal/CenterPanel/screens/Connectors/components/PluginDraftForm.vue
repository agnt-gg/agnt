<!-- PluginDraftForm.vue — edit a Plugin Forge draft by hand.

     The Overview's Edit mode: the plugin's name and description, and per tool
     its title, description, input fields and outputs, in plain terms (rules in
     pluginDraftEditing.js). It edits a copy; Save hands back the new manifest
     plus any code files to add or remove, and the Forge writes them through
     the same path the chat's edits take. Code itself stays in the Code tab. -->
<template>
  <form class="draft-form" @submit.prevent="save">
    <fieldset class="draft-section" :disabled="disabled">
      <legend>Plugin</legend>
      <label class="draft-field">
        <span>Name</span>
        <input v-model="draft.displayName" type="text" class="draft-input" data-testid="draft-display-name" />
      </label>
      <label class="draft-field">
        <span>Description</span>
        <textarea v-model="draft.description" rows="2" class="draft-input" placeholder="What it does, in one sentence"></textarea>
      </label>
      <div class="draft-row">
        <label class="draft-field">
          <span>Version</span>
          <input v-model="draft.version" type="text" class="draft-input" />
        </label>
        <div class="draft-field">
          <span>Package name</span>
          <span class="draft-fixed" data-testid="draft-package-name">{{ draft.name }}</span>
        </div>
      </div>
    </fieldset>

    <fieldset v-for="(tool, toolIndex) in draft.tools" :key="tool.key" class="draft-section" :disabled="disabled" :data-tool="tool.type">
      <legend>
        <span>Tool · {{ tool.type }}</span>
        <button v-if="draft.tools.length > 1" type="button" class="draft-link danger" @click="removeTool(toolIndex)">Remove tool</button>
      </legend>
      <label class="draft-field">
        <span>Title</span>
        <input v-model="tool.title" type="text" class="draft-input" />
      </label>
      <label class="draft-field">
        <span>Description</span>
        <textarea v-model="tool.description" rows="2" class="draft-input" placeholder="What the tool does; agents read this to decide when to use it"></textarea>
      </label>

      <div class="draft-subhead">Input fields</div>
      <div v-for="(field, fieldIndex) in tool.fields" :key="field.key" class="draft-item" data-testid="draft-field-row">
        <input v-model="field.name" type="text" class="draft-input name" placeholder="name" aria-label="Field name" />
        <BaseSelect v-model="field.kind" :options="kindOptions" class="kind" />
        <label class="draft-check"><input v-model="field.required" type="checkbox" /> Required</label>
        <button type="button" class="draft-icon" aria-label="Remove field" @click="tool.fields.splice(fieldIndex, 1)"><i class="fas fa-times"></i></button>
        <input v-model="field.description" type="text" class="draft-input wide" placeholder="Hint shown under the field" aria-label="Field description" />
        <input v-if="field.kind === 'select'" v-model="field.options" type="text" class="draft-input wide" placeholder="Choices, separated by commas" aria-label="Choices" />
      </div>
      <button type="button" class="draft-link" data-testid="draft-add-field" @click="tool.fields.push(blankField())"><i class="fas fa-plus"></i> Add field</button>

      <div class="draft-subhead">Outputs</div>
      <div v-for="(output, outputIndex) in tool.outputs" :key="output.key" class="draft-item output">
        <input v-model="output.name" type="text" class="draft-input name" placeholder="name" aria-label="Output name" />
        <BaseSelect v-model="output.type" :options="outputTypeOptions" class="kind" />
        <input v-model="output.description" type="text" class="draft-input grow" placeholder="What it holds" aria-label="Output description" />
        <button type="button" class="draft-icon" aria-label="Remove output" @click="tool.outputs.splice(outputIndex, 1)"><i class="fas fa-times"></i></button>
      </div>
      <button type="button" class="draft-link" @click="tool.outputs.push(blankOutput())"><i class="fas fa-plus"></i> Add output</button>
    </fieldset>

    <div class="draft-add-tool">
      <input v-model="newToolTitle" type="text" class="draft-input" placeholder="New tool's title" :disabled="disabled" aria-label="New tool title" />
      <button type="button" class="draft-link" data-testid="draft-add-tool" :disabled="disabled || !newToolTitle.trim()" @click="addTool"><i class="fas fa-plus"></i> Add tool</button>
    </div>

    <p v-if="disabled" class="draft-note">Annie is editing this plugin. You can edit it again when she has finished.</p>
    <p v-if="problem" class="draft-note bad" role="alert">{{ problem }}</p>
    <div class="draft-actions">
      <BaseButton class="btn-compact" variant="primary" type="submit" :disabled="disabled" data-testid="draft-save">Save changes</BaseButton>
      <button type="button" class="draft-link" @click="$emit('cancel')">Cancel</button>
      <span class="draft-note">Saved changes are a draft until you install them.</span>
    </div>
  </form>
</template>

<script>
import { reactive, ref } from 'vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import {
  FIELD_KINDS,
  OUTPUT_TYPES,
  fieldsFromParameters,
  parametersFromFields,
  outputsFromSchema,
  schemaFromOutputs,
  newTool,
  toolFile,
} from './pluginDraftEditing.js';

let keySeed = 0;
const key = () => `k${++keySeed}`;
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

/** The manifest as the form edits it: tools carry plain rows, plus everything else verbatim. */
function toForm(manifest) {
  const copy = clone(manifest) || {};
  return {
    ...copy,
    displayName: copy.displayName || copy.name || '',
    description: copy.description || '',
    version: copy.version || '1.0.0',
    tools: (copy.tools || []).map((tool) => ({
      key: key(),
      original: tool,
      type: tool.type,
      title: tool.schema?.title || tool.type,
      description: tool.schema?.description || '',
      fields: fieldsFromParameters(tool.schema?.parameters).map((field) => ({ ...field, key: key() })),
      outputs: outputsFromSchema(tool.schema?.outputs).map((output) => ({ ...output, key: key() })),
      code: null, // set for tools added in this form
    })),
  };
}

export default {
  name: 'PluginDraftForm',
  components: { BaseButton, BaseSelect },
  props: {
    manifest: { type: Object, required: true },
    disabled: { type: Boolean, default: false },
  },
  emits: ['save', 'cancel'],
  setup(props, { emit }) {
    const draft = reactive(toForm(props.manifest));
    const originalFiles = (props.manifest.tools || []).map(toolFile).filter(Boolean);
    const newToolTitle = ref('');
    const problem = ref('');

    const kindOptions = FIELD_KINDS.map((kind) => ({ value: kind.id, label: kind.label }));
    const outputTypeOptions = OUTPUT_TYPES.map((type) => ({ value: type, label: type.charAt(0).toUpperCase() + type.slice(1) }));
    const blankField = () => ({ key: key(), name: '', kind: 'text', description: '', required: false, options: '', rest: {} });
    const blankOutput = () => ({ key: key(), name: '', type: 'string', description: '', rest: {} });

    function addTool() {
      const { tool, file, code } = newTool({ ...draft, tools: draft.tools.map((entry) => ({ type: entry.type })) }, newToolTitle.value.trim());
      draft.tools.push({ key: key(), original: tool, type: tool.type, title: tool.schema.title, description: '', fields: [], outputs: outputsFromSchema(tool.schema.outputs).map((o) => ({ ...o, key: key() })), code: { file, content: code } });
      newToolTitle.value = '';
    }
    function removeTool(index) {
      draft.tools.splice(index, 1);
    }

    function save() {
      problem.value = '';
      if (!draft.displayName.trim()) { problem.value = 'Give the plugin a name.'; return; }
      for (const tool of draft.tools) {
        const names = tool.fields.map((field) => field.name.trim()).filter(Boolean);
        const duplicate = names.find((name, index) => names.indexOf(name) !== index);
        if (duplicate) { problem.value = `${tool.title}: two fields are named "${duplicate}".`; return; }
        if (tool.fields.some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name.trim()) && field.name.trim())) {
          problem.value = `${tool.title}: field names use letters, numbers and _ only, and start with a letter.`;
          return;
        }
      }
      const { tools: formTools, ...rest } = draft;
      const manifest = {
        ...rest,
        displayName: draft.displayName.trim(),
        description: draft.description.trim(),
        version: draft.version.trim() || '1.0.0',
        tools: formTools.map((tool) => ({
          ...tool.original,
          schema: {
            ...(tool.original.schema || {}),
            title: tool.title.trim() || tool.type,
            description: tool.description.trim(),
            parameters: parametersFromFields(tool.fields),
            outputs: schemaFromOutputs(tool.outputs),
          },
        })),
      };
      const kept = new Set(manifest.tools.map(toolFile));
      const addFiles = Object.fromEntries(formTools.filter((tool) => tool.code).map((tool) => [tool.code.file, tool.code.content]));
      const removeFiles = originalFiles.filter((file) => !kept.has(file));
      emit('save', { manifest, addFiles, removeFiles });
    }

    return { draft, newToolTitle, problem, kindOptions, outputTypeOptions, blankField, blankOutput, addTool, removeTool, save };
  },
};
</script>

<style scoped>
.draft-form { display: flex; flex-direction: column; gap: 16px; width: 100%; }
.draft-section { border: 1px solid var(--terminal-border-color); border-radius: 10px; padding: 12px 14px 14px; margin: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0; width: 100%; box-sizing: border-box; }
/* Fixed after creation: installed copies are keyed by it. */
.draft-fixed { padding: 7px 0; font-size: 13px; color: var(--text-primary); font-family: var(--font-mono, monospace); }
.draft-section legend { padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; }
.draft-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); flex: 1; min-width: 0; }
.draft-row { display: flex; gap: 10px; }
.draft-input { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--terminal-border-color); border-radius: 7px; background: var(--color-darker-0); color: var(--text-primary); font: inherit; font-size: 13px; }
.draft-input:disabled { opacity: 0.6; }
.draft-input::placeholder { color: var(--text-secondary); opacity: 0.55; }
.draft-subhead { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-top: 4px; }
/* One line per field: name | kind | required | remove; its hint (and choices) below, full width. */
.draft-item { display: grid; grid-template-columns: minmax(0, 1fr) 130px auto auto; align-items: center; gap: 6px 8px; padding: 8px; border: 1px dashed var(--terminal-border-color); border-radius: 8px; }
.draft-item .wide { grid-column: 1 / -1; }
/* Outputs: name | type | description | remove. */
.draft-item.output { grid-template-columns: minmax(0, 1fr) 110px minmax(0, 2fr) auto; }
.draft-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.draft-icon { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 4px 6px; }
.draft-icon:hover { color: var(--text-primary); }
.draft-link { align-self: flex-start; border: none; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; padding: 2px 0; }
.draft-link:hover:not(:disabled) { color: var(--text-primary); }
.draft-link:disabled { opacity: 0.5; cursor: default; }
.draft-link.danger { margin-left: auto; }
.draft-add-tool { display: flex; gap: 8px; align-items: center; }
.draft-add-tool .draft-input { max-width: 260px; }
.draft-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.draft-note { margin: 0; font-size: 12px; color: var(--text-secondary); }
.draft-note.bad { color: var(--color-red, #d33); }
</style>
