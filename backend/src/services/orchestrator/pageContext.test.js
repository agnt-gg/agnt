// pageContext — one list of page-context fields, applied one way.
//
// The regression this file exists to prevent already happened once:
// `workspaceState` was added to OrchestratorService's destructure and NOT to
// the hand-written copy onto conversationContext, so every One Canvas turn
// reached the tools without its workspace identity and widgets landed in the
// wrong workspace. The source guards at the bottom are the durable half —
// they fail the build if the two sites drift again.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PAGE_CONTEXT_FIELDS, pickPageContext, isCanvasTurn, listCanvasSurfaces } from './pageContext.js';

const orchestratorSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'OrchestratorService.js'),
  'utf8',
);

describe('PAGE_CONTEXT_FIELDS', () => {
  it('is frozen — a list this load-bearing must not be mutated at runtime', () => {
    expect(Object.isFrozen(PAGE_CONTEXT_FIELDS)).toBe(true);
  });

  it('covers every surface, including the workspace envelope that drifted', () => {
    for (const field of [
      'agentId', 'agentContext', 'agentState',
      'workflowId', 'workflowContext', 'workflowState',
      'toolId', 'toolContext', 'toolState',
      'widgetId', 'widgetContext', 'widgetState',
      'goalId', 'goalContext',
      'codeId', 'codeContext',
      'workspaceState',
    ]) {
      expect(PAGE_CONTEXT_FIELDS).toContain(field);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(PAGE_CONTEXT_FIELDS).size).toBe(PAGE_CONTEXT_FIELDS.length);
  });
});

describe('pickPageContext', () => {
  it('copies exactly the page-context fields and nothing else', () => {
    const picked = pickPageContext({
      workflowId: 'wf_9',
      workspaceState: { id: 'ws_1' },
      message: 'hello',
      enabledTools: ['a'],
      provider: 'openai',
    });
    expect(picked).toEqual({ workflowId: 'wf_9', workspaceState: { id: 'ws_1' } });
  });

  it('OMITS absent fields rather than setting them undefined', () => {
    // Spreading `{ workflowId: undefined }` over a context would blank a value
    // resolved earlier, and `'workflowId' in ctx` would start lying.
    const picked = pickPageContext({ codeId: 'artifacts' });
    expect(Object.keys(picked)).toEqual(['codeId']);
    expect('workflowId' in picked).toBe(false);
  });

  it('survives a missing or non-object body', () => {
    expect(pickPageContext(undefined)).toEqual({});
    expect(pickPageContext(null)).toEqual({});
    expect(pickPageContext('nope')).toEqual({});
  });

  it('preserves falsy-but-real values', () => {
    expect(pickPageContext({ workflowState: null, goalContext: 0 })).toEqual({
      workflowState: null,
      goalContext: 0,
    });
  });
});

describe('isCanvasTurn — how a canvas turn is told apart from a sidebar turn', () => {
  it('is true when the workspace envelope is present', () => {
    expect(isCanvasTurn({ workspaceState: { id: 'ws_1', surfaces: [] } })).toBe(true);
  });

  it('is true even with zero open surfaces — the canvas is still the canvas', () => {
    expect(isCanvasTurn({ workspaceState: { id: 'ws_1' } })).toBe(true);
  });

  it('is false for every sidebar surface', () => {
    expect(isCanvasTurn({ workflowState: { id: 'wf_1' } })).toBe(false);
    expect(isCanvasTurn({ codeContext: {} })).toBe(false);
    expect(isCanvasTurn({})).toBe(false);
    expect(isCanvasTurn(null)).toBe(false);
  });
});

describe('listCanvasSurfaces', () => {
  it('returns the declared windows', () => {
    const surfaces = [{ instanceId: 'w_1', widgetId: 'artifacts' }];
    expect(listCanvasSurfaces({ workspaceState: { surfaces } })).toBe(surfaces);
  });

  it('always returns an array, never undefined', () => {
    expect(listCanvasSurfaces({ workspaceState: {} })).toEqual([]);
    expect(listCanvasSurfaces({ workspaceState: { surfaces: 'nope' } })).toEqual([]);
    expect(listCanvasSurfaces(undefined)).toEqual([]);
  });
});

describe('OrchestratorService uses the shared list (source guards)', () => {
  it('builds conversationContext from pickPageContext, not by hand', () => {
    expect(orchestratorSource).toContain('...pickPageContext(req.body)');
  });

  it('imports it from the one module that owns it', () => {
    expect(orchestratorSource).toMatch(
      /import \{ pickPageContext \} from '\.\/orchestrator\/pageContext\.js';/,
    );
  });

  it('no longer copies page-context fields onto conversationContext by hand', () => {
    // The exact failure mode: a second hand-written list that can drift. If
    // conversationContext ever regrows one, this catches it.
    const start = orchestratorSource.indexOf('const conversationContext = {');
    expect(start).toBeGreaterThan(-1);
    const block = orchestratorSource.slice(start, start + 2000);
    for (const field of PAGE_CONTEXT_FIELDS) {
      expect(block, `conversationContext hand-copies ${field} again`).not.toMatch(
        new RegExp(`^\\s{4}${field},\\s*$`, 'm'),
      );
    }
  });

  it('still destructures every page-context field it needs off req.body', () => {
    // The destructure remains (other code reads agentId, goalId, …). What must
    // never happen again is a field living in ONLY one of the two places.
    const start = orchestratorSource.indexOf('  // Extract common parameters');
    const end = orchestratorSource.indexOf('} = req.body;', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const destructure = orchestratorSource.slice(start, end);
    for (const field of PAGE_CONTEXT_FIELDS) {
      expect(destructure, `${field} is in PAGE_CONTEXT_FIELDS but never destructured`).toMatch(
        new RegExp(`\\b${field}\\b`),
      );
    }
  });
});
