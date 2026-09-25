/**
 * Grok Build reasoning effort: the UI control and the wire must agree, and
 * both must follow what cli-chat-proxy.grok.com publishes per model.
 *
 * The proxy VALIDATES the value — an effort a model does not list is
 * HTTP 400 "Invalid reasoning effort." (verified live 2026-09) — so offering
 * or sending one it did not publish is a broken request, not a no-op.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  getReasoningControl,
  getModelMetadata,
  getModelMetadataForClient,
  registerGrokBuildProxyCatalog,
} from './providerConfigs.js';
import { buildOpenAiLikeReasoningExtraBody } from '../orchestrator/llmAdapters.js';

const values = (control) => (control?.options || []).map((o) => o.value);
const labelOf = (control, value) => control.options.find((o) => o.value === value)?.label;

beforeAll(() => {
  // What grokBuildProxyModels.listProxyModelEntries produces from the live /v1/models.
  registerGrokBuildProxyCatalog([
    { id: 'grok-4.7', contextWindow: 500000, reasoningEfforts: ['xhigh', 'high', 'medium', 'low'], reasoningDefaultEffort: 'high' },
    { id: 'grok-4.7-build-fast', contextWindow: 500000, reasoningEfforts: ['xhigh', 'high', 'medium', 'low'], reasoningDefaultEffort: 'high' },
    { id: 'grok-4.5', contextWindow: 500000, reasoningEfforts: ['high', 'medium', 'low'], reasoningDefaultEffort: 'high' },
    // A grok-4.x the proxy says takes NO effort: the predicate would match it,
    // so this proves the published answer beats the fallback.
    { id: 'grok-4.8-noeffort', contextWindow: 500000, reasoningEfforts: [] },
  ]);
});

describe('control: what the proxy published decides', () => {
  it('grok-4.7 offers the published ladder, low → xhigh, with no Off', () => {
    const control = getReasoningControl('grok-build', 'grok-4.7');
    expect(control.kind).toBe('effort');
    expect(values(control)).toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
    expect(labelOf(control, 'xhigh')).toBe('Max');
  });

  it('grok-4.5 does not offer xhigh — it does not publish it', () => {
    expect(values(getReasoningControl('grok-build', 'grok-4.5'))).toEqual(['default', 'low', 'medium', 'high']);
  });

  it('an empty published list means no control, even though the predicate matches', () => {
    expect(getReasoningControl('grok-build', 'grok-4.8-noeffort')).toBeNull();
  });
});

describe('control: offline fallback (nothing published yet)', () => {
  it('an unpublished grok-4.x gets the grades every Grok model takes — no xhigh', () => {
    expect(values(getReasoningControl('grok-build', 'grok-4.9-cold'))).toEqual(['default', 'low', 'medium', 'high']);
  });

  it('a non grok-4.x id gets nothing', () => {
    expect(getReasoningControl('grok-build', 'cursor-grok-4.6')).toBeNull();
  });
});

describe('metadata', () => {
  it('static metadata still wins over the registered catalog row', () => {
    // The proxy says 500000; the hand-written entry (512000, $0) must not be shadowed.
    const meta = getModelMetadata('grok-build', 'grok-4.7');
    expect(meta.contextWindow).toBe(512000);
    expect(meta.inputCostPer1M).toBe(0);
  });

  it('the client metadata carries the published control', () => {
    expect(values(getModelMetadataForClient('grok-build', 'grok-4.7').reasoningControl))
      .toEqual(['default', 'low', 'medium', 'high', 'xhigh']);
  });
});

describe('wire: send only an effort this model offers', () => {
  const wire = (model, value) => buildOpenAiLikeReasoningExtraBody('grok-build', model, value);

  it('sends the selected effort verbatim', () => {
    expect(wire('grok-4.7', 'xhigh')).toEqual({ reasoning_effort: 'xhigh' });
    expect(wire('grok-4.7', 'low')).toEqual({ reasoning_effort: 'low' });
    expect(wire('grok-4.5', 'medium')).toEqual({ reasoning_effort: 'medium' });
  });

  it('default sends nothing — the proxy applies its own (high)', () => {
    expect(wire('grok-4.7', 'default')).toBeNull();
    expect(wire('grok-4.7', undefined)).toBeNull();
  });

  it('a sticky xhigh carried to grok-4.5 is dropped, not sent into a 400', () => {
    expect(wire('grok-4.5', 'xhigh')).toBeNull();
  });

  it('off and the legacy on toggle are never sent — no Grok model lists them', () => {
    expect(wire('grok-4.7', 'off')).toBeNull();
    expect(wire('grok-4.7', 'on')).toBeNull();
  });

  it('a model the proxy says takes no effort gets nothing', () => {
    expect(wire('grok-4.8-noeffort', 'low')).toBeNull();
  });
});
