import { describe, it, expect, vi } from 'vitest';

/**
 * AGNT Flash is credentialed by the signed-in session, not a stored key.
 *
 * With no session cached the node used to build an OpenAI client with
 * `apiKey: null`, which the SDK sends as `Authorization: Bearer null`.
 * models.agnt.gg answered 401 "not signed in" — technically true, but it read
 * as the server rejecting a real account and hid the local cause. A missing
 * session must fail here, before any request leaves the machine.
 */
async function actionWithCredential(credential) {
  const { default: singleton } = await import('./generate-with-ai-llm.js');
  const action = Object.create(singleton);
  action.authManager = { getValidAccessToken: vi.fn(async () => credential) };
  action.generateWithOpenAiLike = vi.fn(async () => ({ generatedText: 'sent' }));
  return action;
}

const run = (action, provider = 'agnt') =>
  action.execute({ provider, model: 'agnt-flash', prompt: 'hi' }, {}, { userId: 'user-1' });

describe('AGNT Flash without a signed-in session', () => {
  it('fails locally with a sign-in message and sends nothing', async () => {
    const action = await actionWithCredential(null);
    const result = await run(action);
    expect(action.generateWithOpenAiLike).not.toHaveBeenCalled();
    expect(result.error).toMatch(/Sign in to AGNT/);
  });

  it('still calls the service when a session token is present', async () => {
    const action = await actionWithCredential('session-token');
    const result = await run(action);
    expect(action.generateWithOpenAiLike).toHaveBeenCalledTimes(1);
    expect(action.generateWithOpenAiLike.mock.calls[0][0].apiKey).toBe('session-token');
    expect(result.error ?? null).toBeNull();
  });

  it('leaves keyless local providers alone', async () => {
    const action = await actionWithCredential(null);
    await run(action, 'local');
    expect(action.generateWithOpenAiLike).toHaveBeenCalledTimes(1);
  });
});
