/**
 * What the managed local runtime may download: one pinned llama.cpp release
 * and a short list of models, every file with its exact size and SHA-256.
 *
 * Pinned, not "latest": a download is only trusted after its bytes hash to the
 * value written here, so nothing this module fetches can change underneath a
 * user. Engine digests are GitHub's own release-asset digests for the tag;
 * model digests are Hugging Face's LFS oids at the pinned repo revision.
 * Moving to a new engine or model means updating the pin and its hash together.
 *
 * Every model is Apache-2.0 and ungated, so no account or token is involved.
 */

export const ENGINE_TAG = 'b11476';
const RELEASE = `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_TAG}`;
const asset = (name, size, sha256) => ({ name, size, sha256, url: `${RELEASE}/${name}` });

/**
 * One entry per platform/arch/backend this app can run. `files` are archives
 * extracted into the same directory: a CUDA build ships its runtime separately.
 */
export const ENGINE_BUILDS = {
  'win32-x64-cuda13': {
    backend: 'cuda',
    label: 'NVIDIA CUDA 13',
    files: [
      asset('llama-b11476-bin-win-cuda-13.4-x64.zip', 153139193, '0f947f51ece3b807a7f556dbdf45dc1a7f31aa6ea265657639007a33ef1ce5e0'),
      asset('cudart-llama-bin-win-cuda-13.4-x64.zip', 423535356, '738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668'),
    ],
  },
  'win32-x64-cuda12': {
    backend: 'cuda',
    label: 'NVIDIA CUDA 12',
    files: [
      asset('llama-b11476-bin-win-cuda-12.4-x64.zip', 264521953, 'b30289b92274bb7e89200832f4bcfd9e731b716a4056d00b61440f623d4cc8e8'),
      asset('cudart-llama-bin-win-cuda-12.4-x64.zip', 391443627, '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'),
    ],
  },
  'win32-x64-vulkan': {
    backend: 'vulkan',
    label: 'Vulkan (AMD / Intel GPU)',
    files: [asset('llama-b11476-bin-win-vulkan-x64.zip', 33380424, '5c71e7b749697da4a8d46e9ee55486845cbba27c9dfbecb4007f31ba6610d523')],
  },
  'win32-x64-cpu': {
    backend: 'cpu',
    label: 'CPU',
    files: [asset('llama-b11476-bin-win-cpu-x64.zip', 19441535, 'a23e548c6b3525c38bcfeceaff919786ae06741857043cb670279b70100e5483')],
  },
  'win32-arm64-cpu': {
    backend: 'cpu',
    label: 'CPU',
    files: [asset('llama-b11476-bin-win-cpu-arm64.zip', 12267911, '68e3a218ed7d9cd563e8ddf7a1e58d88d034a8f90a91061bdd3876bf247d8a93')],
  },
  'darwin-arm64-metal': {
    backend: 'metal',
    label: 'Apple Metal',
    files: [asset('llama-b11476-bin-macos-arm64.tar.gz', 12012019, '577634a1b8a59e8dabe02ba10de1e610be0574dfaf1cf3020e6dd42853ed877e')],
  },
  'darwin-x64-cpu': {
    backend: 'cpu',
    label: 'CPU',
    files: [asset('llama-b11476-bin-macos-x64.tar.gz', 11530774, 'c2a0dfe7622a99fc3279454814045923e99f1cfdddb8f121c5969c5c675fc073')],
  },
  'linux-x64-cuda13': {
    backend: 'cuda',
    label: 'NVIDIA CUDA 13',
    files: [
      asset('llama-b11476-bin-ubuntu-cuda-13.4-x64.tar.gz', 152531760, '7d87d14e992939f8b86fc3cf5436ed76a7b29c12e70be033e8dabbc6fd8f9c5c'),
      asset('cudart-llama-b11476-bin-ubuntu-cuda-13.4-x64.tar.gz', 440236709, 'f4e1f95c1b86771fbbbc3fece882561182fd12984e40cbe31d082a7b15c24f15'),
    ],
  },
  'linux-x64-cuda12': {
    backend: 'cuda',
    label: 'NVIDIA CUDA 12',
    files: [
      asset('llama-b11476-bin-ubuntu-cuda-12.8-x64.tar.gz', 171688764, '1a854ea10d271145a731f1f7e91119d85c3a93ea4a4015b1d4375860465d1379'),
      asset('cudart-llama-b11476-bin-ubuntu-cuda-12.8-x64.tar.gz', 594377571, '768e0ed4089b76642c8111558c6a8bb6521fc4171e88c1ae850e3d661370d0f3'),
    ],
  },
  'linux-x64-cpu': {
    backend: 'cpu',
    label: 'CPU',
    files: [asset('llama-b11476-bin-ubuntu-x64.tar.gz', 17737286, '2cda5ff9363967f1aba5b5b096032e1b7d9eb568b011769282bf34e4f1cf4b5e')],
  },
  'linux-arm64-cpu': {
    backend: 'cpu',
    label: 'CPU',
    files: [asset('llama-b11476-bin-ubuntu-arm64.tar.gz', 13728259, '9aa7c1dcea2e0491f27441b30217767ec4730bcdeefa646e288825454a71bfa1')],
  },
};

