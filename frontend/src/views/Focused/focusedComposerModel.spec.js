import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FOCUSED_CSS = fs.readFileSync(path.join(here, 'focused.css'), 'utf8');
const BASE_SCREEN = fs.readFileSync(path.join(here, '../Terminal/CenterPanel/BaseScreen.vue'), 'utf8');

/**
 * Focused chat must let the user pick the provider/model for THAT chat.
 *
 * The composer's model button (BaseScreen) already opens ChatProviderSelector
 * scoped to the conversation, and a pick there pins the chat (chat.aiByConv,
 * persisted to conversation_settings, migrated from the temp id on the first
 * send). Focused hid the button with one CSS rule, so none of that was
 * reachable. Source-asserted: jsdom applies no stylesheet cascade.
 */
describe('Focused chat — per-chat model', () => {
  const rulesHiding = (selector) =>
    [...FOCUSED_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selectors, body]) => selectors.includes(selector) && /display:\s*none/.test(body))
      .map(([, selectors]) => selectors.trim());

  it('does not hide the composer model button', () => {
    expect(rulesHiding('.chat-provider-button')).toEqual([]);
  });

  it('keeps the model NAME visible, though narrow composers collapse other labels', () => {
    // BaseScreen hides .chat-btn-label under 900px; Focused always is.
    expect(BASE_SCREEN).toMatch(/@container composer \(max-width: 900px\)[\s\S]*?\.chat-btn-label\s*\{\s*display:\s*none/);
    expect(FOCUSED_CSS).toMatch(
      /\.ui-focused \.chat-screen-wrapper \.chat-provider-button \.chat-provider-model\s*\{\s*display:\s*inline-block/,
    );
    // ...and the button itself, which that query pins to a 36px circle, grows
    // to hold it: measured 17px of a 76px name before this rule.
    expect(FOCUSED_CSS).toMatch(/\.ui-focused \.chat-screen-wrapper \.input-line \.chat-provider-button\s*\{\s*width:\s*auto/);
  });

  it('anti-vacuity: the matcher does find a rule it should (tools stay hidden)', () => {
    expect(rulesHiding('.chat-tools-button').length).toBeGreaterThan(0);
  });

  it('the button opens the picker scoped to this conversation', () => {
    expect(BASE_SCREEN).toMatch(/class="chat-provider-button"/);
    expect(BASE_SCREEN).toMatch(/<ChatProviderSelector[\s\S]*?:conversation-id="conversationId"/);
  });
});
