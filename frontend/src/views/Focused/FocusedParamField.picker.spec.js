// The field picker on a step setting (2026-10-21): focus a text setting, the
// earlier steps' fields appear, a click inserts {{step.field}} at the cursor.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FocusedParamField from './FocusedParamField.vue';

const insertables = [
  { id: 't', number: 1, name: 'Every Morning', fields: [{ key: 'firedAt', token: '{{everyMorning.firedAt}}', type: 'string', description: '', sample: '2026-10-21' }] },
  { id: 'a', number: 2, name: 'Get Weather', fields: [{ key: 'summary', token: '{{getWeather.summary}}', type: 'string', description: '', sample: '' }] },
];
const mountField = (props) => mount(FocusedParamField, { props: { name: 'subject', modelValue: 'Weather: ', insertables, ...props }, global: { directives: { tooltip: {} } }, attachTo: document.body });

describe('FocusedParamField field picker', () => {
  it('opens on focus with every earlier step and field, and its last value', async () => {
    const w = mountField();
    expect(w.find('[data-testid="field-picker"]').exists()).toBe(false);
    await w.find('input').trigger('focus');
    const picker = w.find('[data-testid="field-picker"]');
    expect(picker.findAll('.focused-field-group-head').map((h) => h.text())).toEqual(['1Every Morning', '2Get Weather']);
    expect(picker.find('[data-token="{{everyMorning.firedAt}}"]').text()).toContain('2026-10-21');
    w.unmount();
  });

  it('a click inserts the reference at the cursor, keeping the text around it', async () => {
    const w = mountField();
    const input = w.find('input');
    await input.trigger('focus');
    input.element.setSelectionRange(9, 9); // after "Weather: "
    await w.find('[data-token="{{getWeather.summary}}"]').trigger('click');
    expect(w.emitted('update:modelValue').at(-1)).toEqual(['Weather: {{getWeather.summary}}']);
    w.unmount();
  });

  it('is not offered on the first step, read-only steps, or non-text settings', async () => {
    for (const props of [{ insertables: [] }, { readOnly: true }, { modelValue: 5 }, { modelValue: true }, { options: ['a', 'b'], modelValue: 'a' }]) {
      const w = mountField(props);
      expect(w.find('[data-action="insert-field"]').exists(), JSON.stringify(props)).toBe(false);
      w.unmount();
    }
  });
});
