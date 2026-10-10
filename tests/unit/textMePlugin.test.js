import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import textMe, { TextMe, MAX_MESSAGE_LENGTH } from '../../backend/plugins/dev/text-me-plugin/text-me.js';

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/plugins/dev/text-me-plugin');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
const OUTPUT_KEYS = ['error', 'messageId', 'sent'];

function harness({ owner = 'owner-1', outcome = { sent: true, id: 'msg-1' }, throws = null } = {}) {
  const calls = [];
  const plugin = new TextMe({
    env: { APP_PATH: 'C:/app' },
    newKey: () => 'fixed',
    loadBackendImpl: async (appPath) => {
      calls.push({ appPath });
      if (throws) throw throws;
      return {
        getSessionUserId: () => owner,
        textUser: async (input) => { calls.push(input); return outcome; },
      };
    },
  });
  return { plugin, calls };
}

test('sends the trimmed message once, with a per-execution idempotency key', async () => {
  const { plugin, calls } = harness();
  const out = await plugin.execute({ message: '  Device is back  ' }, {}, { userId: 'owner-1' });
  assert.deepEqual(out, { sent: true, messageId: 'msg-1', error: null });
  assert.deepEqual(calls, [{ appPath: 'C:/app' }, { text: 'Device is back', key: 'text-me-fixed' }]);
});

test('invalid messages are refused before AGNT is touched', async () => {
  for (const params of [undefined, {}, { message: '   ' }, { message: 7 }, { message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }]) {
    const { plugin, calls } = harness();
    const out = await plugin.execute(params, {}, { userId: 'owner-1' });
    assert.equal(out.sent, false);
    assert.ok(out.error);
    assert.equal(calls.length, 0, JSON.stringify(params));
  }
});

test('a workflow run by someone other than the signed-in owner cannot text', async () => {
  const { plugin, calls } = harness();
  const out = await plugin.execute({ message: 'hi' }, {}, { userId: 'teammate-9' });
  assert.equal(out.sent, false);
  assert.match(out.error, /account owner/);
  assert.equal(calls.length, 1, 'textUser must not be called');
});

test('signed out: nothing is sent', async () => {
  const { plugin, calls } = harness({ owner: null });
  const out = await plugin.execute({ message: 'hi' }, {}, { userId: 'owner-1' });
  assert.deepEqual(out, { sent: false, messageId: null, error: 'Not signed in to AGNT.' });
  assert.equal(calls.length, 1);
});

test('gateway refusals become actionable errors; unknown reasons are passed through', async () => {
  const known = await harness({ outcome: { sent: false, reason: 'allowance_exhausted' } }).plugin.execute({ message: 'hi' }, {}, { userId: 'owner-1' });
  assert.match(known.error, /used up/);
  const unknown = await harness({ outcome: { sent: false, reason: 'weird_code' } }).plugin.execute({ message: 'hi' }, {}, { userId: 'owner-1' });
  assert.match(unknown.error, /weird_code/);
});

test('backend load failure and missing APP_PATH fail closed with every output key', async () => {
  const failed = await harness({ throws: new Error('boom') }).plugin.execute({ message: 'hi' }, {}, {});
  assert.deepEqual(Object.keys(failed).sort(), OUTPUT_KEYS);
  assert.match(failed.error, /boom/);
  const noPath = await new TextMe({ env: {} }).execute({ message: 'hi' }, {}, {});
  assert.match(noPath.error, /APP_PATH/);
});

test('manifest matches the tool', () => {
  const [tool] = manifest.tools;
  assert.equal(manifest.tools.length, 1);
  assert.equal(tool.type, textMe.name);
  assert.equal(tool.schema.type, tool.type);
  assert.ok(fs.existsSync(path.join(pluginDir, tool.entryPoint)));
  assert.deepEqual(Object.keys(tool.schema.outputs).sort(), OUTPUT_KEYS);
  assert.equal(tool.schema.parameters.message.required, true);
});
