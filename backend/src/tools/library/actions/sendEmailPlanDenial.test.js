/**
 * The send-email node explains a plan refusal instead of leaking axios's wording.
 *
 * Email is a paid feature, so the moment `.enforce-plan-gates` is flipped every
 * free account's send-email node starts failing. What that node SAYS at that
 * moment is the difference between a support ticket and an upgrade.
 *
 * Tested at the node, not just at the helper: a correct helper that nobody
 * calls changes nothing, and the wiring is the part that gets lost in a merge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../../services/auth/sessionTokenCache.js', () => ({
  authHeader: () => ({ Authorization: 'Bearer test-token' }),
}));

const axios = (await import('axios')).default;
// The module exports a constructed SINGLETON, not the class — the same shape as
// every other node in the tool library.
const { default: sendEmail } = await import('./send-email.js');

const denial = () => {
  const error = new Error('Request failed with status code 403');
  error.response = { status: 403, data: { error: 'Feature not available', requiredFeature: 'emailServer' } };
  return error;
};

const engine = { workflowId: 'wf-1' };
const params = { to: 'a@example.com', subject: 'hi', body: 'there' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REMOTE_URL = 'https://api.test';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a plan refusal', () => {
  it('surfaces an upgrade message, not the axios wording', async () => {
    axios.post.mockRejectedValue(denial());

    await expect(sendEmail.execute(params, {}, engine)).rejects.toThrow(/not included in your current AGNT plan/i);
  });

  it('does not leak "status code 403" to the user', async () => {
    axios.post.mockRejectedValue(denial());

    const error = await sendEmail.execute(params, {}, engine).catch((e) => e);
    expect(error.message).not.toMatch(/status code/i);
    expect(error.message).toMatch(/Email/);
    expect(error.message).toMatch(/Billing/);
  });
});

describe('everything else is unchanged', () => {
  it('a real failure propagates as-is', async () => {
    // The node must not start reporting outages as billing problems.
    const boom = new Error('socket hang up');
    axios.post.mockRejectedValue(boom);

    await expect(sendEmail.execute(params, {}, engine)).rejects.toThrow('socket hang up');
  });

  it('a 403 that is NOT an entitlement refusal propagates as-is', async () => {
    const suspended = new Error('Request failed with status code 403');
    suspended.response = { status: 403, data: { error: 'Account suspended' } };
    axios.post.mockRejectedValue(suspended);

    const error = await sendEmail.execute(params, {}, engine).catch((e) => e);
    expect(error.message).not.toMatch(/upgrade/i);
  });

  it('a successful send still returns the message id', async () => {
    axios.post.mockResolvedValue({ status: 200, statusText: 'OK', data: { messageId: 'msg-1' }, headers: {} });

    const result = await sendEmail.execute(params, {}, engine);
    expect(JSON.stringify(result)).toContain('msg-1');
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.test/email/send',
      { params, workflowId: 'wf-1' },
      { headers: { Authorization: 'Bearer test-token' } }
    );
  });
});
