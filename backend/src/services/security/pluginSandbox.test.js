import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPluginInSandbox, stagePlugin, sandboxedPluginModule } from './pluginSandbox.js';

// A teammate's plugin call runs in a forked worker inside their sandbox, from a copy of the plugin in their
// own folder (the plugin folder itself is outside the sandbox). Here the worker is forked without the
// kernel sandbox, which only exists on a hosted Linux instance; the staging and the protocol are the same.
const CALCULATOR = fileURLToPath(new URL('../../../plugins/dev/calculator-plugin', import.meta.url));
const roots = [];
const tempRoot = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-plugin-sandbox-')); roots.push(dir); return dir; };
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it('runs the plugin tool from a copy in the teammate\'s folder and returns its result', async () => {
  const root = tempRoot();
  const result = await runPluginInSandbox({ pluginName: 'calculator-plugin', pluginPath: CALCULATOR, entryPoint: './calculator.js' }, { expression: 'sqrt(144)*3+2^5' }, {}, { userId: 'scope:w' }, { root, forkWorker: fork });
  expect(result).toEqual({ result: 68, success: true, error: null });
  expect(fs.readdirSync(path.join(root, '.tool-work', 'plugins')).some((name) => name.startsWith('calculator-plugin-'))).toBe(true);
});

it('stages each plugin version once, and reports a plugin failure as an error', async () => {
  const root = tempRoot();
  expect(stagePlugin('calculator-plugin', CALCULATOR, root)).toBe(stagePlugin('calculator-plugin', CALCULATOR, root));
  const broken = tempRoot();
  fs.writeFileSync(path.join(broken, 'tool.js'), 'export default { execute() { throw new Error("plugin blew up"); } };');
  await expect(runPluginInSandbox({ pluginName: 'broken', pluginPath: broken, entryPoint: './tool.js' }, {}, {}, {}, { root, forkWorker: fork })).rejects.toThrow(/plugin blew up/);
});

// bravo, Nov 2026: a teammate's workflow plugin step failed "Invalid action for node type: calc-evaluate":
// NodeExecutor calls module.default.execute, the sandboxed module only had module.execute.
it('has the shape both chat (module.execute) and the workflow runner (module.default.execute) call', () => {
  const module = sandboxedPluginModule({ pluginName: 'calculator-plugin', pluginPath: CALCULATOR, entryPoint: './calculator.js' });
  expect(typeof module.execute).toBe('function');
  expect(typeof module.default?.execute).toBe('function');
});

it('refuses an entry point outside the plugin folder', async () => {
  await expect(runPluginInSandbox({ pluginName: 'calculator-plugin', pluginPath: CALCULATOR, entryPoint: '../../escape.js' }, {}, {}, {}, { root: tempRoot(), forkWorker: fork })).rejects.toThrow(/escapes its folder/);
});
