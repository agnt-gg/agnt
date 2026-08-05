/**
 * The canvas nav's unread-chats dot.
 *
 * Contract: the CHAT toolbar tab and the sidebar Chat icon show a green dot
 * exactly when the CHIME set is non-empty — unread minus still-streaming
 * (notifiableUnreadIds). One derivation for sound and sight: the dot lights
 * when the ding fires and clears when the last unread conversation is opened.
 *
 * The selected conversation is deliberately NOT excluded (selection is not
 * attention — the email model), and the STREAMING exclusion must stay, or the
 * dot would flicker on every ~5s autosave of a running agent.
 *
 * Source-contract spec: mounting CanvasScreen drags in the whole widget
 * system; the wiring is what must not regress, and it is visible in source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, 'CanvasScreen.vue'), 'utf8');

describe('canvas unread-chats dot wiring', () => {
  it('derives from the chime set — notifiableUnreadIds over unread minus streaming', () => {
    expect(SRC).toMatch(/notifiableUnreadIds\(unread, \{ streamingIds: streaming \}\)\.size > 0/);
    expect(SRC).toContain("store.getters['contentOutputs/unreadOutputIdSet']");
    expect(SRC).toContain("store.getters['chat/streamingOutputIds']");
  });

  it('the CHAT toolbar tab renders the dot', () => {
    expect(SRC).toMatch(/tab\.screen === 'ChatScreen' && hasUnreadChats/);
  });

  it('the sidebar Chat icon renders the dot — visible from any section', () => {
    expect(SRC).toMatch(/section\.id === 'chat' && hasUnreadChats/);
  });

  it('does not re-exclude the active conversation — selection is not attention', () => {
    // The old chime bug: excluding the selected conversation made a finished
    // run invisible whenever its row happened to be selected.
    const computedBlock = SRC.match(/const hasUnreadChats = computed[\s\S]*?\}\);/)[0];
    expect(computedBlock).not.toContain('savedOutputId');
    expect(computedBlock).not.toContain('activeConversationId');
  });
});
