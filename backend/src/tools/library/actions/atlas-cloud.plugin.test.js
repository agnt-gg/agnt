/**
 * The Atlas Cloud plugin, as the chat met it (reported 2026-10-20, AGNT One).
 *
 *  - atlas_image saved to a hard-coded %APPDATA%/AGNT/Data/images, so under
 *    any other profile /api/images 404'd and the image showed broken inline,
 *    on its card and in the side panel. It now saves where AGNT serves from.
 *  - atlas_chat's default model ("deepseek-v3") does not exist on Atlas, and
 *    an unknown id came back as a bare HTTP 400; the model had to web-scrape
 *    Atlas's catalogue to guess. It now returns the ids that exist.
 *  - A reasoning model that spent its budget thinking returned content "" as
 *    if that were the answer. It now says why.
 *
 * Response shapes are the ones Atlas returned live on 2026-10-20.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { agntDataDir, agntRootDir } from '../../../../plugins/dev/atlas-cloud/_atlas-core.js';
import atlasChat from '../../../../plugins/dev/atlas-cloud/atlas-chat.js';
import atlasImage from '../../../../plugins/dev/atlas-cloud/atlas-image.js';
import manifest from '../../../../plugins/dev/atlas-cloud/manifest.json' with { type: 'json' };

const AUTH = { __auth: { token: 'test-key' } };
const ENV_KEYS = ['AGNT_DATA_DIR', 'AGNT_ROOT_DIR', 'USER_DATA_PATH'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let tmp;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const MODELS = { object: 'list', data: ['zai-org/glm-5.3-flash', 'deepseek-ai/deepseek-v3.2', 'deepseek-ai/deepseek-v4.1-flash', 'qwen/qwen3.6-plus'].map((id) => ({ id, object: 'model' })) };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-plugin-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('where Atlas saves', () => {
  it('uses the folders AGNT published', () => {
    process.env.AGNT_DATA_DIR = path.join(tmp, 'profile', 'Data');
    process.env.AGNT_ROOT_DIR = path.join(tmp, 'profile');
    expect(agntDataDir()).toBe(path.join(tmp, 'profile', 'Data'));
    expect(agntRootDir()).toBe(path.join(tmp, 'profile'));
  });

  it('on an older AGNT, follows the Electron profile it runs under', () => {
    delete process.env.AGNT_DATA_DIR;
    delete process.env.AGNT_ROOT_DIR;
    process.env.USER_DATA_PATH = path.join(tmp, 'AGNT-One');
    expect(agntDataDir()).toBe(path.join(tmp, 'AGNT-One', 'Data'));
    expect(agntRootDir()).toBe(path.join(tmp, 'AGNT-One'));
  });

  it('THE REPORTED BUG: a generated image lands in the folder /api/images serves', async () => {
    process.env.AGNT_DATA_DIR = path.join(tmp, 'AGNT-One', 'Data');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/model/generateImage')) return json(200, { data: { id: 'pred1' } });
      if (String(url).includes('/model/prediction/pred1')) return json(200, { data: { status: 'completed', outputs: ['https://cdn.example/out.png'] } });
      if (url === 'https://cdn.example/out.png') return new Response(png, { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    }));
    const out = await atlasImage.execute({ ...AUTH, model: 'bytedance/seedream-v5.0-lite', prompt: 'a city', outputFormat: 'png', saveToDisk: true });
    expect(out.error).toBeUndefined();
    expect(out.imageRef).toBe('{{IMAGE_REF:img-atlas-pred1}}');
    expect(out.savedPath).toBe(path.join(tmp, 'AGNT-One', 'Data', 'images', 'img-atlas-pred1.png'));
    expect(fs.readFileSync(out.savedPath)).toEqual(png);
  });
});

describe('atlas_chat tells the caller what it needs', () => {
  it('an unknown model returns the ids that exist, the closest first', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith('/chat/completions')) return json(400, { code: 400, msg: 'not found' });
      if (String(url).endsWith('/v1/models')) return json(200, MODELS);
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await atlasChat.execute({ ...AUTH, model: 'deepseek-v3', userMessage: 'hi' });
    expect(out.error).toMatch(/no chat model "deepseek-v3"/);
    expect(out.availableModels).toHaveLength(4);
    expect(out.availableModels.slice(0, 2)).toEqual(['deepseek-ai/deepseek-v3.2', 'deepseek-ai/deepseek-v4.1-flash']);
    expect(fetchMock.mock.calls.find(([u]) => String(u).endsWith('/v1/models'))[1].method).toBe('GET');
  });

  it('when the list cannot be read, the original error stands', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('/chat/completions') ? json(400, { code: 400, msg: 'not found' }) : json(500, { msg: 'down' }))));
    const out = await atlasChat.execute({ ...AUTH, model: 'nope', userMessage: 'hi' });
    // Atlas's body verbatim, as the chat saw it: HTTP 400: {"code":400,"msg":"not found"}
    expect(out.error).toMatch(/HTTP 400: .*not found/);
    expect(out.availableModels).toBeUndefined();
  });

  it('other failures are not mistaken for an unknown model', async () => {
    const fetchMock = vi.fn(async () => json(429, { code: 429, msg: 'too many requests' }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await atlasChat.execute({ ...AUTH, model: 'zai-org/glm-5.3-flash', userMessage: 'hi' });
    expect(out.error).toMatch(/HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an answer used up by reasoning says so instead of returning ""', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'Let me think…' } }] })));
    const out = await atlasChat.execute({ ...AUTH, model: 'deepseek-ai/deepseek-v4.1-flash', userMessage: 'six words', maxTokens: 150 });
    expect(out.content).toBe('');
    expect(out.finishReason).toBe('length');
    expect(out.error).toMatch(/used all 150 output tokens reasoning/);
  });

  it('a normal answer comes back with its finish reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] })));
    const out = await atlasChat.execute({ ...AUTH, model: 'zai-org/glm-5.3-flash', userMessage: 'Reply OK' });
    expect(out).toMatchObject({ content: 'OK', finishReason: 'stop' });
    expect(out.error).toBeUndefined();
  });
});

describe('the manifest', () => {
  const chat = manifest.tools.find((t) => t.type === 'atlas-chat').schema.parameters;

  it('names a chat model Atlas serves, not the retired "deepseek-v3"', () => {
    // zai-org/glm-5.3-flash answered live on 2026-10-20; deepseek-v3 was 400 "not found".
    expect(chat.model.default).toBe('zai-org/glm-5.3-flash');
  });

  it('declares no maxTokens default: the chat now applies declared defaults, and a cap starves reasoning models', () => {
    expect(chat.maxTokens).not.toHaveProperty('default');
  });
});
