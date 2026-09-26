import path from 'path';

export const BUNDLE_LIMITS = Object.freeze({ maxFiles: 500, maxTotalBytes: 250 * 1024 * 1024, maxFileBytes: 100 * 1024 * 1024, maxEntryBytes: 10 * 1024 * 1024 });
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', '.turbo', '.venv', 'venv', '__pycache__', '.pytest_cache']);
const SECRET_NAMES = /(^|\/)(\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx)|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)$/i;
const TEMP_NAMES = /(?:^|\/)(?:thumbs\.db|desktop\.ini|\.ds_store|.*\.(?:tmp|temp|bak|swp|swo|lock|zip|7z|rar|tar|gz))$/i;
const MIME = new Map(Object.entries({
  '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.xml':'application/xml; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.wasm':'application/wasm','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.obj':'model/obj','.mtl':'text/plain; charset=utf-8','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8'
}));

export function mimeFor(filePath) { return MIME.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream'; }
export function normalizeBundlePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Bundle path is required');
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized) || normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe bundle path: ${value}`);
  return normalized;
}
export function shouldExclude(relativePath, isDirectory = false) {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) return 'generated_or_dependency_directory';
  if (SECRET_NAMES.test(normalized)) return 'secret_like_name';
  if (!isDirectory && TEMP_NAMES.test(normalized)) return 'temporary_or_archive';
  if (parts.some((part) => part.startsWith('.') && part !== '.well-known')) return 'hidden_path';
  return null;
}
function assertContained(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escapes artifact root');
}

export function resolveManifestFile(workspaceRoot, rootPath, logicalPath) {
  const normalizedRoot = rootPath ? normalizeBundlePath(rootPath) : '';
  const normalizedFile = normalizeBundlePath(logicalPath);
  const root = path.resolve(workspaceRoot, normalizedRoot);
  const target = path.resolve(root, normalizedFile);
  assertContained(root, target);
  return target;
}
