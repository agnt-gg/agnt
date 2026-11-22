// Every AGNT One editor has Annie's chat on its left (2026-10-23). Each kind
// must reach the backend forge it already has, with the editor's live values.
import { describe, it, expect } from 'vitest';
import { forgeChatContext, savedItemId } from './focusedForgeChat.js';

describe('forgeChatContext', () => {
  it('an agent goes to the agent BUILDER (agent-chat), with the agent as its state, never as the chat persona', () => {
    const c = forgeChatContext('agents', { itemId: 'a1', record: { name: 'Kai', instructions: 'Code.', avatar: 'data:image/png;base64,xx' } });
    expect(c.chatType).toBe('agent');
    expect(c.pageContext).toEqual({ agentId: 'agent-chat' });
    expect(c.pageState.agentContext).toEqual({ id: 'agent-chat' });
    expect(c.pageState.agentState).toEqual({ name: 'Kai', instructions: 'Code.', id: 'a1' });
    expect(JSON.stringify(c)).not.toContain('"agentId":"a1"');
  });

  it('tools, workflows and widgets use their forge keys; skills get a skill context', () => {
    expect(forgeChatContext('tools', { itemId: 't1', record: { name: 'Fetch' } }).pageState).toEqual({ toolContext: { id: 't1' }, toolState: { id: 't1', currentTool: { name: 'Fetch', id: 't1' } } });
    const wf = forgeChatContext('workflows', { itemId: 'w1', record: { name: 'Daily', nodes: [{ id: 'n' }], edges: [] } });
    expect(wf.chatType).toBe('workflow');
    expect(wf.pageState.workflowState).toEqual({ id: 'w1', name: 'Daily', nodes: [{ id: 'n' }], edges: [] });
    expect(forgeChatContext('widgets', { itemId: 'g1', record: { source_code: '<div/>' } }).pageState.widgetState.source_code).toBe('<div/>');
    const skill = forgeChatContext('skills', { itemId: 's1', record: { name: 'Extractor', instructions: '# Steps' } });
    expect(skill.chatType).toBe('orchestrator');
    expect(skill.pageState).toEqual({ skillContext: { name: 'Extractor', instructions: '# Steps', id: 's1' } });
  });

  it('each item, and a new one, has its own conversation apart from Studio\u2019s', () => {
    expect(forgeChatContext('tools', { itemId: 't1' }).channelKey).toBe('one-forge:tools:t1');
    expect(forgeChatContext('tools').channelKey).toBe('one-forge:tools:new');
    expect(forgeChatContext('tools').welcome).toContain('Describe the tool');
    expect(forgeChatContext('nope')).toBeNull();
  });
});

describe('savedItemId', () => {
  it('finds the id of an item of this kind that a save or create returned', () => {
    expect(savedItemId('tools', { name: 'save_tool', result: JSON.stringify({ success: true, toolId: 't9' }) })).toBe('t9');
    expect(savedItemId('agents', { name: 'save_agent', result: { success: true, agent: { id: 'a9' } } })).toBe('a9');
    expect(savedItemId('tools', { name: 'list_tools', result: { toolId: 't9' } })).toBeNull();
    expect(savedItemId('tools', { name: 'save_tool', result: { success: false, toolId: 't9' } })).toBeNull();
    expect(savedItemId('tools', { name: 'save_tool', result: 'not json' })).toBeNull();
  });
});
