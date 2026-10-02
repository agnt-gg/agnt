import { describe, it, expect } from 'vitest';
import { isWidgetContentChange } from './widgetProvenance.js';

const stored = {
  source_code: '<html>v1</html>',
  config: JSON.stringify({ refresh: 5 }),
  data_bindings: JSON.stringify([{ source: 'agents' }]),
};

describe('isWidgetContentChange (PRD-057 user-modified flag)', () => {
  it('metadata-only writes are not edits (placing on a canvas froze plugin widgets forever)', () => {
    expect(isWidgetContentChange(stored, { thumbnail: 'data:image/jpeg;base64,AAA' })).toBe(false);
    expect(isWidgetContentChange(stored, { default_size: { cols: 4, rows: 7 }, min_size: { cols: 3, rows: 5 } })).toBe(false);
    expect(isWidgetContentChange(stored, { name: 'Renamed', icon: 'fas fa-star', category: 'dashboard' })).toBe(false);
    expect(isWidgetContentChange(stored, {})).toBe(false);
  });

  it('resending identical content is not an edit', () => {
    expect(isWidgetContentChange(stored, {
      source_code: '<html>v1</html>', config: { refresh: 5 }, data_bindings: [{ source: 'agents' }],
    })).toBe(false);
  });

  it('a changed source, config or data binding is an edit', () => {
    expect(isWidgetContentChange(stored, { source_code: '<html>v2</html>' })).toBe(true);
    expect(isWidgetContentChange(stored, { config: { refresh: 10 } })).toBe(true);
    expect(isWidgetContentChange(stored, { data_bindings: [{ source: 'workflows' }] })).toBe(true);
  });

  it('fields the update leaves untouched (null / absent / falsy) are not edits', () => {
    expect(isWidgetContentChange(stored, { source_code: null, config: null, data_bindings: undefined })).toBe(false);
    expect(isWidgetContentChange({ source_code: null }, { config: '' })).toBe(false);
  });

  it('a first source on an empty row is an edit', () => {
    expect(isWidgetContentChange({ source_code: null }, { source_code: '<p>hi</p>' })).toBe(true);
    expect(isWidgetContentChange(undefined, { source_code: '<p>hi</p>' })).toBe(true);
  });
});
