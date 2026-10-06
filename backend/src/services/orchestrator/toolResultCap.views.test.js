import { describe, it, expect } from 'vitest';
import { capToolResult, toolResultCapFor, REFERENCE_VIEW_CHARS, VERBATIM_RESULT_TOOLS } from './toolResultCap.js';

const cap = (content, limit) => {
  const context = {};
  return { context, out: capToolResult(content, { cap: limit, functionName: 'execute_shell_command', toolCallId: 'c1', conversationContext: context, now: () => 1 }) };
};

describe('toolResultCapFor', () => {
  it('gives reference tools a 16k view and verbatim tools the user cap', () => {
    expect(toolResultCapFor('web_scrape', 100_000)).toBe(REFERENCE_VIEW_CHARS);
    expect(toolResultCapFor('get_trace', 100_000)).toBe(REFERENCE_VIEW_CHARS);
    for (const name of ['read_file', 'edit_file', 'activate_skill', 'agnt_chat', 'query_data']) {
      expect(VERBATIM_RESULT_TOOLS.has(name)).toBe(true);
      expect(toolResultCapFor(name, 100_000)).toBe(100_000);
    }
  });

  it('never raises a lower user cap', () => {
    expect(toolResultCapFor('web_scrape', 8_000)).toBe(8_000);
  });
});

describe('capped views keep the end of the output', () => {
  const log = `${'compiling module\n'.repeat(3000)}FAIL src/a.test.js: expected 2, got 3\nTests: 1 failed, 41 passed`;

  it('a JSON result keeps both ends of a long field', () => {
    const { out, context } = cap(JSON.stringify({ success: true, stdout: log }), REFERENCE_VIEW_CHARS);
    const parsed = JSON.parse(out);
    expect(out.length).toBeLessThanOrEqual(REFERENCE_VIEW_CHARS);
    expect(parsed.success).toBe(true);
    expect(parsed.view.stdout).toContain('Tests: 1 failed, 41 passed');
    expect(parsed.view.stdout.startsWith('compiling module')).toBe(true);
    expect(JSON.parse(context.preservedContent[parsed.data_ref]).stdout).toBe(log); // nothing lost
  });

  it('plain text keeps both ends too', () => {
    const { out } = cap(log, REFERENCE_VIEW_CHARS);
    const parsed = JSON.parse(out);
    expect(parsed.view).toContain('Tests: 1 failed, 41 passed');
    expect(parsed.view.startsWith('compiling module')).toBe(true);
  });

  it('a result within the cap is untouched', () => {
    expect(cap('short', REFERENCE_VIEW_CHARS).out).toBe('short');
  });
});
