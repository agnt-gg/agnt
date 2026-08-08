import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = path.resolve(
  process.cwd(),
  'src/views/Terminal/LeftPanel/types/ChatPanel/components/OutputList.vue'
);
const source = fs.readFileSync(componentPath, 'utf8');
const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? '';
const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';

describe('saved-chat toolbar narrow-width layout', () => {
  it('lets New Chat wrap below the sort controls instead of overlapping Date', () => {
    expect(template).toMatch(/<button[^>]*v-tooltip="'New Chat'"[^>]*class="new-chat-btn"/);
    expect(style).toMatch(/\.sort-controls\s*{[^}]*flex-wrap:\s*wrap;/s);
    expect(style).toMatch(/\.new-chat-btn\s*{[^}]*white-space:\s*nowrap;/s);
  });
});
