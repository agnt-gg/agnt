import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PluginDraftForm from './PluginDraftForm.vue';

const MANIFEST = {
  name: 'weather-plugin',
  displayName: 'Weather',
  version: '1.0.0',
  description: 'Weather lookups',
  permissions: { capabilities: ['network'], domains: ['api.weather.test'] },
  tools: [
    {
      type: 'get-weather',
      entryPoint: './get-weather.js',
      schema: { title: 'Get weather', category: 'action', type: 'get-weather', authRequired: 'apiKey', authProvider: 'weather', parameters: { city: { type: 'string', inputType: 'text', required: true } }, outputs: { success: { type: 'boolean' } } },
    },
  ],
};

const mountForm = (props = {}) =>
  mount(PluginDraftForm, {
    props: { manifest: MANIFEST, ...props },
    global: { stubs: { BaseSelect: { props: ['modelValue', 'options'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>' } } },
  });

describe('PluginDraftForm: building a plugin by hand', () => {
  it('adds a field and saves a manifest that keeps everything it does not edit', async () => {
    const w = mountForm();
    await w.find('[data-testid="draft-add-field"]').trigger('click');
    const rows = w.findAll('[data-testid="draft-field-row"]');
    expect(rows).toHaveLength(2);
    await rows[1].find('input[aria-label="Field name"]').setValue('units');
    await rows[1].find('select').setValue('select');
    await w.find('input[aria-label="Choices"]').setValue('metric, imperial');
    await w.find('form').trigger('submit');

    const [{ manifest, addFiles, removeFiles }] = w.emitted('save')[0];
    expect(manifest.tools[0].schema.parameters).toEqual({
      city: { type: 'string', inputType: 'text', required: true },
      units: { type: 'string', inputType: 'select', options: ['metric', 'imperial'] },
    });
    // Untouched: permissions, the sign-in, the entry point, the package name.
    expect(manifest.permissions).toEqual(MANIFEST.permissions);
    expect(manifest.tools[0]).toMatchObject({ entryPoint: './get-weather.js', schema: { authProvider: 'weather', authRequired: 'apiKey' } });
    expect(manifest.name).toBe('weather-plugin');
    expect(addFiles).toEqual({});
    expect(removeFiles).toEqual([]);
  });

  it('adds a tool with its own code file, and removing a tool removes its file', async () => {
    const w = mountForm();
    await w.find('input[aria-label="New tool title"]').setValue('Get forecast');
    await w.find('[data-testid="draft-add-tool"]').trigger('click');
    await w.find('form').trigger('submit');
    let [{ manifest, addFiles }] = w.emitted('save')[0];
    expect(manifest.tools.map((t) => t.type)).toEqual(['get-weather', 'get-forecast']);
    expect(Object.keys(addFiles)).toEqual(['get-forecast.js']);

    const w2 = mountForm();
    await w2.find('[data-testid="draft-add-tool"]').element; // no-op: one tool has no Remove button
    expect(w2.find('.draft-link.danger').exists()).toBe(false);
    const two = { ...MANIFEST, tools: [...MANIFEST.tools, { type: 'b', entryPoint: './b.js', schema: { title: 'B' } }] };
    const w3 = mountForm({ manifest: two });
    await w3.findAll('.draft-link.danger')[1].trigger('click');
    await w3.find('form').trigger('submit');
    ({ manifest } = w3.emitted('save')[0][0]);
    expect(manifest.tools.map((t) => t.type)).toEqual(['get-weather']);
    expect(w3.emitted('save')[0][0].removeFiles).toEqual(['b.js']);
  });

  it('refuses a duplicate or malformed field name, and says why', async () => {
    const w = mountForm();
    await w.find('[data-testid="draft-add-field"]').trigger('click');
    await w.findAll('input[aria-label="Field name"]')[1].setValue('city');
    await w.find('form').trigger('submit');
    expect(w.emitted('save')).toBeUndefined();
    expect(w.find('[role="alert"]').text()).toContain('two fields are named "city"');
    await w.findAll('input[aria-label="Field name"]')[1].setValue('two words');
    await w.find('form').trigger('submit');
    expect(w.find('[role="alert"]').text()).toContain('letters, numbers and _');
  });

  it('is read-only while Annie is editing the same plugin', () => {
    const w = mountForm({ disabled: true });
    expect(w.findAll('fieldset').every((f) => f.attributes('disabled') !== undefined)).toBe(true);
    expect(w.text()).toContain('Annie is editing this plugin');
  });
});
