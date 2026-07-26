import { describe, it, expect } from 'vitest';
import AgentTool, { normalizeConversationHistory } from './agnt-agent.js';

// The ParameterResolver JSON.stringify()s any array/object it resolves from a
// {{node.output}} template, so a WIRED conversationHistory reaches this node as
// JSON TEXT — never as an array. Spreading that string into `messages` would
// expand it one character per element and poison the request.

const schema = AgentTool.constructor.schema;

describe('agnt-agent schema — conversationHistory is wirable', () => {
  it('exposes conversationHistory as an input parameter (editor can wire it)', () => {
    expect(schema.parameters.conversationHistory).toBeDefined();
    expect(schema.parameters.conversationHistory.type).toBe('array');
  });

  it('still exposes conversationHistory as an output (so it can loop back)', () => {
    expect(schema.outputs.conversationHistory).toBeDefined();
  });

  it('keeps agentId and message required-in-practice', () => {
    expect(schema.parameters.agentId).toBeDefined();
    expect(schema.parameters.message).toBeDefined();
  });
});

describe('normalizeConversationHistory', () => {
  const cases = [
    ['a JSON string (what a wired {{...}} actually delivers)', '[{"role":"user","content":"hi"},{"role":"assistant","content":"yo"}]', 2],
    ['a real array (programmatic callers)', [{ role: 'user', content: 'hi' }], 1],
    ['empty string (unwired param)', '', 0],
    ['whitespace-only string', '   ', 0],
    ['undefined', undefined, 0],
    ['null', null, 0],
    ['an unresolved template literal', '{{Worker.conversationHistory}}', 0],
    ['non-JSON garbage', 'not json at all', 0],
    ['JSON that is not an array', '{"role":"user"}', 0],
    ['JSON number', '42', 0],
    ['array with malformed turns', '[{"role":"user","content":"ok"},"junk",null,{"nope":1}]', 1],
    ['empty array', '[]', 0],
  ];

  for (const [name, input, expectLength] of cases) {
    it(`handles ${name}`, () => {
      const out = normalizeConversationHistory(input);
      expect(Array.isArray(out)).toBe(true);
      expect(out).toHaveLength(expectLength);
    });
  }

  it('NEVER explodes a string into characters (the bug this prevents)', () => {
    const out = normalizeConversationHistory('[{"role":"user","content":"hi"}]');
    expect(out).toEqual([{ role: 'user', content: 'hi' }]);
    expect(out.every((t) => typeof t === 'object')).toBe(true);
  });

  it('a raw string would have been 30+ chars if spread — proves the guard fires', () => {
    const raw = '[{"role":"user","content":"hi"}]';
    expect([...raw].length).toBeGreaterThan(10);
    expect(normalizeConversationHistory(raw)).toHaveLength(1);
  });

  it('preserves turn order for a resident loop', () => {
    const out = normalizeConversationHistory(
      '[{"role":"user","content":"1"},{"role":"assistant","content":"2"},{"role":"user","content":"3"}]'
    );
    expect(out.map((t) => t.content)).toEqual(['1', '2', '3']);
  });

  it('keeps turns whose content is empty string or falsy-but-present', () => {
    const out = normalizeConversationHistory('[{"role":"assistant","content":""}]');
    expect(out).toHaveLength(1);
  });

  it('is pure — does not mutate its input array', () => {
    const input = [{ role: 'user', content: 'hi' }, 'junk'];
    const out = normalizeConversationHistory(input);
    expect(input).toHaveLength(2);
    expect(out).toHaveLength(1);
  });
});
