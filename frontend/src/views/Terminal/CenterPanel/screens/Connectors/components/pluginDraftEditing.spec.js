/**
 * Building a plugin by hand in the Plugin Forge (reported 2026-10-21: "is
 * there not a way to manually build a plugin? how do I add fields?").
 * The rules the Edit form and "Start from scratch" rely on.
 */
import { describe, it, expect } from 'vitest';
import {
  slugify,
  fieldsFromParameters,
  parametersFromFields,
  outputsFromSchema,
  schemaFromOutputs,
  newTool,
  blankDraft,
  toolFile,
  toolCodeStub,
} from './pluginDraftEditing.js';

describe('fields: plain rows to manifest parameters and back', () => {
  const parameters = {
    city: { type: 'string', inputType: 'text', description: 'Which city', required: true },
    units: { type: 'string', inputType: 'select', options: ['metric', 'imperial'], default: 'metric' },
    days: { type: 'number', inputType: 'number', conditional: { field: 'units', value: 'metric' } },
    verbose: { type: 'boolean', inputType: 'checkbox' },
  };

  it('round-trips without losing what the form does not show (defaults, conditions)', () => {
    expect(parametersFromFields(fieldsFromParameters(parameters))).toEqual(parameters);
  });

  it('reads each kind in plain terms', () => {
    expect(fieldsFromParameters(parameters).map((f) => [f.name, f.kind, f.options])).toEqual([
      ['city', 'text', ''],
      ['units', 'select', 'metric, imperial'],
      ['days', 'number', ''],
      ['verbose', 'checkbox', ''],
    ]);
  });

  it('writes a new field, a choice list, and drops blank or duplicate names', () => {
    const out = parametersFromFields([
      { name: 'q', kind: 'textarea', description: ' Ask ', required: true, options: '', rest: {} },
      { name: 'mode', kind: 'select', description: '', required: false, options: 'fast, , slow', rest: {} },
      { name: '', kind: 'text', description: '', required: false, options: '', rest: {} },
      { name: 'q', kind: 'number', description: '', required: false, options: '', rest: {} },
    ]);
    expect(out).toEqual({
      q: { type: 'string', inputType: 'textarea', description: 'Ask', required: true },
      mode: { type: 'string', inputType: 'select', options: ['fast', 'slow'] },
    });
  });

  it('a field changed from choice to text loses its choices', () => {
    const [row] = fieldsFromParameters({ units: parameters.units });
    expect(parametersFromFields([{ ...row, kind: 'text' }]).units).toEqual({ type: 'string', inputType: 'text', default: 'metric' });
  });

  it('outputs round-trip too', () => {
    const outputs = { success: { type: 'boolean', description: 'ok?' }, data: { type: 'object', items: 'x' } };
    expect(schemaFromOutputs(outputsFromSchema(outputs))).toEqual(outputs);
  });
});

describe('new tools and blank plugins', () => {
  it('a new tool gets an unused type, a matching code file and entryPoint', () => {
    const manifest = { tools: [{ type: 'get-weather' }] };
    const { tool, file, code } = newTool(manifest, 'Get Weather');
    expect(tool.type).toBe('get-weather-2');
    expect(tool.schema.type).toBe(tool.type);
    expect(file).toBe('get-weather-2.js');
    expect(toolFile(tool)).toBe(file);
    expect(code).toContain("this.name = 'get-weather-2'");
    expect(code).toContain('export default new');
  });

  it('"Start from scratch" is a complete, installable draft', () => {
    const { manifest, files, packageJson } = blankDraft('Weather Helper');
    expect(manifest).toMatchObject({ name: 'weather-helper', displayName: 'Weather Helper', version: '1.0.0', permissions: { capabilities: [], domains: [] } });
    expect(manifest.tools).toHaveLength(1);
    expect(Object.keys(files)).toEqual([toolFile(manifest.tools[0])]);
    expect(packageJson).toMatchObject({ type: 'module', main: toolFile(manifest.tools[0]) });
  });

  it('the stub is a valid ES module that returns from execute', async () => {
    const code = toolCodeStub('echo-tool', 'Echo');
    const mod = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`);
    expect(mod.default.name).toBe('echo-tool');
    expect(await mod.default.execute({ a: 1 })).toEqual({ success: true, result: { a: 1 } });
  });

  it('slugs are kebab-case and never empty', () => {
    expect(slugify('My Weather Tool!')).toBe('my-weather-tool');
    expect(slugify('***')).toBe('my-plugin');
  });
});
