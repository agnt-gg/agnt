import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import PluginManager from './PluginManager.js';
import ToolConfig from '../tools/ToolConfig.js';

/**
 * Registering a plugin trigger must NOT import its module.
 *
 * Importing a trigger pulls in its whole dependency tree (googleapis,
 * discord.js, @slack/web-api — 290 MB / 12k files across the trigger plugins on
 * a typical install). That used to happen at boot for every installed trigger
 * whether or not any workflow referenced it, and on a cold file cache it was
 * the largest single term in startup: 43s of a 90s packaged boot, with the same
 * imports costing ~1.7s each once warm.
 *
 * The cost is invisible in every ordinary code reading — `await import(url)`
 * looks free — and no test asserted the property, so nothing would notice it
 * being reintroduced. These tests exist to fail loudly if it is.
 *
 * The probe module is written to disk rather than mocked on purpose: the
 * behaviour under test is whether a real dynamic import is issued, which a
 * module mock would hide.
 */

const probeSource = () => `
globalThis.__triggerImports = (globalThis.__triggerImports || 0) + 1;
export default {
  setup: async () => { globalThis.__triggerSetups = (globalThis.__triggerSetups || 0) + 1; },
  validate: (triggerData) => triggerData?.accept === true,
  process: async (input) => ({ ...input, processed: true }),
  teardown: async () => { globalThis.__triggerTeardowns = (globalThis.__triggerTeardowns || 0) + 1; },
};
`;

let pluginDir;
let probeCounter = 0;
const registeredTypes = new Set();

/**
 * Each case gets its own entry file. _resolveModuleUrl cache-busts with
 * `?v=Date.now()`, which has millisecond resolution — two registrations of the
 * same path inside one tick would share a URL and silently reuse Node's cached
 * module, making an import look like it never happened.
 */
async function registerProbeTrigger() {
  probeCounter += 1;
  const toolType = `lazy-load-probe-trigger-${probeCounter}`;
  const entryPoint = `probe-${probeCounter}.js`;
  await fs.writeFile(path.join(pluginDir, entryPoint), probeSource(), 'utf8');
  await PluginManager.registerPluginTrigger(toolType, pluginDir, entryPoint);
  registeredTypes.add(toolType);
  return { toolType, registration: ToolConfig.triggers[toolType] };
}

beforeAll(async () => {
  pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-lazy-trigger-'));
});

afterAll(async () => {
  for (const toolType of registeredTypes) delete ToolConfig.triggers[toolType];
  await fs.rm(pluginDir, { recursive: true, force: true });
});

beforeEach(() => {
  globalThis.__triggerImports = 0;
  globalThis.__triggerSetups = 0;
  globalThis.__triggerTeardowns = 0;
});

describe('plugin trigger registration is lazy', () => {
  it('registers the trigger without importing its module', async () => {
    const { toolType, registration } = await registerProbeTrigger();

    expect(globalThis.__triggerImports).toBe(0);
    expect(ToolConfig.triggers[toolType]).toBeDefined();
    expect(registration._pluginInstance).toBeNull();
  });

  it('marks the registration as plugin-owned before the module exists', async () => {
    // The orphan sweep in reload() deletes plugin triggers whose plugin is gone.
    // It cannot key on _pluginInstance any more, because a trigger nobody armed
    // never has one — it would leak the dead entry forever.
    const { registration } = await registerProbeTrigger();

    expect(registration._isPluginTrigger).toBe(true);
  });

  it('imports the module on first setup() and memoizes it', async () => {
    const { registration } = await registerProbeTrigger();

    await registration.setup({}, {});
    expect(globalThis.__triggerImports).toBe(1);
    expect(globalThis.__triggerSetups).toBe(1);
    expect(registration._pluginInstance).not.toBeNull();

    await registration.setup({}, {});
    expect(globalThis.__triggerImports).toBe(1);
    expect(globalThis.__triggerSetups).toBe(2);
  });

  it('imports only once when setup() is called concurrently', async () => {
    const { registration } = await registerProbeTrigger();

    await Promise.all([registration.setup({}, {}), registration.setup({}, {})]);

    expect(globalThis.__triggerImports).toBe(1);
  });

  it('does not import the module just to tear it down', async () => {
    // A trigger that was never armed owns no gateway, socket or poller. Loading
    // it here would resurrect the exact boot cost this design removes.
    const { registration } = await registerProbeTrigger();

    await registration.teardown();

    expect(globalThis.__triggerImports).toBe(0);
    expect(globalThis.__triggerTeardowns).toBe(0);
  });

  it('tears down the real instance once the trigger has been armed', async () => {
    const { registration } = await registerProbeTrigger();

    await registration.setup({}, {});
    await registration.teardown();

    expect(globalThis.__triggerTeardowns).toBe(1);
  });

  it('routes process() through the loaded module', async () => {
    const { registration } = await registerProbeTrigger();

    const output = await registration.process({ hello: 'world' }, {});

    expect(output).toEqual({ hello: 'world', processed: true });
    expect(globalThis.__triggerImports).toBe(1);
  });

  it('delegates validate() to the module once loaded', async () => {
    const { registration } = await registerProbeTrigger();

    // validate() is synchronous by contract (WorkflowEngine calls it without
    // await) and only ever runs on a workflow that already armed the trigger.
    // Before that it accepts, matching the pre-existing default for a module
    // that exports no validate().
    expect(registration.validate({ accept: false }, {})).toBe(true);

    await registration.setup({}, {});

    expect(registration.validate({ accept: true }, {})).toBe(true);
    expect(registration.validate({ accept: false }, {})).toBe(false);
  });

  it('retries the import after a failure instead of caching the rejection', async () => {
    const toolType = 'lazy-load-probe-trigger-missing';
    registeredTypes.add(toolType);
    await PluginManager.registerPluginTrigger(toolType, pluginDir, 'does-not-exist.js');
    const registration = ToolConfig.triggers[toolType];

    await expect(registration.setup({}, {})).rejects.toThrow();

    // Now make the entry point resolvable and confirm a later attempt succeeds.
    await fs.writeFile(path.join(pluginDir, 'does-not-exist.js'), probeSource(), 'utf8');

    await registration.setup({}, {});
    expect(globalThis.__triggerSetups).toBe(1);
  });
});
