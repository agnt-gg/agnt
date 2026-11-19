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
    // AGNT One: New Chat sits in the panel header beside the count; the
    // segment owns the toolbar row. The label still collapses when narrow.
    expect(template).toMatch(/<button[^>]*v-tooltip="'New chat \(⌘N\)'"[^>]*class="new-chat-btn header-new"/);
    expect(template).toMatch(/<span class="new-chat-label">New<\/span>/);
    expect(template).toMatch(/class="view-seg"/);
    expect(style).toMatch(/\.sort-controls\s*{[^}]*flex-wrap:\s*nowrap;/s);
    expect(style).toMatch(/container-type:\s*inline-size;/);
    expect(style).toMatch(/@container[^\{]*\(max-width:[^)]+\)[\s\S]*?\.new-chat-label\s*{[^}]*display:\s*none;/s);
  });
});

describe('chats in AGNT One\'s sidebar (variant="drawer")', () => {
  it('starts a group\'s chats flush with the group header, not indented under its name', () => {
    const rules = [...style.matchAll(/\.is-drawer \.group-items\s*{([^}]*)}/g)].map((m) => m[1]);
    expect(rules.join('')).toMatch(/margin:\s*0;/);
    for (const body of rules) expect(body).not.toMatch(/margin(-left)?:[^;]*[1-9]\d*px/);
  });
});
