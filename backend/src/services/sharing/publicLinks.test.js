import { describe, it, expect, vi } from 'vitest';
import { publicShareClient, shareIdFrom, shareOrigin, conversationSnapshot, previewLink } from './publicLinks.js';

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('who shared it', () => {
  const bundle = { version: 1, items: [{ kind: 'agent', sourceId: 'a1', name: 'Researcher', definition: { name: 'Researcher' }, hash: 'h' }] };
  const client = (ref) => ({ origin: 'https://agnt.gg', fetch: async () => ({ title: 'T', author: 'Alice', ref, bundle }) });
  const nodeProvider = { nodes: () => [] };
  it('passes on the referral code the share service recorded for the link', async () => {
    const preview = await previewLink({ link: 'Ab3xYz9kLmNo', client: client('ALICE33'), nodeProvider });
    expect(preview.ref).toBe('ALICE33');
    expect(preview.author).toBe('Alice');
  });
  it('drops anything that is not a code', async () => {
    const preview = await previewLink({ link: 'Ab3xYz9kLmNo', client: client('"><script>'), nodeProvider });
    expect(preview.ref).toBeNull();
  });
});

describe('the share service client', () => {
  it('talks only to the fixed origin, never follows a redirect, and forwards the user sign-in', async () => {
    const fetchImpl = vi.fn(async () => reply(201, { id: 'Ab3xYz9kLmNo' }));
    const client = publicShareClient({ fetchImpl, origin: 'https://agnt.gg' });
    await client.publish('Bearer t', { title: 'x' });
    expect(fetchImpl).toHaveBeenCalledWith('https://agnt.gg/api/shared', expect.objectContaining({ method: 'POST', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer t' }) }));
    await client.fetch('Ab3xYz9kLmNo');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it('tells a dead link from one the service explains, and never reports its own 5xx as ours', async () => {
    const dead = publicShareClient({ fetchImpl: async () => reply(404, {}), origin: 'https://agnt.gg' });
    await expect(dead.fetch('gone00000001')).rejects.toMatchObject({ status: 404, message: 'This share link no longer exists' });
    const conversation = publicShareClient({ fetchImpl: async () => reply(404, { error: 'This link is a conversation to read, not something to add', code: 'not_installable' }), origin: 'https://agnt.gg' });
    await expect(conversation.fetch('chat00000001')).rejects.toMatchObject({ status: 404, code: 'not_installable' });
    const down = publicShareClient({ fetchImpl: async () => reply(503, {}), origin: 'https://agnt.gg' });
    await expect(down.fetch('any000000001')).rejects.toMatchObject({ status: 502 });
    const signedOut = publicShareClient({ fetchImpl: async () => reply(401, {}), origin: 'https://agnt.gg' });
    await expect(signedOut.publish(null, {})).rejects.toMatchObject({ status: 401, message: /Sign in/ });
  });

  it('refuses a non-https share origin outside local development', () => {
    expect(shareOrigin('https://agnt.gg/anything')).toBe('https://agnt.gg');
    expect(shareOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => shareOrigin('http://agnt.gg')).toThrow(/https/);
  });
});

describe('reading a share link', () => {
  it('accepts an id, the agnt.gg page and the app link, and nothing else', () => {
    expect(shareIdFrom('Ab3xYz9kLmNo', 'https://agnt.gg')).toBe('Ab3xYz9kLmNo');
    expect(shareIdFrom('https://agnt.gg/s/Ab3xYz9kLmNo', 'https://agnt.gg')).toBe('Ab3xYz9kLmNo');
    expect(shareIdFrom('agnt://shared?id=Ab3xYz9kLmNo', 'https://agnt.gg')).toBe('Ab3xYz9kLmNo');
    for (const bad of ['https://agnt.gg.evil.example/s/Ab3xYz9kLmNo', 'https://agnt.gg/creations/Ab3xYz9kLmNo', 'agnt://marketplace?id=Ab3xYz9kLmNo', '', 'x']) {
      expect(() => shareIdFrom(bad, 'https://agnt.gg'), bad).toThrow(/not an AGNT share link/);
    }
  });
});

describe('conversation snapshots', () => {
  it('keeps only what was said, in order, from the stored transcript', () => {
    const content = JSON.stringify({ title: 'T', messages: [{ role: 'system', content: 'hidden' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: '' }, { role: 'assistant', content: 'hello' }] });
    expect(conversationSnapshot(content)).toEqual({ title: 'T', messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], removed: 0 });
    expect(conversationSnapshot('not json').messages).toEqual([]);
  });
});
