import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchReleases, findRelease, parseChange, groupChanges, RELEASES_URL } from './releaseNotes.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchReleases', () => {
  it('returns the feed releases', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ releases: [{ version: '1.0.0' }] }) }));
    await expect(fetchReleases()).resolves.toEqual([{ version: '1.0.0' }]);
    expect(globalThis.fetch).toHaveBeenCalledWith(RELEASES_URL, expect.objectContaining({ signal: expect.anything() }));
  });

  it('returns an empty list when the feed has no releases array', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ releases: 'nope' }) }));
    await expect(fetchReleases()).resolves.toEqual([]);
  });

  it('rejects on a non-OK answer instead of parsing an error page', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    await expect(fetchReleases()).rejects.toThrow('502');
  });
});

describe('findRelease', () => {
  const releases = [{ version: '0.6.7' }, { version: '0.6.6' }];
  it('finds the exact version', () => expect(findRelease(releases, '0.6.6')).toEqual({ version: '0.6.6' }));
  it('returns null for a version the feed does not have yet', () => expect(findRelease(releases, '0.6.8')).toBeNull());
  it('tolerates missing input', () => {
    expect(findRelease(null, '0.6.7')).toBeNull();
    expect(findRelease(releases, '')).toBeNull();
  });
});

describe('parseChange', () => {
  it('splits plan, lead-in and rest', () => {
    expect(parseChange('[Team] Teamspaces: invite-only spaces')).toEqual({ plan: 'Team', lead: 'Teamspaces', rest: 'invite-only spaces' });
  });
  it('keeps a plain sentence whole', () => {
    expect(parseChange('Large previews open instantly')).toEqual({ plan: null, lead: null, rest: 'Large previews open instantly' });
  });
  it('does not treat a late colon as a headline', () => {
    const name = 'Gemini CLI is gone because Google stopped it for personal accounts on that date: use Antigravity';
    expect(parseChange(name).lead).toBeNull();
  });
  it('handles a missing name', () => expect(parseChange(undefined)).toEqual({ plan: null, lead: null, rest: '' }));
});

describe('groupChanges', () => {
  it('orders New, Improved, Fixed and drops empty groups', () => {
    const groups = groupChanges({ features: [{ name: 'b', status: 'bug' }, { name: 'n', status: 'new' }, { name: 'x', status: 'other' }] });
    expect(groups.map((group) => [group.label, group.changes.length])).toEqual([['New', 1], ['Fixed', 1]]);
  });
  it('returns nothing for a release without features', () => expect(groupChanges({})).toEqual([]));
});
