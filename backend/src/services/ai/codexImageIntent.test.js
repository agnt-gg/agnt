import { describe, it, expect, vi } from 'vitest';
import * as intent from './codexImageIntent.js';

describe('Feature: subscription image choices without silent fallback', () => {
  it.each(['latest','latest-fast'])('Given choice %s, When bound to a turn, Then policy and account are immutable', policy => {
    const source = { provider: 'openai-codex', enabled: true, policy };
    const bound = intent.bindCodexImageIntent(source, 'openai-codex');
    source.policy = 'provider-default';
    expect(bound).toEqual({ provider: 'openai-codex', enabled: true, policy });
    expect(Object.isFrozen(bound)).toBe(true);
  });
  it('Given a Codex chat without consent, When binding, Then images are off', () => {
    expect(intent.bindCodexImageIntent(undefined, 'openai-codex')).toEqual({provider:'openai-codex',enabled:false,policy:'latest'});
  });
  it.each(['false','yes',1,null])('Given nonboolean enabled %j, When binding, Then consent is not inferred', enabled => {
    expect(intent.bindCodexImageIntent({provider:'openai-codex',enabled,policy:'latest'},'openai-codex').enabled).toBe(false);
  });
  it.each(['openai','gemini','https://api.openai.com'])('Given substitution to %s, When authorizing, Then reject before any client', provider => {
    const ctx={codexImageIntent:intent.bindCodexImageIntent({provider:'openai-codex',enabled:true,policy:'latest'},'openai-codex')};
    expect(()=>intent.authorizeCodexImageCall({provider},ctx)).toThrow(/account|provider/i);
  });
  it('Given account1, When a call requests account2, Then reject even with fallback enabled',()=>{
    const ctx={codexImageIntent:{provider:'openai-codex',enabled:true,policy:'latest'},fallbackEnabled:true};
    expect(()=>intent.authorizeCodexImageCall({provider:'openai-codex-2'},ctx)).toThrow(/account/);
  });
  it.each(['provider-default','latest-fast','gpt-image-2'])('Given latest, When overridden by %s, Then reject',model=>{
    expect(()=>intent.authorizeCodexImageCall({model},{codexImageIntent:{provider:'openai-codex',enabled:true,policy:'latest'}})).toThrow(/selection/);
  });
  it('Given off, When the model requests generation, Then deny',()=>{
    expect(()=>intent.authorizeCodexImageCall({}, {codexImageIntent:{provider:'openai-codex',enabled:false,policy:'latest'}})).toThrow(/disabled/);
  });
  it.each(['latest','latest-fast'])('Given experimental selector %s, When authorized, Then bind that request without inferring engine identity',policy=>{
    expect(intent.authorizeCodexImageCall({}, {codexImageIntent:{provider:'openai-codex',enabled:true,policy}})).toEqual({provider:'openai-codex',model:policy});
  });
  it('Given a non-Codex caller without subscription intent, Then ordinary providers are unchanged',()=>{
    expect(intent.bindCodexImageIntent(undefined,'gemini')).toBeNull();
    expect(intent.authorizeCodexImageCall({provider:'gemini'},{})).toBeNull();
  });
  it('Given runtime status, Then choices are experimental rather than verified',()=>{
    const status=intent.codexImageChoiceStatus();
    expect(status.choices.map(c=>c.policy)).toEqual(['latest','latest-fast']);
    expect(status.choices.every(c=>c.available===true && c.experimental===true && c.reason)).toBe(true);
    expect(status.subscriptionSelectionVerified).toBe(false);
  });
  it('Given account1 selected, When payload names account2, Then reject mismatched consent',()=>{
    expect(()=>intent.bindCodexImageIntent({provider:'openai-codex-2',enabled:true,policy:'latest'},'openai-codex')).toThrow(/account/);
  });
  it('Given malformed JSON preference, Then it cannot become consent',()=>{
    expect(()=>intent.bindCodexImageIntent('{broken','openai-codex')).toThrow(/preference/);
  });
});
