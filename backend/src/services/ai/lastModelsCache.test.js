import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import pathManager from '../../utils/PathManager.js';

// Runs against the real file under the vitest-isolated data dir.
const CACHE_FILE = pathManager.getPath('last-models.json');
const readFile = () => JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const models = (...ids) => ids.map((id) => ({ id, name: id }));

let cache;
beforeEach(async () => {
  fs.rmSync(CACHE_FILE, { force: true });
  vi.resetModules(); // fresh in-memory snapshot per test
  cache = await import('./lastModelsCache.js');
});

describe('lastModelsCache', () => {
  it('round-trips a provider list and ignores empty writes', () => {
    cache.persistLastModels('OpenAI', models('gpt-a'));
    cache.persistLastModels('openai', []);
    expect(cache.getLastSuccessfulModels('openai')).toEqual(models('gpt-a'));
    expect(readFile().openai.models).toEqual(models('gpt-a'));
  });

  it('REGRESSION: a later write does not resurrect an entry another process deleted', () => {
    cache.persistLastModels('openai', models('gpt-a'));
    cache.persistLastModels('testprovider', models('model-a', 'model-b'));

    // Another process (the user, a CLI, another instance) removes an entry.
    const external = readFile();
    delete external.testprovider;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(external));

    cache.persistLastModels('deepseek', models('deepseek-flash'));
    expect(Object.keys(readFile()).sort()).toEqual(['deepseek', 'openai']);
  });

  it("does not clobber another process's concurrent write", () => {
    cache.persistLastModels('openai', models('gpt-a'));
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...readFile(), anthropic: { models: models('claude-x'), timestamp: 1 } }));
    cache.persistLastModels('gemini', models('gemini-y'));
    expect(readFile().anthropic.models).toEqual(models('claude-x'));
  });

  it('recovers from a corrupt file instead of throwing', () => {
    fs.writeFileSync(CACHE_FILE, '{not json');
    cache.persistLastModels('openai', models('gpt-a'));
    expect(readFile()).toEqual({ openai: expect.objectContaining({ models: models('gpt-a') }) });
  });

  it('leaves no temp file behind', () => {
    cache.persistLastModels('openai', models('gpt-a'));
    const dir = fs.readdirSync(pathManager.getPath());
    expect(dir.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
