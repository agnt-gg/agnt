import { describe, it, expect, vi } from 'vitest';
import { parseNvidiaSmi, parseWindowsAdapters, detectHardware, pickEngineBuild } from './hardware.js';
import { ENGINE_BUILDS } from './catalog.js';

const MIB = 1024 ** 2;

describe('parseNvidiaSmi', () => {
  it('reads the real output of this machine', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce GTX 1660 SUPER, 6144, 576.02\r\n')).toEqual([
      { vendor: 'nvidia', name: 'NVIDIA GeForce GTX 1660 SUPER', vramBytes: 6144 * MIB, driverMajor: 576 },
    ]);
  });

  it('reads several GPUs and ignores junk lines', () => {
    const gpus = parseNvidiaSmi('NVIDIA RTX 4090, 24564, 581.15\nNVIDIA RTX 3060, 12288, 581.15\n\nNo devices were found');
    expect(gpus.map((g) => g.name)).toEqual(['NVIDIA RTX 4090', 'NVIDIA RTX 3060']);
  });
});

describe('parseWindowsAdapters', () => {
  it('keeps AMD and Intel Arc, drops integrated and virtual adapters', () => {
    const gpus = parseWindowsAdapters('AMD Radeon RX 7800 XT\r\nIntel(R) UHD Graphics 770\r\nIntel(R) Arc(TM) A770 Graphics\r\nMicrosoft Basic Display Adapter\r\n');
    expect(gpus.map((g) => g.vendor)).toEqual(['amd', 'intel']);
  });
});

describe('detectHardware', () => {
  it('no NVIDIA driver and no WMI: a CPU machine, never a throw', async () => {
    const run = vi.fn(async () => { throw new Error('ENOENT'); });
    const hw = await detectHardware({ platform: 'win32', arch: 'x64', ramBytes: 8, run });
    expect(hw).toEqual({ platform: 'win32', arch: 'x64', ramBytes: 8, gpus: [], unifiedMemory: false });
  });

  it('asks WMI only on Windows and only when nvidia-smi found nothing', async () => {
    const run = vi.fn(async (file) => (file === 'nvidia-smi' ? 'NVIDIA RTX 4070, 12282, 581.0' : 'AMD Radeon'));
    await detectHardware({ platform: 'win32', arch: 'x64', ramBytes: 1, run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('Apple Silicon is unified memory', async () => {
    const hw = await detectHardware({ platform: 'darwin', arch: 'arm64', ramBytes: 1, run: async () => { throw new Error('no'); } });
    expect(hw.unifiedMemory).toBe(true);
  });
});

describe('pickEngineBuild', () => {
  const hw = (platform, arch, gpus = []) => ({ platform, arch, gpus });
  const nv = (driverMajor) => [{ vendor: 'nvidia', driverMajor }];

  it.each([
    ['this machine: Windows, driver 576', hw('win32', 'x64', nv(576)), 'win32-x64-cuda12'],
    ['Windows, driver 581', hw('win32', 'x64', nv(581)), 'win32-x64-cuda13'],
    ['Windows, NVIDIA driver too old for CUDA: Vulkan', hw('win32', 'x64', nv(470)), 'win32-x64-vulkan'],
    ['Windows, AMD', hw('win32', 'x64', [{ vendor: 'amd' }]), 'win32-x64-vulkan'],
    ['Windows, no GPU', hw('win32', 'x64'), 'win32-x64-cpu'],
    ['Windows on ARM', hw('win32', 'arm64'), 'win32-arm64-cpu'],
    ['Apple Silicon', hw('darwin', 'arm64'), 'darwin-arm64-metal'],
    ['Intel Mac', hw('darwin', 'x64'), 'darwin-x64-cpu'],
    ['Linux, driver 575', hw('linux', 'x64', nv(575)), 'linux-x64-cuda12'],
    ['Linux, driver 565 (below CUDA 12.8)', hw('linux', 'x64', nv(565)), 'linux-x64-cpu'],
    ['Linux, driver 580', hw('linux', 'x64', nv(580)), 'linux-x64-cuda13'],
    ['Linux arm64', hw('linux', 'arm64'), 'linux-arm64-cpu'],
  ])('%s → %s', (_label, input, expected) => {
    expect(pickEngineBuild(input)).toBe(expected);
    expect(ENGINE_BUILDS[expected]).toBeDefined();
  });

  it('unsupported platform: null', () => {
    expect(pickEngineBuild(hw('freebsd', 'x64'))).toBeNull();
  });
});
