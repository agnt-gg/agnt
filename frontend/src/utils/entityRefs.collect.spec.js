// The "Referenced" section of the chat inspector listed agents nobody had
// named: it scanned store.state.chat.messages (which also holds the mirrored
// agent-side transcript) and deduped by id, so two agents sharing a name
// showed up twice. These are the tests that would have caught both.

import { describe, it, expect } from 'vitest';
import { collectEntityRefs } from './entityRefs.js';

const REGISTRY = [
  { kind: 'agent', id: 'a1', name: 'Health Monitor' },
  { kind: 'agent', id: 'a2', name: 'Health Monitor' }, // a real duplicate name
  { kind: 'agent', id: 'a3', name: 'Toolsmith' },
  { kind: 'agent', id: 'a4', name: 'pipe-enrich' },
  { kind: 'workflow', id: 'w1', name: 'Nightly Digest' },
];

const user = (content) => ({ role: 'user', content });
const bot = (content) => ({ role: 'assistant', content });

describe('collectEntityRefs', () => {
  it('returns nothing for an empty transcript', () => {
    expect(collectEntityRefs([], REGISTRY)).toEqual([]);
  });

  it('returns nothing when no name appears — the reported bug', () => {
    const msgs = [user('why is the right panel wrong?'), bot('Looking into it.')];
    expect(collectEntityRefs(msgs, REGISTRY)).toEqual([]);
  });

  it('lists an entity named in prose', () => {
    const found = collectEntityRefs([bot('I asked Toolsmith to rebuild it.')], REGISTRY);
    expect(found.map((e) => e.name)).toEqual(['Toolsmith']);
  });

  it('lists two entities that share a name only once', () => {
    const found = collectEntityRefs([bot('Health Monitor flagged it.')], REGISTRY);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Health Monitor');
  });

  it('ignores names inside a fenced code block', () => {
    const msgs = [bot('Here:\n```\nconst a = "Toolsmith";\n```\nDone.')];
    expect(collectEntityRefs(msgs, REGISTRY)).toEqual([]);
  });

  it('ignores names inside inline code', () => {
    expect(collectEntityRefs([bot('the `pipe-enrich` flag')], REGISTRY)).toEqual([]);
  });

  it('ignores names inside a file path or URL', () => {
    const msgs = [
      bot('see C:\\agents\\Toolsmith\\index.js'),
      bot('see https://example.com/Nightly Digest'),
    ];
    expect(collectEntityRefs(msgs, REGISTRY)).toEqual([]);
  });

  it('matches whole words only', () => {
    expect(collectEntityRefs([bot('ToolsmithX is different')], REGISTRY)).toEqual([]);
  });

  it('is most-recent first and caps the list', () => {
    const msgs = [bot('Toolsmith ran.'), bot('Nightly Digest ran.')];
    expect(collectEntityRefs(msgs, REGISTRY).map((e) => e.name)).toEqual([
      'Nightly Digest',
      'Toolsmith',
    ]);
    expect(collectEntityRefs(msgs, REGISTRY, { max: 1 })).toHaveLength(1);
  });

  it('only scans the tail, so an old mention drops off', () => {
    const msgs = [bot('Toolsmith ran.'), ...Array.from({ length: 5 }, () => bot('ok'))];
    expect(collectEntityRefs(msgs, REGISTRY, { scan: 3 })).toEqual([]);
  });

  it('survives junk input', () => {
    expect(collectEntityRefs(null, REGISTRY)).toEqual([]);
    expect(collectEntityRefs([null, {}, { content: 42 }], REGISTRY)).toEqual([]);
    expect(collectEntityRefs([bot('Toolsmith')], [])).toEqual([]);
  });
});
