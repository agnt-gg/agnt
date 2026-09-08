import { it, expect, vi } from 'vitest';
import { createSpeechOut } from './speechOut.js';
class Utterance { constructor(text) { this.text = text; } }
function harness(fetch) {
  const speechSynthesis = { speak: vi.fn(u => queueMicrotask(() => { u.onstart(); u.onend(); })), cancel: vi.fn() };
  const out = createSpeechOut({ engine: 'provider' }, { fetch, speechSynthesis, SpeechSynthesisUtterance: Utterance });
  return { out, speechSynthesis };
}
it('demotes unavailable credentials once across queued chunks and turn resets', async () => {
  const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ available: false, reason: 'no-credentials:openai' }) }));
  const { out, speechSynthesis } = harness(fetch);
  await Promise.all([out.speak('First.'), out.speak('Second.')]);
  out.reset(); await out.speak('Third.');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(out.config.engine).toBe('webspeech');
  expect(speechSynthesis.speak.mock.calls.map(([u]) => u.text)).toEqual(['First.', 'Second.', 'Third.']);
});
it('does not let delayed unavailable JSON demote a newer session generation', async () => {
  let resolve;
  const started = new Promise(r => { resolve = r; });
  let finish;
  const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
    json: () => { resolve(); return new Promise(r => { finish = r; }); } }));
  const { out, speechSynthesis } = harness(fetch);
  const pending = out.speak('Stale.'); await started; out.cancel();
  finish({ available: false }); await pending;
  expect(out.config.engine).toBe('provider');
  expect(speechSynthesis.speak).not.toHaveBeenCalled();
});
it.each([401,403,429])('demotes HTTP %s once, never switches to another provider', async status => {
  const fetch = vi.fn(async () => ({ ok: false, status }));
  const { out } = harness(fetch);
  await Promise.all([out.speak('First.'), out.speak('Second.')]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(out.config.providerEngine).toBe('openai');
});
it('allows explicit reconfiguration to retry the chosen provider', async () => {
  const fetch = vi.fn(async () => ({ ok: false, status: 429 }));
  const { out } = harness(fetch);
  await out.speak('First.'); out.configure({ engine: 'provider' }); await out.speak('Retry.');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not demote or speak a late response from a cancelled generation', async () => {
  let resolve;
  const fetch = vi.fn(() => new Promise(r => { resolve = r; }));
  const { out, speechSynthesis } = harness(fetch);
  const pending = out.speak('Stale.'); await Promise.resolve(); out.cancel();
  resolve({ ok: false, status: 429 }); await pending;
  expect(out.config.engine).toBe('provider');
  expect(speechSynthesis.speak).not.toHaveBeenCalled();
});
