/**
 * Systemic guard: every chat surface must be recordable, and no write site may
 * collapse the surface back into a single bucket.
 *
 * BACKGROUND — why this file exists
 * ---------------------------------
 * `detectChatType()` has always known exactly which surface a request came from
 * (orchestrator / agent / workflow / tool / widget / goal / artifact). Both DB
 * write sites then did:
 *
 *     origin: chatType === 'agent' ? 'agent' : 'chat'
 *
 * ...one line before the INSERT. Eight months of `agent_executions` and
 * `llm_calls` therefore recorded a single value, 'chat', for 100% of rows. The
 * question "which parts of AGNT do we actually use?" was unanswerable from the
 * ledger, and had to be reconstructed from `agent_name` — a DISPLAY string that
 * is overwritten whenever a run has a named agent, so it is lossy by design.
 *
 * That is the worst instrument failure mode: a column that looks populated
 * while silently answering a question it cannot answer.
 *
 * Two rules are pinned here:
 *   1. VOCABULARY — every surface `detectChatType` can return is a legal origin.
 *      Add a forge, forget the vocabulary, this test fails.
 *   2. FIDELITY   — no write site re-introduces a collapse to a constant.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectChatType } from './chatConfigs.js';
import { ORIGINS, CHAT_SURFACE_ORIGINS } from '../../models/LlmCallModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_CONFIGS = path.join(HERE, 'chatConfigs.js');
const ORCHESTRATOR = path.join(HERE, '..', 'OrchestratorService.js');

/**
 * Strip comments before scanning source. A previous guard of mine flagged the
 * explanatory comment written directly above the very fix it was guarding, so
 * every source scanner in this repo strips first and matches second.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .join('\n');
}

/** Every string literal `detectChatType` can return, read from its own body. */
function returnedChatTypes() {
  const src = stripComments(fs.readFileSync(CHAT_CONFIGS, 'utf8'));
  const start = src.indexOf('export function detectChatType');
  expect(start, 'detectChatType not found — did it move or get renamed?').toBeGreaterThan(-1);

  // Skip the parameter list before looking for the body brace. `detectChatType`
  // is declared `(req, context = {})` — naively taking the first '{' after the
  // name lands on that DEFAULT VALUE, whose matching '}' is one character later,
  // yielding an empty body and zero surfaces. That is precisely the vacuous pass
  // the anti-vacuity test above exists to catch, and it caught it.
  const paramOpen = src.indexOf('(', start);
  let parenDepth = 0;
  let paramEnd = -1;
  for (let i = paramOpen; i < src.length; i++) {
    if (src[i] === '(') parenDepth++;
    else if (src[i] === ')' && --parenDepth === 0) { paramEnd = i; break; }
  }
  expect(paramEnd, 'could not find the end of the detectChatType parameter list').toBeGreaterThan(paramOpen);

  // Walk braces to find the exact end of the function body, so we never bleed
  // into getChatConfig() below it and pick up its literals instead.
  const open = src.indexOf('{', paramEnd);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  expect(end, 'could not find the end of detectChatType').toBeGreaterThan(open);

  const body = src.slice(open, end);
  return [...body.matchAll(/return\s+'([a-z-]+)'/g)].map((m) => m[1]);
}

describe('chat surface origins — vocabulary', () => {
  it('finds the surfaces by reading detectChatType, not by hardcoding them', () => {
    // Anti-vacuity: if the scanner silently matched nothing, every membership
    // assertion below would pass over an empty list and prove nothing.
    const found = returnedChatTypes();
    expect(found.length).toBeGreaterThanOrEqual(7);
    expect(found).toContain('orchestrator');
    expect(found).toContain('tool');
  });

  it('every surface detectChatType can return is a legal origin', () => {
    for (const t of returnedChatTypes()) {
      // 'suggestions' short-circuits before any execution row is written.
      if (t === 'suggestions') continue;
      expect(ORIGINS, `detectChatType can return '${t}' but it is not in ORIGINS — ` +
        `runs from that surface would be unattributable`).toContain(t);
    }
  });

  it('CHAT_SURFACE_ORIGINS and detectChatType describe the same set', () => {
    const detected = returnedChatTypes().filter((t) => t !== 'suggestions').sort();
    expect([...CHAT_SURFACE_ORIGINS].sort()).toEqual([...new Set(detected)].sort());
  });

  it('classifies live request shapes into legal origins', () => {
    const cases = [
      [{ path: '/agent-chat', body: {} }, 'agent'],
      [{ path: '/workflow-chat', body: {} }, 'workflow'],
      [{ path: '/tool-chat', body: {} }, 'tool'],
      [{ path: '/widget-chat', body: {} }, 'widget'],
      [{ path: '/goal-chat', body: {} }, 'goal'],
      [{ path: '/artifact-chat', body: {} }, 'artifact'],
      [{ path: '/chat', body: {} }, 'orchestrator'],
      [{ path: '/chat', body: { toolId: 't1' } }, 'tool'],
      [{ path: '/chat', body: { widgetId: 'w1' } }, 'widget'],
      [{ path: '/chat', body: { codeId: 'c1' } }, 'artifact'],
    ];
    for (const [req, expected] of cases) {
      expect(detectChatType(req), `path=${req.path} body=${JSON.stringify(req.body)}`).toBe(expected);
      expect(ORIGINS).toContain(expected);
    }
  });
});

describe('chat surface origins — fidelity at the write sites', () => {
  const src = stripComments(fs.readFileSync(ORCHESTRATOR, 'utf8'));

  it('records the surface verbatim at every origin write site', () => {
    // Stop at '}' as well as ',' / newline: one write site is the last property
    // of an inline object (`{ ..., origin: chatType }`), so a comma-or-newline
    // terminator alone captures a trailing brace and never matches.
    const writes = [...src.matchAll(/origin:\s*([^,\n}]+)/g)].map((m) => m[1].trim());

    // Anti-vacuity: prove the scanner actually located the write sites.
    expect(writes.length, 'no `origin:` write sites found in OrchestratorService').toBeGreaterThanOrEqual(2);

    for (const expr of writes) {
      expect(expr, `origin is written as \`${expr}\` — a literal or ternary here ` +
        `collapses distinct surfaces into one bucket and destroys feature attribution`)
        .toBe('chatType');
    }
  });

  it('the collapse detector actually rejects the shape it is meant to catch', () => {
    // Without this, a regex that matches nothing would keep the suite green.
    const regressed = stripComments(`
      const x = { origin: chatType === 'agent' ? 'agent' : 'chat', foo: 1 };
    `);
    const writes = [...regressed.matchAll(/origin:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
    expect(writes.length).toBe(1);
    expect(writes[0]).not.toBe('chatType');
  });
});
