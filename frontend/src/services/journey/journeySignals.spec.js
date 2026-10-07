import { describe, expect, it } from 'vitest';
import { ACTION_EVENTS, MUTATION_EVENTS, eventForAction, eventForMutation } from './journeySignals.js';

describe('journey signals', () => {
  it('maps the mutations that mean a thing now exists', () => {
    expect(eventForMutation({ type: 'agents/ADD_AGENT', payload: {} })).toBe('agent.created');
    expect(eventForMutation({ type: 'workflows/ADD_WORKFLOW' })).toBe('workflow.created');
    expect(eventForMutation({ type: 'agents/SET_AGENTS' })).toBeNull();
    expect(eventForMutation(null)).toBeNull();
  });

  it('a workflow counts as switched on only for a running status', () => {
    const status = (s) => eventForMutation({ type: 'workflows/UPDATE_WORKFLOW_STATUS', payload: { id: 'w', status: s } });
    expect(status('listening')).toBe('workflow.activated');
    expect(status('Running')).toBe('workflow.activated');
    expect(status('stopped')).toBeNull();
    expect(status(undefined)).toBeNull();
  });

  it('maps resolved actions', () => {
    expect(eventForAction({ type: 'chat/startStreamingConversation' })).toBe('chat.sent');
    expect(eventForAction({ type: 'chatUnified/sendMessage' })).toBe('chat.sent');
    expect(eventForAction({ type: 'marketplace/installPlugin' })).toBe('market.installed');
    expect(eventForAction({ type: 'chat/fetchConversationSuggestions' })).toBeNull();
  });

  it('every mapped name is a real store entry (namespaced module/name)', () => {
    for (const type of [...Object.keys(MUTATION_EVENTS), ...Object.keys(ACTION_EVENTS)]) {
      expect(type).toMatch(/^[a-zA-Z]+\/[A-Za-z_]+$/);
    }
  });
});
