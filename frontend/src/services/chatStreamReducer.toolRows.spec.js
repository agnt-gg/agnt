import { describe, it, expect } from 'vitest';
import { serverMessagesToUi, transcriptSubstance } from './chatStreamReducer.js';

/**
 * Regression: OpenAI-shaped transcripts store tool results as separate
 * role:'tool' rows (tool_call_id + name + content). serverMessagesToUi used to
 * drop every non-user/non-assistant row, which meant a recovered transcript
 * contained tool cards with NO results. The stream healer then stamped them all
 * interrupted.
 *
 * This test pins the contract: if the provider stored a tool result row, the UI
 * must show the result on the matching tool card after reload.
 */

describe('serverMessagesToUi — tool rows (OpenAI transcript shape)', () => {
  const TRANSCRIPT = [
    { role: 'system', content: 'x' },
    { role: 'user', content: 'do it' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'c1', name: 'grep_files', input: { pattern: 'a' } },
        { type: 'tool_use', id: 'c2', name: 'read_file', input: { path: 'b' } },
      ],
      // Some providers also repeat the declaration here; we should tolerate it.
      tool_calls: [
        { id: 'c1', function: { name: 'grep_files', arguments: '{"pattern":"a"}' } },
        { id: 'c2', function: { name: 'read_file', arguments: '{"path":"b"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', name: 'grep_files', content: '{"matches":3}' },
    { role: 'tool', tool_call_id: 'c2', name: 'read_file', content: 'hello' },
    { role: 'assistant', content: 'done' },
  ];

  it('joins tool-row results onto the tool calls that asked for them', () => {
    const ui = serverMessagesToUi(TRANSCRIPT);
    const byId = new Map(ui.flatMap((m) => m.toolCalls.map((tc) => [tc.id, tc])));

    expect(byId.get('c1')).toMatchObject({ name: 'grep_files', result: '{"matches":3}', status: 'completed' });
    expect(byId.get('c2')).toMatchObject({ name: 'read_file', result: 'hello', status: 'completed' });
  });

  it('counts a tool result as more substance than a pending card', () => {
    const pending = serverMessagesToUi(TRANSCRIPT.filter((m) => m.role !== 'tool'));
    const completed = serverMessagesToUi(TRANSCRIPT);
    expect(transcriptSubstance(completed)).toBeGreaterThan(transcriptSubstance(pending));
  });
});
