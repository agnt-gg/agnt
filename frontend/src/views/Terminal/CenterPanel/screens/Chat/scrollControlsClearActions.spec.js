/**
 * THE SCROLL ARROWS NEVER SIT ON THE SAVE / NEW CHAT BUTTONS.
 *
 * The arrows are pinned to the conversation canvas; ChatActions is pinned to
 * the screen. With no suggestions bar between them the canvas reaches the
 * screen's bottom edge and the two corners coincide, so Chat.vue lifts the
 * arrows. This derives ChatActions' footprint from its own CSS so a taller
 * button or a new offset fails here instead of overlapping on screen.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');

const CHAT = read('Chat.vue');
const ACTIONS = read('components/ChatActions.vue');

const ruleBody = (css, selector) => {
  const start = css.indexOf(selector + ' {');
  expect(start, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
};
const px = (body, property) => {
  const match = body.match(new RegExp('(?:^|\\s)' + property + ':\\s*(\\d+)px'));
  expect(match, property).not.toBeNull();
  return Number(match[1]);
};

describe('scroll controls vs ChatActions', () => {
  it('lifts the arrows clear of the action bar when there are no suggestions', () => {
    const actionsBar = ruleBody(ACTIONS, '.chat-actions-bar');
    const actionButton = ruleBody(ACTIONS, '.action-icon-button');
    const actionsTop = px(actionsBar, 'bottom') + px(actionButton, 'height');

    const lift = px(ruleBody(CHAT, '.conversation-canvas-wrapper.scroll-controls-clear-actions :deep(.chat-scroll-controls)'), 'bottom');
    expect(lift).toBeGreaterThanOrEqual(actionsTop + 8);
  });

  it('applies the lift exactly when ChatActions renders and QuickActions does not', () => {
    expect(CHAT).toContain(":class=\"{ 'scroll-controls-clear-actions': scrollControlsShareActionsCorner }\"");
    expect(CHAT).toMatch(/scrollControlsShareActionsCorner = computed\(\s*\(\) => !isMobile\.value && hasConnectedAIProvider\.value && suggestions\.value\.length === 0/);
    // The conditions mirrored above: keep them in step with the components' v-ifs.
    expect(CHAT).toContain('<ChatActions v-if="!isMobile && hasConnectedAIProvider"');
    expect(CHAT).toMatch(/<QuickActions\s+v-if="!isMobile && hasConnectedAIProvider"/);
    expect(read('components/QuickActions.vue')).toContain('<div class="suggestions-bar" v-if="suggestions.length"');
  });
});
