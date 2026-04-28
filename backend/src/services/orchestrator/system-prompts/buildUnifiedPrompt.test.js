import { describe, expect, it } from 'vitest';
import { buildUnifiedSystemPrompt } from './buildUnifiedPrompt.js';

const baseFrozen = {
  skillsCatalogSection: '## Skill Catalog\n- skill-a: does a\n- skill-b: does b',
  memorySection: '\n\n## Memory\n- [pref] user prefers concise replies',
  customInstructionsSection: '## User\'s Custom System Instructions\nAlways respond in haiku.',
};

describe('buildUnifiedSystemPrompt — frozen prefix stability', () => {
  it('produces byte-identical output across re-invocations with the same context', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const a = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    const b = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    expect(a).toBe(b);
  });

  it('keeps the cacheable prefix byte-identical when only customInstructions change', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const promptA = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    const promptB = await buildUnifiedSystemPrompt(ctx, {
      ...baseFrozen,
      customInstructionsSection: '## User\'s Custom System Instructions\nAlways respond in iambic pentameter.',
    });

    const splitMarker = '## User\'s Custom System Instructions';
    const prefixA = promptA.slice(0, promptA.indexOf(splitMarker));
    const prefixB = promptB.slice(0, promptB.indexOf(splitMarker));
    expect(prefixA).toBe(prefixB);
    expect(prefixA.length).toBeGreaterThan(0);
  });

  it('keeps prefix stable when customInstructions are added to a previously-empty context', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const promptEmpty = await buildUnifiedSystemPrompt(ctx, { ...baseFrozen, customInstructionsSection: '' });
    const promptWith = await buildUnifiedSystemPrompt(ctx, baseFrozen);

    expect(promptWith.startsWith(promptEmpty)).toBe(true);
  });

  it('skips MCP_TOOL_USE_RULES on claude-code provider', async () => {
    const ctxClaude = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'claude-code' };
    const ctxOther = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };

    const promptClaude = await buildUnifiedSystemPrompt(ctxClaude, baseFrozen);
    const promptOther = await buildUnifiedSystemPrompt(ctxOther, baseFrozen);

    expect(promptOther).toContain('MCP');
    expect(promptClaude.length).toBeLessThan(promptOther.length);
  });

  it('injects workflow context block only when workflowId is present', async () => {
    const ctxNoWorkflow = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const ctxWithWorkflow = {
      ...ctxNoWorkflow,
      workflowId: 'wf-123',
      workflowState: { id: 'wf-123', nodes: [], edges: [] },
    };

    const promptNo = await buildUnifiedSystemPrompt(ctxNoWorkflow, baseFrozen);
    const promptYes = await buildUnifiedSystemPrompt(ctxWithWorkflow, baseFrozen);

    expect(promptNo).not.toContain('## Workflow Context');
    expect(promptYes).toContain('## Workflow Context');
    expect(promptYes).toContain('wf-123');
  });

  it('injects only the page-context blocks whose triggering IDs are present', async () => {
    const ctx = {
      userId: 'u1',
      latestUserMessage: 'hi',
      normalizedProvider: 'anthropic',
      widgetId: 'wid-1',
      widgetState: { id: 'wid-1', name: 'My Widget', source_code: '<html></html>' },
    };
    const prompt = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    expect(prompt).toContain('## Widget Context');
    expect(prompt).not.toContain('## Workflow Context');
    expect(prompt).not.toContain('## Agent Context');
    expect(prompt).not.toContain('## Tool Forge Context');
    expect(prompt).not.toContain('## Artifact Context');
    expect(prompt).not.toContain('## Goal Context');
  });

  it('uses agent override persona when agentOverride is provided', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic', agentId: 'agent-7' };
    const promptDefault = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    const promptOverride = await buildUnifiedSystemPrompt(ctx, {
      ...baseFrozen,
      agentOverride: { name: 'FooBot', systemPrompt: 'You are FooBot, a customer support agent.' },
    });

    expect(promptDefault).toContain('You are Annie');
    expect(promptOverride).toContain('You are FooBot');
    expect(promptOverride).not.toMatch(/^You are Annie/);
  });

  it('places customInstructions at the very end so prefix invalidation is bounded', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const prompt = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    const lastSection = prompt.slice(prompt.lastIndexOf('## '));
    expect(lastSection.startsWith('## User\'s Custom System Instructions')).toBe(true);
  });
});
