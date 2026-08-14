/**
 * routingMode — the resolution ladder.
 *
 * The invariant under test throughout: DYNAMIC ROUTING NEVER OVERRIDES A
 * CHOICE A HUMAN MADE. It only fills the slot where the system was about to
 * guess. Most of these cases exist to prove that a pin at some scope, or a
 * legacy caller that predates the feature, cannot be hijacked by the account
 * toggle.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRoutingMode,
  normalizeGlobalRoutingMode,
  normalizeScopeRoutingMode,
  normalizeRoutingPolicy,
  parseRoutingPolicy,
  serializeRoutingPolicy,
  lambdaForPolicy,
  POLICY_LAMBDA,
} from './routingMode.js';

describe('normalizers refuse to invent a mode', () => {
  it('unknown/absent global mode is static, never dynamic', () => {
    for (const v of [undefined, null, '', 'DYNAMIC ', 'dynamik', 'on', true, 42, {}]) {
      const out = normalizeGlobalRoutingMode(v);
      expect(out === 'dynamic' && v !== 'DYNAMIC ').toBe(false);
    }
    expect(normalizeGlobalRoutingMode('static')).toBe('static');
    expect(normalizeGlobalRoutingMode('dynamic')).toBe('dynamic');
    // Whitespace/case are transport noise, not intent.
    expect(normalizeGlobalRoutingMode(' DYNAMIC ')).toBe('dynamic');
  });

  it('scope mode returns null when the scope is silent', () => {
    expect(normalizeScopeRoutingMode(undefined)).toBeNull();
    expect(normalizeScopeRoutingMode(null)).toBeNull();
    expect(normalizeScopeRoutingMode('nonsense')).toBeNull();
    expect(normalizeScopeRoutingMode('pinned')).toBe('pinned');
    expect(normalizeScopeRoutingMode('default')).toBe('default');
    expect(normalizeScopeRoutingMode('dynamic')).toBe('dynamic');
  });

  it('policy falls back to balanced and maps to a lambda', () => {
    expect(normalizeRoutingPolicy('junk')).toBe('balanced');
    expect(lambdaForPolicy('save')).toBe(POLICY_LAMBDA.save);
    expect(lambdaForPolicy('quality')).toBe(POLICY_LAMBDA.quality);
  });

  it('lambda ordering encodes the dial: save > balanced > quality', () => {
    // If this ever inverts, "Save money" starts buying the expensive model.
    expect(POLICY_LAMBDA.save).toBeGreaterThan(POLICY_LAMBDA.balanced);
    expect(POLICY_LAMBDA.balanced).toBeGreaterThan(POLICY_LAMBDA.quality);
  });

  it('quality mode still weighs cost at all', () => {
    // λ=0 would mean "always burn the most expensive model that qualifies",
    // which is not what a user asking for quality is asking for.
    expect(POLICY_LAMBDA.quality).toBeGreaterThan(0);
  });

  it('a corrupt policy column never breaks a turn', () => {
    expect(parseRoutingPolicy('{not json').mode).toBe('balanced');
    expect(parseRoutingPolicy('').mode).toBe('balanced');
    expect(parseRoutingPolicy(null).mode).toBe('balanced');
    expect(parseRoutingPolicy('{"mode":"save"}').mode).toBe('save');
    expect(parseRoutingPolicy({ mode: 'quality' }).lambda).toBe(POLICY_LAMBDA.quality);
  });

  it('serialize round-trips and sanitises', () => {
    expect(parseRoutingPolicy(serializeRoutingPolicy('save')).mode).toBe('save');
    expect(parseRoutingPolicy(serializeRoutingPolicy('nonsense')).mode).toBe('balanced');
  });
});

describe('explicit pins are sacred', () => {
  it('a pinned request wins over a dynamic account', () => {
    const r = resolveRoutingMode({ requestMode: 'pinned', globalMode: 'dynamic' });
    expect(r).toEqual({ mode: 'static', source: 'request', pinned: true });
  });

  it('a pinned conversation wins over a dynamic account', () => {
    const r = resolveRoutingMode({ conversationMode: 'pinned', globalMode: 'dynamic' });
    expect(r.mode).toBe('static');
    expect(r.source).toBe('conversation');
  });

  it('a pinned agent wins over a dynamic account', () => {
    const r = resolveRoutingMode({ agentMode: 'pinned', globalMode: 'dynamic' });
    expect(r.mode).toBe('static');
    expect(r.source).toBe('agent');
  });

  it('a pinned conversation wins even when the AGENT is dynamic', () => {
    // Specificity beats the broader scope in both directions, not just
    // whichever direction happens to turn the feature off.
    const r = resolveRoutingMode({ conversationMode: 'pinned', agentMode: 'dynamic', globalMode: 'dynamic' });
    expect(r.mode).toBe('static');
    expect(r.source).toBe('conversation');
  });
});

describe('BACKWARD COMPATIBILITY — the rule that makes this safe to ship', () => {
  it('a legacy caller (provider+model, no mode) is treated as pinned even when the account is dynamic', () => {
    // This is every workflow node, tool call and public-API consumer written
    // before routing existed. If this case ever routes, enabling the toggle
    // silently relocates other people's integrations.
    const r = resolveRoutingMode({ requestHasPin: true, globalMode: 'dynamic' });
    expect(r.mode).toBe('static');
    expect(r.pinned).toBe(true);
  });

  it('a legacy caller with NO pin and a static account is static', () => {
    expect(resolveRoutingMode({}).mode).toBe('static');
    expect(resolveRoutingMode({ globalMode: 'static' }).mode).toBe('static');
  });

  it('an unrecognised request mode does not silently enable routing', () => {
    const r = resolveRoutingMode({ requestMode: 'dyn4mic', globalMode: 'static' });
    expect(r.mode).toBe('static');
  });
});

describe('"default" means keep looking, not "off"', () => {
  it('request default + dynamic account routes dynamically', () => {
    const r = resolveRoutingMode({ requestMode: 'default', globalMode: 'dynamic' });
    expect(r).toEqual({ mode: 'dynamic', source: 'global', pinned: false });
  });

  it('request default + static account stays static', () => {
    expect(resolveRoutingMode({ requestMode: 'default', globalMode: 'static' }).mode).toBe('static');
  });

  it('default cascades past every intermediate scope', () => {
    const r = resolveRoutingMode({
      requestMode: 'default',
      conversationMode: 'default',
      agentMode: 'default',
      globalMode: 'dynamic',
    });
    expect(r.source).toBe('global');
    expect(r.mode).toBe('dynamic');
  });

  it('a request that says default and ALSO carries a pin still defers', () => {
    // The tri-state UI sends mode explicitly. An explicit 'default' is a
    // statement, so it must beat the legacy pin inference — otherwise a chat
    // set back to Default could never actually leave its old model.
    const r = resolveRoutingMode({ requestMode: 'default', requestHasPin: true, globalMode: 'dynamic' });
    expect(r.mode).toBe('dynamic');
  });
});

describe('opting in at a narrow scope', () => {
  it('a dynamic conversation routes even when the account is static', () => {
    const r = resolveRoutingMode({ conversationMode: 'dynamic', globalMode: 'static' });
    expect(r.mode).toBe('dynamic');
    expect(r.source).toBe('conversation');
  });

  it('a dynamic agent routes even when the account is static', () => {
    const r = resolveRoutingMode({ agentMode: 'dynamic', globalMode: 'static' });
    expect(r.mode).toBe('dynamic');
    expect(r.source).toBe('agent');
  });

  it('the account toggle flips every un-pinned surface at once', () => {
    const surfaces = [
      {},
      { conversationMode: 'default' },
      { agentMode: 'default' },
      { conversationMode: null, agentMode: null },
    ];
    for (const s of surfaces) {
      expect(resolveRoutingMode({ ...s, globalMode: 'dynamic' }).mode).toBe('dynamic');
      expect(resolveRoutingMode({ ...s, globalMode: 'static' }).mode).toBe('static');
    }
  });
});

describe('OFF is instant and total', () => {
  it('with the account static and no scope opting in, nothing routes', () => {
    const combos = [
      { requestMode: undefined, conversationMode: undefined, agentMode: undefined },
      { requestMode: 'default', conversationMode: 'default', agentMode: 'default' },
      { requestHasPin: true },
    ];
    for (const c of combos) {
      expect(resolveRoutingMode({ ...c, globalMode: 'static' }).mode).toBe('static');
    }
  });
});