const hf = (repo, revision, file, size, sha256) => ({
  file,
  size,
  sha256,
  url: `https://huggingface.co/${repo}/resolve/${revision}/${file}`,
});

/**
 * Smallest first. `id` is also the name llama-server serves the model under
 * (its --alias), so it is what the user sees in the model picker.
 */
export const MODELS = [
  {
    id: 'qwen3.5-2b',
    name: 'Qwen 3.5 2B',
    blurb: 'Fastest. Runs on almost any computer.',
    ...hf('unsloth/Qwen3.5-2B-GGUF', 'f6d5376be1edb4d416d56da11e5397a961aca8ae', 'Qwen3.5-2B-Q4_K_M.gguf', 1280835840, 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'),
  },
  {
    id: 'qwen3.5-4b',
    name: 'Qwen 3.5 4B',
    blurb: 'A good everyday model for a 6 GB+ GPU.',
    ...hf('unsloth/Qwen3.5-4B-GGUF', 'e87f176479d0855a907a41277aca2f8ee7a09523', 'Qwen3.5-4B-Q4_K_M.gguf', 2740937888, '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'),
  },
  {
    id: 'qwen3.5-9b',
    name: 'Qwen 3.5 9B',
    blurb: 'Stronger reasoning and tool use. Wants an 8 GB+ GPU.',
    ...hf('unsloth/Qwen3.5-9B-GGUF', '3885219b6810b007914f3a7950a8d1b469d598a5', 'Qwen3.5-9B-Q4_K_M.gguf', 5680522464, '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8'),
  },
  {
    id: 'qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    blurb: 'Near-frontier quality. Wants a 24 GB GPU or 32 GB of unified memory.',
    ...hf('unsloth/Qwen3.8-27B-GGUF', '4ca720788d1e01f1bff70c033e0d0028fd02e502', 'Qwen3.8-27B-UD-Q4_K_M.gguf', 16464440224, '322e194ff79741c7baa497c240f677f54b201b0efab44ca8e50f122b39123482'),
  },
  {
    id: 'qwen3.6-35b-a3b',
    name: 'Qwen 3.6 35B-A3B',
    blurb: 'Mixture-of-experts: large-model quality at small-model speed. Wants 32 GB+ of memory.',
    ...hf('unsloth/Qwen3.6-35B-A3B-GGUF', 'a483e9e6cbd595906af30beda3187c2663a1118c', 'Qwen3.6-35B-A3B-UD-Q4_K_M.gguf', 22134528992, 'ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61'),
  },
];

export const findModel = (id) => MODELS.find((model) => model.id === id) || null;

const GB = 1024 ** 3;
/**
 * Memory a model needs beyond its file: context cache at the 32K floor the
 * server is launched with, plus compute buffers. Deliberately generous: a
 * "fits" label that turns out wrong is worse than a cautious one, and the
 * server's own --fit places what does not fit into RAM anyway.
 */
const runtimeOverheadBytes = (model) => 1.5 * GB + model.size * 0.1;
/** System RAM left for the OS, AGNT and the user's other apps. */
const RAM_SHARE = 0.6;
/** Apple Silicon shares one memory pool; macOS keeps roughly a third for itself. */
const UNIFIED_GPU_SHARE = 0.65;
/** Largest download recommended for CPU-only inference: beyond this, tokens crawl. */
const CPU_RECOMMEND_MAX_BYTES = 3 * GB;

/** GPU memory the model can live in: dedicated VRAM, or Apple's unified pool. */
export function gpuBudgetBytes(hardware) {
  if (hardware.unifiedMemory) return hardware.ramBytes * UNIFIED_GPU_SHARE;
  return Math.max(0, ...(hardware.gpus || []).map((gpu) => gpu.vramBytes || 0));
}

/**
 * 'gpu'     runs entirely in GPU memory (fast)
 * 'mixed'   runs, with part of it in system RAM (slower)
 * 'too_big' cannot run on this machine
 */
export function fitModel(model, hardware) {
  const need = model.size + runtimeOverheadBytes(model);
  const gpu = gpuBudgetBytes(hardware);
  if (need <= gpu) return 'gpu';
  const ram = hardware.unifiedMemory ? 0 : hardware.ramBytes * RAM_SHARE;
  return need <= gpu + ram ? 'mixed' : 'too_big';
}

/**
 * The one model to offer in a one-click setup: the largest that runs fully on
 * the GPU; failing that, the largest small model that still runs from RAM.
 */
export function recommendModel(hardware, models = MODELS) {
  const fits = models.map((model) => ({ model, fit: fitModel(model, hardware) }));
  const onGpu = fits.filter((entry) => entry.fit === 'gpu');
  if (onGpu.length) return onGpu[onGpu.length - 1].model;
  const inRam = fits.filter((entry) => entry.fit === 'mixed' && entry.model.size <= CPU_RECOMMEND_MAX_BYTES);
  return inRam.length ? inRam[inRam.length - 1].model : null;
}
