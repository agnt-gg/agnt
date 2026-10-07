import { describe, it, expect } from 'vitest';
import { buildReport, buildBatchReport, subChatMarker, SUB_CHAT_MARKER } from './subChatReports.js';

const decode = (content) => {
  const m = new RegExp(`<!-- ${SUB_CHAT_MARKER}:([A-Za-z0-9_-]+) -->`).exec(content);
  return m ? JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) : null;
};

describe('sub-chat report marker (lets the app link each handback to its chat)', () => {
  it('a single report names its sub-chat by saved row id, title and result', () => {
    const r = buildReport({ title: 'Pricing research', outputId: 'out-1', conversationId: 'conv-1', outcome: { ok: true, content: 'done', error: null } });
    expect(r.content).toMatch(/^\[System: Sub-chat finished\]/);
    expect(decode(r.content)).toEqual([{ outputId: 'out-1', title: 'Pricing research', ok: true }]);
  });

  it('a batch carries every sub-chat, failures included', () => {
    const r = buildBatchReport([
      { title: 'A', outputId: 'o-a', conversationId: 'c-a', outcome: { ok: true, content: 'x', error: null } },
      { title: 'B', outputId: 'o-b', conversationId: 'c-b', outcome: { ok: false, content: null, error: 'boom' } },
    ]);
    expect(decode(r.content)).toEqual([{ outputId: 'o-a', title: 'A', ok: true }, { outputId: 'o-b', title: 'B', ok: false }]);
  });

  it('no title can break out of the comment', () => {
    const marker = subChatMarker([{ title: 'evil --> <script>x</script>', outputId: 'o', outcome: { ok: true } }]);
    expect(marker.match(/-->/g)).toHaveLength(1);
    expect(decode(marker)[0].title).toBe('evil --> <script>x</script>');
  });
});
