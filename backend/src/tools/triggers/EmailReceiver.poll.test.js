import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../services/auth/sessionTokenCache.js', () => ({ authHeader: () => ({}) }));
const { default: axios } = await import('axios');
const { default: EmailReceiver } = await import('./EmailReceiver.js');

// An axios-like error: the real one carries the request, socket and agent,
// which is what turned every failed poll into a multi-kilobyte log entry.
const httpError = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), {
  isAxiosError: true, response: { status, data }, request: { socket: { big: 'x'.repeat(5000) } },
});

let receiver, logs;
beforeEach(() => {
  process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
  receiver = new EmailReceiver({});
  receiver.pollInterval = setInterval(() => {}, 1e9); // as if polling had started
  logs = [];
  for (const level of ['log', 'warn', 'error']) vi.spyOn(console, level).mockImplementation((...args) => logs.push(args));
});
afterEach(() => { receiver.stopPolling(); vi.restoreAllMocks(); delete process.env.AGNT_DISABLE_EXTERNAL_POLLING; });

describe('EmailReceiver polling failures', () => {
  it('Given the mail service reports it is retired Then polling stops with one short line', async () => {
    axios.get.mockRejectedValue(httpError(410, { error: 'retired', reason: 'pro_required', service: 'mail.agnt.gg' }));
    await receiver.pollForTriggers();
    await receiver.pollForTriggers();
    expect(receiver.pollInterval).toBeNull();
    const text = logs.map(a => a.map(String).join(' ')).join('\n');
    expect(text).toMatch(/email triggers unavailable.*retired.*pro_required/i);
    expect(text.length).toBeLessThan(400);
    expect(logs.some(a => a.some(x => typeof x === 'object'))).toBe(false);
  });

  it('Given no sign-in yet (401) repeatedly Then keep polling but log it once', async () => {
    axios.get.mockRejectedValue(httpError(401, { error: 'Authentication required', reason: 'missing' }));
    for (let i = 0; i < 5; i++) await receiver.pollForTriggers();
    expect(receiver.pollInterval).not.toBeNull();
    expect(logs).toHaveLength(1);
    expect(String(logs[0].join(' '))).toMatch(/401/);
  });

  it('Given the failure reason changes Then log again, and a recovery is noted once', async () => {
    axios.get.mockRejectedValueOnce(httpError(502, { error: 'Bad gateway' }));
    axios.get.mockRejectedValueOnce(httpError(502, { error: 'Bad gateway' }));
    axios.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    axios.get.mockResolvedValueOnce({ data: { triggers: [] } });
    for (let i = 0; i < 4; i++) await receiver.pollForTriggers();
    const text = logs.map(a => a.map(String).join(' '));
    expect(text).toHaveLength(3);
    expect(text[0]).toMatch(/502/);
    expect(text[1]).toMatch(/ECONNREFUSED/);
    expect(text[2]).toMatch(/recovered/i);
  });
});
