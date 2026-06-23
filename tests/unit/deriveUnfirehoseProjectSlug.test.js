import { describe, it, expect } from 'vitest';
import { deriveProjectSlug as deriveUnfirehoseProjectSlug } from '../../backend/src/services/unfirehose/UnfirehoseLogger.js';

describe('deriveUnfirehoseProjectSlug', () => {
  it('agent chat → agent-{slug-of-name}', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'agent',
      agentContext: { name: 'Research Assistant' },
    })).toBe('agent-research-assistant');
  });

  it('workflow chat → workflow-{slug}', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'workflow',
      workflowContext: { name: 'Doc Summarizer' },
    })).toBe('workflow-doc-summarizer');
  });

  it('tool chat prefers title over name', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'tool',
      toolContext: { title: 'Web Search', name: 'web_search' },
    })).toBe('tool-web-search');
  });

  it('tool falls back to name when no title', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'tool',
      toolContext: { name: 'shell_exec' },
    })).toBe('tool-shell-exec');
  });

  it('widget chat → widget-{slug}', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'widget',
      widgetContext: { name: 'Sales Dashboard' },
    })).toBe('widget-sales-dashboard');
  });

  it('goal with title → goal-{slug-of-title}', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'goal',
      goalContext: { title: 'Ship Q2 Roadmap' },
    })).toBe('goal-ship-q2-roadmap');
  });

  it('goal with only id falls back to goal-{first-8}', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'goal',
      goalId: 'abc12345-def6-7890',
    })).toBe('goal-abc12345');
  });

  it('goal id with path-ish characters runs through slugifyName before slicing', () => {
    // This value becomes part of the unfirehose output directory, so slashes,
    // dots and other path separators must not leak through. Slugifying first
    // strips them; the slice then takes the first 8 chars of the safe form.
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'goal',
      goalId: '../etc/passwd',
    })).toBe('goal-etc-pass');

    expect(deriveUnfirehoseProjectSlug({
      chatType: 'goal',
      goalId: 'foo/bar/baz',
    })).toBe('goal-foo-bar-');

    // Whitespace + special chars also collapse to dashes via slugifyName
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'goal',
      goalId: '  weird id!! ',
    })).toBe('goal-weird-id');
  });

  it('goal id that slugifies to empty falls back to chat (no goal- leak)', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'goal',
      goalId: '!!!',
    })).toBe('chat');
  });

  it('orchestrator chat → chat', () => {
    expect(deriveUnfirehoseProjectSlug({ chatType: 'orchestrator' })).toBe('chat');
  });

  it('unknown chatType falls back to chat', () => {
    expect(deriveUnfirehoseProjectSlug({ chatType: 'mystery' })).toBe('chat');
  });

  it('agent with no name falls back to chat (no agent-undefined leak)', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'agent',
      agentContext: {},
    })).toBe('chat');
  });

  it('handles special chars + unicode whitespace', () => {
    expect(deriveUnfirehoseProjectSlug({
      chatType: 'agent',
      agentContext: { name: '  Research /// Assistant!! ' },
    })).toBe('agent-research-assistant');
  });

  it('caps slug length to 60 chars (plus prefix)', () => {
    const veryLong = 'a'.repeat(100);
    const result = deriveUnfirehoseProjectSlug({
      chatType: 'agent',
      agentContext: { name: veryLong },
    });
    expect(result).toBe(`agent-${'a'.repeat(60)}`);
  });
});
