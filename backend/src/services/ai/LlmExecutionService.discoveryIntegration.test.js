// Real discovery handler + registry + code reader. Only the model/ledger are
// replaced; no provider request or production data directory is used.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

vi.hoisted(() => { process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true'; });
vi.mock('node-fetch', () => ({ default: vi.fn(() => { throw new Error('Unexpected network call'); }) }));
vi.mock('./LlmService.js', () => ({ createLlmClient: vi.fn(async () => ({})) }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));
vi.mock('../execution/LedgerRecorder.js', () => ({ recordLlmCall: vi.fn(async () => {}) }));

import service from './LlmExecutionService.js';
import { TOOLS } from '../orchestrator/tools.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';

let file;
beforeAll(async () => {
  file = path.join(process.env.__AGNT_TEST_DATA_DIR, 'discovery-fixture.txt');
  await fs.writeFile(file, 'READ_THROUGH_REAL_CODE_TOOL');
  service.cacheEnabled = false;
});
afterAll(async () => { await fs.unlink(file); });

describe('real discovery to executable code tool', () => {
  it.each([false, true])('streaming=%s receives a discovered reader and executes it', async (streaming) => {
    let round = 0;
    const seen = [];
    const respond = async (messages, schemas) => {
      seen.push(schemas.map((s) => s.function.name));
      const name = round++ === 0 ? 'discover_tools' : round === 2 ? 'read_file' : null;
      if (name === 'read_file') expect(seen.at(-1)).toEqual(['discover_tools', 'read_file']);
      const tc = name ? { id: `call-${round}`, type: 'function', function: { name, arguments: JSON.stringify(name === 'discover_tools' ? { operation: 'load', categories: ['artifact_code'] } : { path: file }) } } : null;
      return { responseMessage: { role: 'assistant', content: tc ? null : 'Done', ...(tc ? { tool_calls: [tc] } : {}) }, toolCalls: tc ? [tc] : [] };
    };
    createLlmAdapter.mockResolvedValue({ call: respond, callStream: respond, formatToolResults: (x) => x });
    const config = { provider: 'openai', model: 'test', userId: 'integration-owner', messages: [{ role: 'user', content: 'Discover and read fixture' }], toolSchemas: [TOOLS.discover_tools.schema], context: { _toolCeiling: new Set(['discover_tools', 'read_file']), role: 'agent' }, maxToolRounds: 3 };
    const result = streaming ? await service.executeWithToolsStreaming(config, () => {}) : await service.executeWithTools(config);
    expect(seen[0]).toEqual(['discover_tools']);
    expect(result.toolExecutions.map((e) => e.name)).toEqual(['discover_tools', 'read_file']);
    const loaded = JSON.parse(result.toolExecutions[0].response);
    expect(loaded.success).toBe(true);
    expect(loaded.loaded_tools).toContain('read_file');
    expect(loaded.loaded_tools).not.toContain('write_file');
    expect(JSON.parse(result.toolExecutions[1].response)).toMatchObject({ success: true, content: 'READ_THROUGH_REAL_CODE_TOOL' });
  });
});
