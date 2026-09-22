/**
 * The chat composer must NAME the model it is about to use.
 *
 * The bug this locks out: a conversation carries a per-conversation AI pin
 * (chat.aiByConv), and chat.js applies that pin ahead of the global selection
 * on EVERY send (hasConvAiOverride). The composer's provider control was
 * labelled with the literal word "Model", so the pin was invisible — a user
 * changing their model in Settings watched every turn keep running the pinned
 * model with nothing on screen to explain why. Reported live: a conversation
 * pinned to claude-fable-5-1 ran 25/25 consecutive turns on it while the
 * global selection said claude-opus-5.
 *
 * The assertions are on the RESOLUTION, which is the part that was wrong.
 * They deliberately mirror chat.js: an override wins, otherwise the global
 * selection applies.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(DIR, 'BaseScreen.vue'), 'utf8');
const TEMPLATE = SRC.slice(0, SRC.indexOf('<script>'));

/**
 * The component's own resolution, restated. Kept in lockstep with the
 * computed pair in BaseScreen.setup() by the source assertions below.
 */
function resolveEffectiveModel({ conversationId, aiByConv, selectedModel }) {
  const convAi = conversationId ? aiByConv?.[conversationId] || null : null;
  const pinned = !!(convAi?.provider && convAi?.model);
  return { pinned, model: pinned ? convAi.model : selectedModel || '' };
}

describe('composer names the model the send path will use', () => {
  const GLOBAL = 'claude-opus-5';
  const PINNED = 'claude-fable-5-1';
  const CONV = '29dfcd06-0a1e-4aa0-b758-e418d8a195fb';

  it('shows the CONVERSATION pin, not the global selection, when one exists', () => {
    const { pinned, model } = resolveEffectiveModel({
      conversationId: CONV,
      aiByConv: { [CONV]: { provider: 'Claude-Code', model: PINNED } },
      selectedModel: GLOBAL,
    });
    expect(pinned).toBe(true);
    expect(model).toBe(PINNED);
  });

  it('falls back to the global selection when the conversation has no pin', () => {
    const { pinned, model } = resolveEffectiveModel({
      conversationId: CONV,
      aiByConv: {},
      selectedModel: GLOBAL,
    });
    expect(pinned).toBe(false);
    expect(model).toBe(GLOBAL);
  });

  it('treats a half-written override (provider without model) as no pin', () => {
    // conversation_settings holds rows in exactly this shape (routing_mode
    // 'pinned' with a NULL pair). Reading that as a pin would render an empty
    // label and claim the chat is pinned to nothing.
    const { pinned, model } = resolveEffectiveModel({
      conversationId: CONV,
      aiByConv: { [CONV]: { provider: 'Claude-Code', model: null } },
      selectedModel: GLOBAL,
    });
    expect(pinned).toBe(false);
    expect(model).toBe(GLOBAL);
  });

  it('is global-only on a surface with no conversation id (sidebar chats)', () => {
    const { pinned, model } = resolveEffectiveModel({
      conversationId: '',
      aiByConv: { [CONV]: { provider: 'Claude-Code', model: PINNED } },
      selectedModel: GLOBAL,
    });
    expect(pinned).toBe(false);
    expect(model).toBe(GLOBAL);
  });
});

describe('BaseScreen source wiring', () => {
  it('renders the effective model instead of the literal word Model', () => {
    expect(TEMPLATE).toContain('chat-provider-model');
    expect(TEMPLATE).toContain("{{ effectiveModelLabel || 'Model' }}");
    // The static label is what hid the pin — it must not come back.
    expect(TEMPLATE).not.toMatch(/<span class="chat-btn-label">Model<\/span>/);
  });

  it('marks the button when the conversation owns the model', () => {
    expect(TEMPLATE).toContain("'is-pinned': isConversationModelPinned");
    expect(TEMPLATE).toContain('chat-provider-pin');
  });

  it('resolves the label from aiByConv first, then the global selection', () => {
    expect(SRC).toContain('state.chat?.aiByConv?.[props.conversationId]');
    expect(SRC).toContain("state.aiProvider?.selectedModel || ''");
  });

  it('warns in the tooltip that a global change will not reach a pinned chat', () => {
    expect(SRC).toContain('This chat is pinned to');
    expect(SRC).toMatch(/global model will NOT affect it/);
  });

  it('exposes the three bindings the template needs', () => {
    for (const key of ['effectiveModelLabel', 'isConversationModelPinned', 'providerButtonTooltip']) {
      // once in setup(), once in the returned binding object
      expect(SRC.split(key).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the pin OUTSIDE the collapsible label', () => {
    // The composer is a container query that hides .chat-btn-label on a narrow
    // row. If the pin lived inside that span, a narrow composer would drop the
    // one marker that says the chat owns its model — the exact blindness this
    // change exists to remove.
    const pinIndex = TEMPLATE.indexOf('chat-provider-pin');
    const labelClose = TEMPLATE.indexOf('</span>', TEMPLATE.indexOf('chat-provider-model'));
    expect(pinIndex).toBeGreaterThan(labelClose);
  });

  it('clamps the model label so it cannot trip the composer collapse', () => {
    expect(SRC).toMatch(/\.chat-provider-model\s*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(SRC).toMatch(/\.chat-provider-model\s*\{[^}]*max-width/s);
  });

  it('keeps the pinned accent through hover and uses the theme token', () => {
    expect(SRC).toMatch(/\.chat-provider-button\.is-pinned:hover:not\(:disabled\)/);
    expect(SRC).toMatch(/\.is-pinned[^{]*\{[^}]*var\(--color-primary\)/s);
  });
});
