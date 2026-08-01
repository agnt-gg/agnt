// A budget on the prose that ships on EVERY turn.
//
// This is the control that makes the cleanup permanent rather than something
// we repeat in six weeks. Every block below is unconditional: it costs its
// full size on a bare "hey" with no tools loaded, on every conversation, for
// every user. Measured 2026-07-31 the unconditional set was 7,232 raw tokens
// (~10,486 calibrated), of which the Chart.js/D3/Three.js/HTML cheatsheet
// alone was 3,187 — capability documentation resident by default, which is
// exactly the complaint that started this work.
//
// Nothing here forbids adding guidance. It forbids adding it to the
// ALWAYS-RESIDENT tier without a decision: either gate it in
// RESIDENT_GATED_ELEMENTS, or move it to ON_DEMAND_ELEMENTS and let
// discover_tools deliver it into the append-only message region where it is
// free.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  OFFLOADED_DATA_GUIDANCE,
  CRITICAL_TOOL_CALL_REQUIREMENTS,
  AGNT_NATIVE_EXECUTION,
  ARTIFACTS_VS_WIDGETS,
  RESPONSE_FORMATTING,
  LOCAL_FILE_RENDERING,
  CHART_CHEATSHEET,
  VIZ_ADVANCED_CHEATSHEET,
  CRITICAL_TOOL_RESPONSE_RULES,
} from './orchestrator-chat.js';
import { getPlatformContextSection } from './platform-context.js';
import { estimateTokens } from '../../../utils/contextManager.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Everything buildUnifiedPrompt pushes with no `on(...)` guard.
const ALWAYS_RESIDENT = {
  OFFLOADED_DATA_GUIDANCE,
  CRITICAL_TOOL_CALL_REQUIREMENTS,
  AGNT_NATIVE_EXECUTION,
  ARTIFACTS_VS_WIDGETS,
  RESPONSE_FORMATTING,
  LOCAL_FILE_RENDERING,
  CHART_CHEATSHEET,
  CRITICAL_TOOL_RESPONSE_RULES,
  PLATFORM_CONTEXT: getPlatformContextSection(),
};

/**
 * Estimator tokens, not o200k. estimateTokens is what the product itself uses
 * to size the prompt, so the budget is expressed in the same unit the panel
 * and the context manager reason about.
 */
const total = Object.values(ALWAYS_RESIDENT).reduce((a, s) => a + estimateTokens(s || ''), 0);

// Measured at 5,200 estimator-tokens after the split. 6,500 leaves room for a
// genuinely necessary addition while failing on another cheatsheet.
const ALWAYS_RESIDENT_BUDGET = 6_500;

describe('always-resident prose budget', () => {
  it('stays under budget', () => {
    expect(total).toBeLessThanOrEqual(ALWAYS_RESIDENT_BUDGET);
  });

  it('the budget is tight enough to catch a real addition', () => {
    // A budget with 3x headroom would not have caught the 3,187-token
    // cheatsheet that motivated this file.
    expect(ALWAYS_RESIDENT_BUDGET).toBeLessThan(total * 1.6);
  });

  it('no single always-resident block dominates', () => {
    // The failure mode is one block quietly growing into a manual.
    for (const [name, text] of Object.entries(ALWAYS_RESIDENT)) {
      expect(estimateTokens(text || ''), `${name} is too large to be unconditional`).toBeLessThan(1_600);
    }
  });
});

describe('the advanced renderer guides are NOT resident', () => {
  it('D3 / Three.js / HTML live only in the on-demand block', () => {
    expect(CHART_CHEATSHEET).not.toContain('D3.JS VISUALIZATION GUIDE');
    expect(CHART_CHEATSHEET).not.toContain('THREE.JS 3D VISUALIZATION GUIDE');
    expect(CHART_CHEATSHEET).not.toContain('HTML VISUALIZATION');
    expect(VIZ_ADVANCED_CHEATSHEET).toContain('D3.JS VISUALIZATION GUIDE');
    expect(VIZ_ADVANCED_CHEATSHEET).toContain('THREE.JS 3D VISUALIZATION GUIDE');
    expect(VIZ_ADVANCED_CHEATSHEET).toContain('HTML VISUALIZATION');
  });

  it('the split actually moved the weight', () => {
    // Anti-vacuity: passing the assertions above with an empty on-demand block
    // would mean the guidance was deleted, not relocated.
    expect(estimateTokens(VIZ_ADVANCED_CHEATSHEET)).toBeGreaterThan(estimateTokens(CHART_CHEATSHEET) * 2);
  });

  it('the resident block still tells the model how to get them', () => {
    // Gating is only safe if nothing becomes unreachable.
    expect(CHART_CHEATSHEET).toContain('categories=["visualization"]');
    expect(CHART_CHEATSHEET).toContain('discover_tools');
  });

  it('Chart.js itself stays resident — it is the cheap, common case', () => {
    expect(CHART_CHEATSHEET).toContain('chartjs');
    expect(CHART_CHEATSHEET).toContain('"type"');
  });
});

describe('every system-prompt section is frozen for the whole conversation', () => {
  // The system block is a cache prefix. A section that re-derives itself
  // mid-conversation rewrites every cached message after it — ~$1.89 on a 178k
  // conversation, against sections costing a few hundred to a few thousand
  // tokens to send. "Recomputed identically and hoped for" is not the same as
  // frozen: workspace context reads the filesystem, custom instructions and
  // the async toggle read the user row.
  const CHAT_CONFIGS = fs.readFileSync(path.join(HERE, '..', 'chatConfigs.js'), 'utf8');
  const ORCH = fs.readFileSync(path.join(HERE, '..', '..', 'OrchestratorService.js'), 'utf8');

  const FROZEN_KEYS = [
    '_frozenSkillsCatalog',
    '_frozenMemorySection',
    '_frozenCustomInstructions',
    '_frozenWorkspaceSection',
    '_frozenAsyncToolsEnabled',
  ];

  it('each frozen key is memoised on the context in chatConfigs', () => {
    for (const key of FROZEN_KEYS) {
      expect(CHAT_CONFIGS, `${key} is never cached`).toContain(`context.${key} !== undefined`);
      expect(CHAT_CONFIGS, `${key} is never written`).toContain(`context.${key} =`);
    }
  });

  it('each frozen key is restored from the prior turn in OrchestratorService', () => {
    // Memoising on a per-turn context object achieves nothing on its own —
    // the value has to survive into the next turn.
    for (const key of FROZEN_KEYS) {
      expect(ORCH, `${key} is not restored across turns`).toContain(`priorContext.${key}`);
      expect(ORCH).toContain(`conversationContext.${key} = priorContext.${key}`);
    }
  });

  it('the workspace section is reported as frozen to the panel', () => {
    const line = CHAT_CONFIGS.split('\n').find((l) => l.includes("id: 'workspace'"));
    expect(line).toBeTruthy();
    expect(line).toContain('frozen: true');
  });

  it('the prompt sections list has no section still marked unfrozen', () => {
    const start = CHAT_CONFIGS.indexOf('context._promptSections = [');
    const block = CHAT_CONFIGS.slice(start, CHAT_CONFIGS.indexOf('];', start));
    expect(start).toBeGreaterThan(-1);
    expect(block).not.toContain('frozen: false');
  });
});
