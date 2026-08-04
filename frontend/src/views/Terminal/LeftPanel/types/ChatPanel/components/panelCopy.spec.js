import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'OutputList.vue'), 'utf8');

/**
 * The rows in this panel are the user's CHATS. "Output" is the name of the
 * database table they happen to be stored in (content_outputs), and the panel
 * had drifted into showing that name to the user — a header reading "Saved
 * Outputs", a search box reading "Search outputs...", and a delete dialog that
 * called the very same row an "Output" in one path and a "Conversation" in
 * another. Three names for one thing, none of them the one the user uses.
 *
 * Internal identifiers (OutputList, contentOutputs/*, visibleOutputs, the API
 * routes) are deliberately NOT in scope: they name the storage layer correctly
 * and renaming them would be churn. What must never happen again is the
 * storage layer's noun reaching the screen, so this asserts on the strings the
 * user can actually read and nothing else.
 */
const FORBIDDEN = /\boutputs?\b/i;

/**
 * Strip the parts of a string that are code rather than copy: `{{ expr }}` in
 * templates and `${expr}` in template literals. Without this, an entirely
 * correct message like `Failed to archive ${output.archived_at ...} chat`
 * reads as an offender because the EXPRESSION mentions `output` — and a guard
 * that fires on correct code gets deleted rather than obeyed.
 */
function copyOnly(text) {
  return text.replace(/\{\{[^}]*\}\}/g, '').replace(/\$\{[^}]*\}/g, '').trim();
}

/** Text the user reads, extracted from the template block. */
function templateCopy(vue) {
  const template = vue.slice(vue.indexOf('<template>'), vue.lastIndexOf('</template>'));
  const strings = [];

  // Text nodes between tags, minus mustache interpolations (those render data,
  // not copy) and minus HTML comments (developer notes, not user-facing).
  const withoutComments = template.replace(/<!--[\s\S]*?-->/g, '');
  for (const [, text] of withoutComments.matchAll(/>([^<>]+)</g)) {
    const literal = copyOnly(text);
    if (literal) strings.push(literal);
  }

  // Attributes that render as visible or assistive text. Bound attributes
  // (:title, v-tooltip="expr") are expressions, so only static ones count.
  for (const [, , value] of withoutComments.matchAll(
    /\s(placeholder|title|aria-label|alt|text)="([^"]*)"/g,
  )) {
    const literal = copyOnly(value);
    if (literal) strings.push(literal);
  }

  // v-tooltip takes an expression, but the overwhelmingly common form is a
  // single-quoted literal — which is copy, and was where one stale noun hid.
  for (const [, value] of withoutComments.matchAll(/v-tooltip="'([^']*)'"/g)) {
    const literal = copyOnly(value);
    if (literal) strings.push(literal);
  }

  return strings;
}

/** Modal and toast copy, extracted from the script block. */
function dialogCopy(vue) {
  const script = vue.slice(vue.indexOf('<script>'), vue.lastIndexOf('</script>'));
  const strings = [];
  // Group 1 is the opening quote, group 2 the body — the backreference keeps a
  // single-quoted string from swallowing the next double-quoted one.
  for (const match of script.matchAll(
    /\b(?:title|message|confirmText|cancelText|placeholder)\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g,
  )) {
    const literal = copyOnly(match[2]);
    if (literal) strings.push(literal);
  }
  return strings;
}

describe('chat panel copy', () => {
  const template = templateCopy(source);
  const dialogs = dialogCopy(source);

  it('extracts the copy it claims to check', () => {
    // A silently-empty extractor would make every assertion below vacuous.
    expect(template).toContain('/ Saved Chats');
    expect(template).toContain('Search chats...');
    expect(dialogs).toContain('Delete Chat');
    expect(dialogs).toContain('Rename Chat');
    expect(template).toContain('Unread chats');
    expect(dialogs.length).toBeGreaterThan(4);
  });

  it('never shows the user the word "output"', () => {
    const offenders = [...template, ...dialogs].filter((s) => FORBIDDEN.test(s));
    expect(offenders).toEqual([]);
  });

  it('calls a chat a chat everywhere, not a conversation in one dialog', () => {
    const offenders = [...template, ...dialogs].filter((s) => /\bconversations?\b/i.test(s));
    expect(offenders).toEqual([]);
  });

  it('labels the list and its search box consistently', () => {
    expect(source).toContain('<h2 class="title">/ Saved Chats</h2>');
    expect(source).toContain('placeholder="Search chats..."');
  });

  it('keeps storage-layer identifiers untouched — this guards copy, not code', () => {
    // If a future rename sweeps the identifiers too, the store contract breaks
    // in ways no copy test would catch. Pin the boundary explicitly.
    expect(source).toContain("store.getters['contentOutputs/visibleOutputs']");
    expect(source).toContain("name: 'OutputList'");
  });
});
