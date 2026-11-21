// Reported: a long node name ran past both edges of the node and under its icon.
// The name now shrinks into the room beside the icon, ends in an ellipsis, and
// keeps its full text as a tooltip; label notes still wrap.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Node.vue'), 'utf8');
const rule = (selector) => {
  const at = SRC.indexOf(`\n${selector} {`);
  return at < 0 ? '' : SRC.slice(at, SRC.indexOf('}', at));
};

describe('workflow node text fits its node', () => {
  it('the name shrinks beside the icon, stays on one line and ends in an ellipsis', () => {
    const content = rule('.node-content');
    for (const declaration of ['flex: 1 1 0;', 'min-width: 0;', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;']) {
      expect(content, declaration).toContain(declaration);
    }
    expect(content).not.toContain('fill-available');
    expect(rule('.node-icon')).toContain('flex: none;');
  });

  it('keeps the full name as a tooltip, except while editing and on label notes', () => {
    expect(SRC).toMatch(/class="node-content"\s*v-tooltip="node\.isEditing \|\| node\.type === 'label' \? '' : node\.text \|\| 'Untitled Node'"/);
  });

  it('scrolls while editing, label notes still wrap, and tiny nodes still hide the name', () => {
    expect(rule(".node-content[contenteditable='true']")).toContain('overflow-x: auto;');
    const label = rule('.label-node .node-content');
    expect(label).toContain('overflow: visible;');
    expect(label).toContain('white-space: pre-wrap;');
    expect(rule('.node.tiny-node .node-content')).toContain('flex: 0 0 0;');
  });
});
