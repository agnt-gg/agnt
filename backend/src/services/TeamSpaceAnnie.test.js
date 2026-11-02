import { describe, it, expect } from 'vitest';
import { runAnnieTurn, anniePrompt, isAnnie, createReducingTransport, answerInTeamChat, liveReplies } from './TeamSpaceAnnie.js';

describe('Annie in a teamspace chat', () => {
  it('runs one turn as the person who tagged her, reducing the stream into a main-chat message', async () => {
    let seen;
    const transport = createReducingTransport();
    const outcome = await runAnnieTurn({ userId: 'ana', authToken: 'Bearer t', prompt: 'hello', transport }, async (input) => {
      seen = input;
      input.transport.send('content_delta', { delta: '## Plan\n' });
      input.transport.send('tool_start', { toolCall: { id: 't1', name: 'web_search', args: { q: 'x' } } });
      input.transport.send('tool_end', { toolCall: { id: 't1', name: 'web_search', result: { ok: true } } });
      input.transport.send('content_delta', { delta: '- done' });
    });
    expect(seen).toMatchObject({ userId: 'ana', authToken: 'Bearer t', chatType: 'orchestrator', body: { message: 'hello', history: [] } });
    expect(outcome.ok).toBe(true);
    expect(outcome.message.content).toBe('## Plan\n- done');
    expect(outcome.message.toolCalls).toEqual([expect.objectContaining({ id: 't1', name: 'web_search', status: 'completed' })]);
    expect(outcome.message.contentParts.map((p) => p.type)).toEqual(['text', 'tool_call', 'text']);
  });
  it('a turn with no answer is a failed outcome, never a blank message', async () => {
    const outcome = await runAnnieTurn({ userId: 'ana', authToken: 't', prompt: 'x', transport: createReducingTransport() }, async (input) => input.transport.send('error', { error: 'no model' }));
    expect(outcome).toMatchObject({ ok: false, error: 'no model' });
  });
  it('the prompt carries the recent chat with names, then the request, and no longer asks for plain text', () => {
    const prompt = anniePrompt({ spaceName: 'Sales', message: { body: '@Annie sum up' }, history: [{ author: { kind: 'person', id: 'p1' }, body: 'Globex said yes' }], names: new Map([['p1', 'Jess']]) });
    expect(prompt).toMatch(/"Sales" teamspace/);
    expect(prompt).toMatch(/Jess: Globex said yes/);
    expect(prompt).not.toMatch(/no headings/);
    expect(prompt.trim().endsWith('The request: @Annie sum up')).toBe(true);
    // A huge earlier message is clipped as context; a huge request is sent whole.
    const big = 'row,'.repeat(5000);
    const withBig = anniePrompt({ message: { body: '@Annie rank these: ' + big }, history: [{ author: { kind: 'person', id: 'p1' }, body: big }], names: new Map() });
    expect(withBig).toContain('(truncated)');
    expect(withBig.endsWith(big)).toBe(true);
    expect(isAnnie({ kind: 'agent', id: 'annie' })).toBe(true);
    expect(isAnnie({ kind: 'person', id: 'annie' })).toBe(false);
  });
  it('streams live to the teamspace while she writes, then posts the whole message and clears the live copy', async () => {
    const posted = [];
    const signals = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const spaces = { postAgentMessage: async (...args) => posted.push(args) };
    const done = answerInTeamChat({
      spaces, teamId: 't1', workspaceId: 'w1', prompt: 'p', throttleMs: 0,
      changed: (extra) => signals.push(extra),
      ask: async (_p, transport) => { transport.send('content_delta', { delta: 'Hel' }); await gate; transport.send('content_delta', { delta: 'lo **team**' }); return transport.outcome(); },
    });
    await new Promise((r) => setTimeout(r, 5));
    const during = liveReplies('t1', 'w1');
    expect(during).toHaveLength(1);
    expect(during[0]).toMatchObject({ live: true, author: { kind: 'agent', id: 'annie' }, body: 'Hel' });
    expect(liveReplies('t1', 'other')).toEqual([]);
    release();
    await done;
    expect(liveReplies('t1', 'w1')).toEqual([]);
    expect(posted[0].slice(0, 4)).toEqual(['t1', 'w1', 'annie', 'Hello **team**']);
    expect(posted[0][5]).toMatchObject({ content: 'Hello **team**' });
    expect(signals.at(-1)).toMatchObject({ done: true });
  });
});
