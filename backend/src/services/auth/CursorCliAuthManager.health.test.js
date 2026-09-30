/**
 * Cursor health = "can the CLI actually talk to Cursor", proven by `models`.
 *
 * Verified live 2026-09-30: `cursor-agent status` printed "Logged in (unable to
 * fetch user details)" while `cursor-agent models` failed with "Authentication
 * required". AGNT used status, so it showed Cursor as connected and every
 * request failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { default: manager, parseCursorModels, CURSOR_UNAUTHENTICATED } = await import('./CursorCliAuthManager.js');

const LIVE_AUTH_ERROR = "Error: Authentication required. Run 'agent login', pass --api-key/--auth-token, or set CURSOR_API_KEY/CURSOR_AUTH_TOKEN.\n";
const MODELS_OUTPUT = 'Available models\n\nauto - Auto\ncomposer-2.5 - Composer 2.5\ncursor-grok-4.5-high - Grok 4.5 High\nclaude-opus-5-high - Claude Opus 5 (High)\n\nTip: use --model <id>\n';

let run;
beforeEach(() => {
  manager.apiCheckCache = null;
  run = vi.spyOn(manager, '_runCursor');
});
afterEach(() => {
  vi.restoreAllMocks();
  manager.apiCheckCache = null;
});

describe('Cursor health check', () => {
  it('REGRESSION: a rejected session is NOT usable, whatever `status` would have said', async () => {
    run.mockImplementation(async (args) => (args[0] === 'status'
      ? { exitCode: 0, stdout: '✓ Login successful!\nLogged in (unable to fetch user details)\n', stderr: '' }
      : { exitCode: 1, stdout: '', stderr: LIVE_AUTH_ERROR }));

    const status = await manager.checkApiUsable({ forceRefresh: true });

    expect(run).toHaveBeenCalledWith(['models'], expect.anything());
    expect(run).not.toHaveBeenCalledWith(['status'], expect.anything());
    expect(status).toMatchObject({ available: false, apiUsable: false, apiStatus: 401, models: [] });
    expect(status.error).toMatch(/cursor-agent login/);
    expect(manager.getAccessToken()).toBeNull();
  });

  it('a working session is usable and carries the live model list', async () => {
    run.mockResolvedValue({ exitCode: 0, stdout: MODELS_OUTPUT, stderr: '' });
    const status = await manager.checkApiUsable({ forceRefresh: true });
    expect(status).toMatchObject({ apiUsable: true, apiStatus: 200 });
    expect(status.models).toEqual(['auto', 'composer-2.5', 'cursor-grok-4.5-high', 'claude-opus-5-high']);
    expect(manager.getAccessToken()).toBe('cursor-cli-session');
  });

  it('an unrecognised failure is unusable and says what the CLI printed', async () => {
    run.mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'network unreachable' });
    const status = await manager.checkApiUsable({ forceRefresh: true });
    expect(status).toMatchObject({ apiUsable: false, apiStatus: 2, error: 'network unreachable' });
  });

  it('a CLI that cannot be spawned is unusable, not a crash', async () => {
    run.mockRejectedValue(new Error('spawn cursor-agent ENOENT'));
    const status = await manager.checkApiUsable({ forceRefresh: true });
    expect(status).toMatchObject({ apiUsable: false, error: 'spawn cursor-agent ENOENT', models: [] });
  });

  it('caches the answer for the TTL, so a chat does not spawn the CLI every time', async () => {
    run.mockResolvedValue({ exitCode: 0, stdout: MODELS_OUTPUT, stderr: '' });
    await manager.checkApiUsable({ forceRefresh: true });
    await manager.checkApiUsable();
    await manager.checkApiUsable();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('parseCursorModels / CURSOR_UNAUTHENTICATED', () => {
  it('reads ids only from `<id> - <label>` lines', () => {
    expect(parseCursorModels(MODELS_OUTPUT)).toEqual(['auto', 'composer-2.5', 'cursor-grok-4.5-high', 'claude-opus-5-high']);
    expect(parseCursorModels('')).toEqual([]);
    expect(parseCursorModels(undefined)).toEqual([]);
  });

  it('recognises the live auth error and the older wording', () => {
    expect(CURSOR_UNAUTHENTICATED.test(LIVE_AUTH_ERROR)).toBe(true);
    expect(CURSOR_UNAUTHENTICATED.test('Not logged in')).toBe(true);
    expect(CURSOR_UNAUTHENTICATED.test(MODELS_OUTPUT)).toBe(false);
  });
});
