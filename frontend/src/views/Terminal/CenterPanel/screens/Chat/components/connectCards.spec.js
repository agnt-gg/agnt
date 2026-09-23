import { describe, expect, it } from 'vitest';
import { connectTarget, fallbackProviderName } from './connectCards.js';

describe('connectTarget', () => {
  it('turns agnt_auth connect_provider into a card for that provider', () => {
    expect(connectTarget({ name: 'agnt_auth', args: { operation: 'connect_provider', provider_name: 'gmail' } })).toBe('gmail');
  });

  it('reads arguments that arrive as a JSON string', () => {
    expect(connectTarget({ name: 'agnt_auth', args: '{"operation":"connect_provider","provider_name":" slack "}' })).toBe('slack');
  });

  it('is not a card while arguments are still streaming', () => {
    expect(connectTarget({ name: 'agnt_auth', args: '{"operation":"connect_prov' })).toBeNull();
    expect(connectTarget({ name: 'agnt_auth', args: undefined })).toBeNull();
  });

  it('ignores every other auth operation and every other tool', () => {
    expect(connectTarget({ name: 'agnt_auth', args: { operation: 'disconnect_provider', provider_name: 'gmail' } })).toBeNull();
    expect(connectTarget({ name: 'agnt_auth', args: { operation: 'get_connected_apps' } })).toBeNull();
    expect(connectTarget({ name: 'web_search', args: { operation: 'connect_provider', provider_name: 'gmail' } })).toBeNull();
    expect(connectTarget({ name: 'agnt_auth', args: { operation: 'connect_provider', provider_name: '' } })).toBeNull();
    expect(connectTarget(null)).toBeNull();
  });
});

describe('fallbackProviderName', () => {
  it('makes a readable label from an id', () => {
    expect(fallbackProviderName('google-calendar')).toBe('Google Calendar');
    expect(fallbackProviderName('github')).toBe('Github');
    expect(fallbackProviderName('')).toBe('');
  });
});
