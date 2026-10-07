import { describe, it, expect } from 'vitest';
import { ENGINE_TAG, ENGINE_BUILDS, MODELS, findModel, fitModel, recommendModel, gpuBudgetBytes } from './catalog.js';

const GB = 1024 ** 3;
const nvidia = (vramGb, ramGb) => ({ platform: 'win32', arch: 'x64', ramBytes: ramGb * GB, gpus: [{ vendor: 'nvidia', vramBytes: vramGb * GB, driverMajor: 576 }], unifiedMemory: false });
const cpuOnly = (ramGb) => ({ platform: 'win32', arch: 'x64', ramBytes: ramGb * GB, gpus: [], unifiedMemory: false });
const appleSilicon = (ramGb) => ({ platform: 'darwin', arch: 'arm64', ramBytes: ramGb * GB, gpus: [], unifiedMemory: true });

describe('catalog integrity: every download is pinned and verifiable', () => {
  const engineFiles = Object.values(ENGINE_BUILDS).flatMap((build) => build.files);

  it.each(engineFiles.map((file) => [file.name, file]))('engine %s is pinned to the tag with a sha256', (_name, file) => {
    expect(file.url).toBe(`https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_TAG}/${file.name}`);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.size).toBeGreaterThan(1_000_000);
  });

  it.each(MODELS.map((model) => [model.id, model]))('model %s is pinned to a commit with a sha256', (_id, model) => {
    expect(model.url).toMatch(/^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[0-9a-f]{40}\/[\w.-]+\.gguf$/);
    expect(model.url.endsWith(`/${model.file}`)).toBe(true);
    expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('model ids are unique and the list is smallest first', () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
    const sizes = MODELS.map((m) => m.size);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  it('every CUDA build ships its runtime alongside it', () => {
    for (const [key, build] of Object.entries(ENGINE_BUILDS)) {
      if (build.backend === 'cuda') expect(build.files.some((f) => f.name.startsWith('cudart-')), key).toBe(true);
    }
  });

  it('findModel only knows catalog ids', () => {
    expect(findModel('qwen3.5-4b')?.name).toBe('Qwen 3.5 4B');
    expect(findModel('../../etc/passwd')).toBeNull();
    expect(findModel(undefined)).toBeNull();
  });
});

describe('fit', () => {
  it('this machine (GTX 1660 SUPER, 6 GB): 4B fits the GPU, 9B spills to RAM, 35B is too big for 16 GB RAM', () => {
    const hw = nvidia(6, 16);
    expect(fitModel(findModel('qwen3.5-4b'), hw)).toBe('gpu');
    expect(fitModel(findModel('qwen3.5-9b'), hw)).toBe('mixed');
    expect(fitModel(findModel('qwen3.6-35b-a3b'), hw)).toBe('too_big');
  });

  it('a 24 GB card runs the 27B on the GPU', () => {
    expect(fitModel(findModel('qwen3.8-27b'), nvidia(24, 64))).toBe('gpu');
  });

  it('Apple Silicon sizes against the shared pool and never "spills"', () => {
    expect(gpuBudgetBytes(appleSilicon(32))).toBeCloseTo(32 * GB * 0.65);
    expect(fitModel(findModel('qwen3.8-27b'), appleSilicon(32))).toBe('gpu');
    expect(fitModel(findModel('qwen3.6-35b-a3b'), appleSilicon(16))).toBe('too_big');
  });
});

describe('recommendModel: the one-click pick', () => {
  it.each([
    ['6 GB NVIDIA', nvidia(6, 16), 'qwen3.5-4b'],
    ['8 GB NVIDIA', nvidia(8, 32), 'qwen3.5-9b'],
    ['24 GB NVIDIA', nvidia(24, 64), 'qwen3.8-27b'],
    ['CPU only, 16 GB', cpuOnly(16), 'qwen3.5-4b'],
    ['CPU only, 6 GB', cpuOnly(6), 'qwen3.5-2b'],
    ['Apple M-series 16 GB', appleSilicon(16), 'qwen3.5-9b'],
  ])('%s → %s', (_label, hw, expected) => {
    expect(recommendModel(hw)?.id).toBe(expected);
  });

  it('nothing fits: null, not a model that cannot run', () => {
    expect(recommendModel(cpuOnly(2))).toBeNull();
  });
});
