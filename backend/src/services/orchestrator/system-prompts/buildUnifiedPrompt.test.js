import { describe, expect, it } from 'vitest';
import { buildUnifiedSystemPrompt, buildPageContextBlock } from './buildUnifiedPrompt.js';

const baseFrozen = {
  skillsCatalogSection: '## Skill Catalog\n- skill-a: does a\n- skill-b: does b',
  memorySection: '\n\n## Memory\n- [pref] user prefers concise replies',
  customInstructionsSection: '## User\'s Custom System Instructions\nAlways respond in haiku.',
};

describe('buildUnifiedSystemPrompt — block ledger', () => {
  it('the recorded blocks are exactly the prompt, in order, nothing unaccounted for', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const blocks = [];
    const prompt = await buildUnifiedSystemPrompt(ctx, { ...baseFrozen, blocks });
    expect(blocks.map((b) => b.text).join('\n\n')).toBe(prompt);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    expect(blocks.find((b) => b.id === 'skills').text).toBe(baseFrozen.skillsCatalogSection);
  });

  it('recording blocks never changes the prompt', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const plain = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    const recorded = await buildUnifiedSystemPrompt(ctx, { ...baseFrozen, blocks: [] });
    expect(recorded).toBe(plain);
  });
});

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

  // Page-context blocks are assembled under a single 'CURRENT PAGE CONTEXT'
  // header (see buildPageContextSection). They previously carried '## <Name>
  // Context' headings; these assertions still named those and so could never
  // pass. Markers below are the first line each block actually emits.
  const PAGE_CONTEXT_HEADER = 'CURRENT PAGE CONTEXT';
  const BLOCK_MARKERS = {
    workflow: 'You are Annie, a workflow assistant',
    widget: 'You are Annie, a helpful AI assistant specialized in creating, editing, and configuring AGNT dashboard widgets',
    agent: 'You are Annie, a helpful AI assistant specialized in creating and managing AI agents',
    tool: 'You are Annie, a helpful AI assistant specialized in creating, modifying, and testing custom AGNT tools',
    goal: 'You are Annie, an intelligent goal orchestration assistant',
    plugin: 'You are Annie, working in Plugin Forge',
  };

  it('injects workflow context block only when workflowId is present', async () => {
    const ctxNoWorkflow = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const ctxWithWorkflow = {
      ...ctxNoWorkflow,
      workflowId: 'wf-123',
      workflowState: { id: 'wf-123', nodes: [], edges: [] },
    };

    const promptNo = await buildPageContextBlock(ctxNoWorkflow);
    const promptYes = await buildPageContextBlock(ctxWithWorkflow);

    expect(promptNo).not.toContain(PAGE_CONTEXT_HEADER);
    expect(promptNo).not.toContain(BLOCK_MARKERS.workflow);

    expect(promptYes).toContain(PAGE_CONTEXT_HEADER);
    expect(promptYes).toContain(BLOCK_MARKERS.workflow);
    expect(promptYes).toContain('WORKFLOW CONTEXT:');
    expect(promptYes).toContain('wf-123');
  });

  it('never puts page context in the system prompt: it changes between turns', async () => {
    // The system block is cached whole; page state that changed on every
    // Forge edit re-wrote it and the entire history. It rides on the user
    // message instead (turnContext.js).
    const ctxNoPage = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const withPage = { ...ctxNoPage, workflowId: 'wf-123', workflowState: { id: 'wf-123', nodes: [{ id: 'n1' }], edges: [] } };
    const editedPage = { ...withPage, workflowState: { id: 'wf-123', nodes: [{ id: 'n1' }, { id: 'n2' }], edges: [] } };
    const prompts = await Promise.all([ctxNoPage, withPage, editedPage].map((ctx) => buildUnifiedSystemPrompt(ctx, baseFrozen)));
    expect(prompts[1]).toBe(prompts[0]);
    expect(prompts[2]).toBe(prompts[0]);
    expect(prompts[0]).not.toContain(PAGE_CONTEXT_HEADER);
  });

  it('injects only the page-context blocks whose triggering IDs are present', async () => {
    const ctx = {
      userId: 'u1',
      latestUserMessage: 'hi',
      normalizedProvider: 'anthropic',
      widgetId: 'wid-1',
      widgetState: { id: 'wid-1', name: 'My Widget', source_code: '<html></html>' },
    };
    const prompt = await buildPageContextBlock(ctx);

    expect(prompt).toContain(PAGE_CONTEXT_HEADER);
    expect(prompt).toContain(BLOCK_MARKERS.widget);
    for (const key of ['workflow', 'agent', 'tool', 'goal', 'plugin']) {
      expect(prompt, `${key} block leaked into a widget-only context`).not.toContain(BLOCK_MARKERS[key]);
    }
  });

  it('gives Plugin Forge its own block carrying the live draft', async () => {
    const ctx = {
      userId: 'u1',
      latestUserMessage: 'what does it need from me?',
      normalizedProvider: 'anthropic',
      pluginContext: { name: 'notion-sync' },
      pluginState: {
        name: 'notion-sync',
        installState: 'changed',
        files: { 'search.js': 'export default {}', 'manifest.json': '{"name":"notion-sync"}' },
      },
    };
    const prompt = await buildPageContextBlock(ctx);

    expect(prompt).toContain(BLOCK_MARKERS.plugin);
    expect(prompt).toContain('--- FILE: manifest.json');
    expect(prompt).toContain('export default {}');
    expect(prompt).toContain('NOT installed');
    // manifest first: every other file is read against it
    expect(prompt.indexOf('--- FILE: manifest.json')).toBeLessThan(prompt.indexOf('--- FILE: search.js'));
    for (const key of ['workflow', 'agent', 'tool', 'goal', 'widget']) {
      expect(prompt, `${key} block leaked into a plugin-only context`).not.toContain(BLOCK_MARKERS[key]);
    }
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

  it('includes AGNT-native execution policy in orchestrator and saved-agent prompts', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'implement this', normalizedProvider: 'anthropic' };
    const orchestratorPrompt = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    const agentPrompt = await buildUnifiedSystemPrompt(
      { ...ctx, agentId: 'agent-7' },
      {
        ...baseFrozen,
        agentOverride: { name: 'FooBot', systemPrompt: 'You are FooBot.' },
      },
    );

    for (const prompt of [orchestratorPrompt, agentPrompt]) {      expect(prompt).toContain('## AGNT-Native Execution');
      expect(prompt).toContain('shell executes computation; keep cognition here unless the user asks otherwise.');
      // The policy must stay a preference: an explicit user request for a
      // named external system has to remain honorable, not blocked.
      expect(prompt).toContain('Honor explicit requests.');
    }
  });

  it('teaches connected-provider auth without exposing credentials or bypassing working tools', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'read my Gmail', normalizedProvider: 'anthropic' };
    const prompt = await buildUnifiedSystemPrompt(ctx, baseFrozen);

    expect(prompt).toContain('## Connected-provider authentication');
    expect(prompt).toContain('authenticated tools receive provider credentials automatically');
    expect(prompt).toContain('If the provider tool succeeds, authentication is proven');
    expect(prompt).toContain('AGNT_AUTH_TOKEN authenticates requests to AGNT');
    expect(prompt).toContain('not the provider OAuth token');
    expect(prompt).toContain('Investigate authentication only after an explicit authentication error');
    expect(prompt).toContain('Do not import AuthManager');
    expect(prompt.match(/## Connected-provider authentication/g)).toHaveLength(1);
  });

  it('places customInstructions at the very end so prefix invalidation is bounded', async () => {
    const ctx = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };
    const prompt = await buildUnifiedSystemPrompt(ctx, baseFrozen);
    const lastSection = prompt.slice(prompt.lastIndexOf('## '));
    expect(lastSection.startsWith('## User\'s Custom System Instructions')).toBe(true);
  });
});
