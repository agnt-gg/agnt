/**
 * CONTRACT: when the Browser Agent attaches to a browser it does not own, it
 * behaves like a guest.
 *
 * The widget renders a real Chromium surface inside AGNT and hands the agent a
 * CDP endpoint onto it. Everything below is a way for that arrangement to go
 * wrong quietly:
 *
 *   - killing the browser on completion would close the window the user is
 *     watching, at the exact moment the task succeeded;
 *   - sending launch-time profile options for a browser we did not launch would
 *     be accepted and then not applied, so `headless: true` would "work" for a
 *     browser visibly on screen and `allowed_domains` would enforce nothing;
 *   - silently launching a browser when the surface is missing would leave the
 *     user staring at an idle page while a hidden Chromium did the work.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-browser-attach-'));

vi.mock('../../../services/auth/AuthManager.js', () => ({
  default: { getValidAccessToken: vi.fn().mockResolvedValue('sk-test-key') },
}));
vi.mock('../../../services/ai/CustomOpenAIProviderService.js', () => ({
  default: { isCustomProvider: vi.fn().mockResolvedValue(false), getProviderCredentials: vi.fn() },
}));
vi.mock('../../../utils/PathManager.js', () => ({
  default: { getUserDataPath: () => tmpDir, getPath: (...p) => path.join(tmpDir, ...p) },
}));

const { default: action } = await import('./ai-browser-use.js');
const { RUNNER_PY } = await import('./browserUseRunner.js');

const CDP = 'ws://127.0.0.1:51234/tok3n';
const llm = { spec: { class: 'ChatGoogle', kwargs: {} }, visionCapable: true, providerName: 'Gemini' };

let config;
beforeEach(() => { config = null; });

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('attach mode', () => {
  it('passes the surface through to the runner', () => {
    config = action.buildRunnerConfig({ cdpUrl: CDP }, 'do a thing', llm);
    expect(config.cdpUrl).toBe(CDP);
  });

  it('sends no launch-time profile options for a browser it did not launch', () => {
    config = action.buildRunnerConfig(
      { cdpUrl: CDP, headless: 'true', allowedDomains: 'example.com' },
      'do a thing',
      llm,
    );
    // Accepting these would be a silent lie: browser-use cannot apply a profile
    // to a browser that was already running when it arrived.
    expect(config.browser).toEqual({});
  });

  it('still honours them when it DOES launch the browser', () => {
    config = action.buildRunnerConfig(
      { headless: 'true', allowedDomains: 'example.com', generateGif: 'false' },
      'do a thing',
      llm,
    );
    expect(config.browser).toEqual({ headless: true, allowed_domains: ['example.com'] });
  });

  it('skips the GIF, because the user is already watching the browser', () => {
    config = action.buildRunnerConfig({ cdpUrl: CDP, generateGif: 'true' }, 'do a thing', llm);
    expect(config.agent.generate_gif).toBe(false);
  });

  it('leaves the surface blank when none was supplied', () => {
    config = action.buildRunnerConfig({ generateGif: 'false' }, 'do a thing', llm);
    expect(config.cdpUrl).toBeNull();
  });
});

describe('the runner treats an attached browser as somebody else\'s', () => {
  it('constructs it with is_local=False', () => {
    expect(RUNNER_PY).toContain('Browser(cdp_url=cdp_url, is_local=False)');
  });

  it('detaches instead of killing when attached', () => {
    // The single most damaging possible bug in this feature: the user watches
    // their own browser vanish the moment the agent succeeds.
    const teardown = RUNNER_PY.slice(RUNNER_PY.indexOf('finally:', RUNNER_PY.indexOf('agent.run')));
    const attachedBranch = teardown.slice(0, teardown.indexOf('else:'));
    expect(attachedBranch).toContain('browser.stop()');
    expect(attachedBranch).not.toContain('browser.kill()');
  });

  it('still kills a browser it launched itself', () => {
    const teardown = RUNNER_PY.slice(RUNNER_PY.indexOf('finally:', RUNNER_PY.indexOf('agent.run')));
    expect(teardown.slice(teardown.indexOf('else:'))).toContain('browser.kill()');
  });
});
