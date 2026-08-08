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
  it('keeps the toolbar on one row and collapses New Chat to its plus icon', () => {
    expect(template).toMatch(/<button[^>]*v-tooltip="'New Chat'"[^>]*class="new-chat-btn"/);
    expect(template).toMatch(/<span class="new-chat-label">New Chat<\/span>/);
    expect(style).toMatch(/\.sort-controls\s*{[^}]*flex-wrap:\s*nowrap;/s);
    expect(style).toMatch(/container-type:\s*inline-size;/);
    expect(style).toMatch(/@container[^\{]*\(max-width:[^)]+\)[\s\S]*?\.new-chat-label\s*{[^}]*display:\s*none;/s);
  });
});
