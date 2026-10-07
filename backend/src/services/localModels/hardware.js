/**
 * What this machine can run a model on, and which llama.cpp build fits it.
 *
 * Detection is best-effort and never throws: a probe that fails means "not
 * found", and the worst outcome is a CPU build that runs everywhere. NVIDIA is
 * read from nvidia-smi (ships with every NVIDIA driver, on PATH on Windows and
 * Linux), which also gives the driver version that decides CUDA 12 vs 13.
 */
import os from 'node:os';
import { execFile } from 'node:child_process';

const MIB = 1024 ** 2;
const PROBE_TIMEOUT_MS = 5000;

/** CUDA 13 needs an R580+ driver; the CUDA 12 builds need these minimums. */
const CUDA13_MIN_DRIVER = 580;
const CUDA12_MIN_DRIVER = { win32: 551, linux: 570 };

const defaultRun = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });

/** `name, memory.total MiB, driver_version` lines, one per GPU. */
export function parseNvidiaSmi(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.split(',').map((part) => part.trim()))
    .filter((parts) => parts.length >= 3 && parts[0] && Number.isFinite(Number(parts[1])))
    .map(([name, totalMib, driver]) => ({
      vendor: 'nvidia',
      name,
      vramBytes: Number(totalMib) * MIB,
      driverMajor: Number.parseInt(driver, 10) || 0,
    }));
}

/**
 * Windows adapters by name. AMD and Intel Arc cards run the Vulkan build;
 * their VRAM is not read (WMI reports it wrong above 4 GB), so they are sized
 * like a CPU machine and llama.cpp's --fit offloads what the card can hold.
 */
export function parseWindowsAdapters(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .flatMap((name) => {
      if (/radeon|\bamd\b/i.test(name)) return [{ vendor: 'amd', name, vramBytes: 0 }];
      if (/intel.*\barc\b/i.test(name)) return [{ vendor: 'intel', name, vramBytes: 0 }];
      return [];
    });
}

export async function detectHardware({
  platform = process.platform,
  arch = process.arch,
  ramBytes = os.totalmem(),
  run = defaultRun,
} = {}) {
  let gpus = [];
  try {
    gpus = parseNvidiaSmi(await run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']));
  } catch {
    // no NVIDIA driver
  }
  if (!gpus.length && platform === 'win32') {
    try {
      gpus = parseWindowsAdapters(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name']));
    } catch {
      // WMI unavailable: CPU build
    }
  }
  return { platform, arch, ramBytes, gpus, unifiedMemory: platform === 'darwin' && arch === 'arm64' };
}

/** Key into ENGINE_BUILDS, or null when this platform has no build. */
export function pickEngineBuild(hardware) {
  const { platform, arch, gpus = [] } = hardware;
  const nvidiaDriver = Math.max(0, ...gpus.filter((gpu) => gpu.vendor === 'nvidia').map((gpu) => gpu.driverMajor || 0));
  const cuda = () => {
    if (nvidiaDriver >= CUDA13_MIN_DRIVER) return 'cuda13';
    if (nvidiaDriver >= (CUDA12_MIN_DRIVER[platform] || Infinity)) return 'cuda12';
    return null;
  };
  if (platform === 'win32' && arch === 'x64') {
    const vulkan = gpus.some((gpu) => gpu.vendor !== 'nvidia') || nvidiaDriver > 0;
    return `win32-x64-${cuda() || (vulkan ? 'vulkan' : 'cpu')}`;
  }
  if (platform === 'win32' && arch === 'arm64') return 'win32-arm64-cpu';
  if (platform === 'darwin') return arch === 'arm64' ? 'darwin-arm64-metal' : 'darwin-x64-cpu';
  if (platform === 'linux' && arch === 'x64') return `linux-x64-${cuda() || 'cpu'}`;
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-cpu';
  return null;
}
