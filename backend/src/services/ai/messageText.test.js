// Goal task output must be text on every provider. Regression: only
// 'anthropic' content blocks were unwrapped, so on Claude Code a task's output
// was stored as an array and read downstream as "[object Object]".
import { describe, it, expect, vi } from 'vitest';

vi.mock('./LlmService.js', () => ({ createLlmClient: vi.fn() }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));

const { messageText } = await import('./LlmExecutionService.js');

describe('messageText', () => {
  it('passes strings through', () => {
    expect(messageText('done')).toBe('done');
  });
  it('joins the text of content blocks and drops tool and thinking blocks', () => {
    expect(messageText([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'Saved notes.' },
      { type: 'tool_use', id: 'x', name: 'write_file', input: {} },
      { type: 'output_text', text: 'Path: /a.md' },
    ])).toBe('Saved notes.\nPath: /a.md');
  });
  it('never yields "[object Object]"', () => {
    expect(messageText(null)).toBe('');
    expect(messageText(undefined)).toBe('');
    expect(messageText([{ type: 'tool_use' }])).toBe('');
    expect(messageText({ text: 'x' })).toBe('x');
  });
});
