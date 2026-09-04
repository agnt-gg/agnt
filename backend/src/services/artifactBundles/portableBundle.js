import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { BUNDLE_LIMITS, mimeFor, normalizeBundlePath, shouldExclude } from './manifest.js';

// Preparation is local and owner-bound. Only rewritten text is held in memory;
// media remains on disk and is hash-checked when read. No source file is edited.
const preparations = new Map();
const PREPARATION_TTL_MS = 30 * 60 * 1000;
const MAX_PREPARATIONS = 8;
const MAX_CACHED_TEXT_BYTES = 128 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const keyFor = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const isInside = (root, target) => { const rel = path.relative(root, target); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
const TEXT_FILE = /\.(?:html?|css|js|mjs|json|gltf|svg|xml|txt)$/i;
const PATH_LITERAL = /^(?:file:\/\/[^\s]+|(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/(?:local-file\/|filesystem\/raw\b)|\.{1,2}\/|[a-z]:[\\/])|^[^\s<>]*\.(?:html?|css|m?js|json|gltf|glb|wasm|png|jpe?g|webp|gif|svg|avif|mp4|webm|mp3|wav|woff2?|ttf|bin)(?:[?#].*)?$/i;

function applyEdits(source, edits) {
  let result = source;
  let boundary = source.length;
  for (const edit of edits.sort((a,b) => b.start - a.start)) {
    if (edit.end > boundary) throw new Error('Overlapping URL edits');
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    boundary = edit.start;
  }
  return result;
}
async function replaceMatches(source, pattern, replacer) {
  const edits = [];
  for (const match of source.matchAll(pattern)) {
    const replacement = await replacer(match);
    if (replacement !== match[0]) edits.push({ start:match.index, end:match.index + match[0].length, text:replacement });
  }
  return applyEdits(source, edits);
}
async function rewriteCSS(source, resolve) {
  let result = await replaceMatches(source, /url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s)'"\r\n]+))\s*\)/gi, async match => {
    const original = match[1] ?? match[2] ?? match[3];
    const rewritten = await resolve(original);
    return rewritten === original ? match[0] : `url("${rewritten.replace(/"/g, '%22')}")`;
  });
  result = await replaceMatches(result, /(@import\s+)(["'])([^"'\r\n]+)\2/gi, async match => `${match[1]}${match[2]}${await resolve(match[3])}${match[2]}`);
  return result;
}
async function rewriteStrings(source, resolve) {
  // Static string values only; never evaluate user JavaScript. Whole-directory
  // capture preserves runtime-relative asset families that static analysis misses.
  return replaceMatches(source, /(["'`])((?:\\.|(?!\1)[^\\\r\n])*?)\1/g, async match => {
    const value = match[2].replace(/\\\//g, '/');
    if (value.includes('${') || !PATH_LITERAL.test(value) || /^file:\/*$/i.test(value)) return match[0];
    const rewritten = await resolve(value, false);
    return rewritten === value ? match[0] : `${match[1]}${rewritten.replaceAll(match[1], `\\${match[1]}`)}${match[1]}`;
  });
}
async function rewriteSrcset(source, resolve) {
  // URL token ends at whitespace, not a comma inside a data URI.
  return replaceMatches(source, /(^|,\s*)(\S+)([^,]*)/g, async match => {
    const trailingComma = match[2].endsWith(',') && !match[2].startsWith('data:');
    const value = trailingComma ? match[2].slice(0,-1) : match[2];
    return `${match[1]}${await resolve(value)}${trailingComma ? ',' : ''}${match[3]}`;
  });
}
async function rewriteHTML(source, resolve, setBase) {
  const $ = load(source, { sourceCodeLocationInfo:true });
  const edits = [];
  const base = $('base[href]').first()[0];
  if (base?.sourceCodeLocation) {
    const remove = setBase(base.attribs.href);
    if (remove) edits.push({start:base.sourceCodeLocation.startOffset, end:base.sourceCodeLocation.endOffset, text:''});
  }
  for (const element of $('*').toArray()) {
    if (element === base) continue;
    const location = element.sourceCodeLocation;
    if (!location) continue;
    for (const [name, value] of Object.entries(element.attribs || {})) {
      const attr = location.attrs?.[name];
      if (!attr) continue;
      let rewritten = value;
      if (name === 'style') rewritten = await rewriteCSS(value, resolve);
      else if (name === 'srcset' || name === 'imagesrcset') rewritten = await rewriteSrcset(value, resolve);
      else if (['src','href','xlink:href','poster','data'].includes(name)) rewritten = await resolve(value);
      else if (name.startsWith('data-') && PATH_LITERAL.test(value)) rewritten = await resolve(value, false);
      if (rewritten !== value) edits.push({start:attr.startOffset, end:attr.endOffset, text:`${name}="${rewritten.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"`});
    }
    if ((element.name === 'script' || element.name === 'style') && location.startTag && location.endTag) {
      const start = location.startTag.endOffset, end = location.endTag.startOffset;
      const contents = source.slice(start,end);
      const rewritten = element.name === 'style' ? await rewriteCSS(contents, resolve) : await rewriteStrings(contents, resolve);
      if (rewritten !== contents) edits.push({start,end,text:rewritten});
    }
  }
  return applyEdits(source, edits);
}

function localApiPath(reference, workspaceRoot) {
  const local = reference.match(/^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/local-file\/(.*)$/i);
  if (local) return path.resolve(decodeURIComponent(local[1].split(/[?#]/)[0]));
  if (/^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/filesystem\/raw\?/i.test(reference)) {
    const rawPath = new URL(reference,'http://localhost').searchParams.get('path');
    if (!rawPath) throw new Error('raw URL has no path');
    return resolveInputPath(rawPath,workspaceRoot);
  }
  return null;
}
function resolveInputPath(value, workspaceRoot) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Entry path is required');
  if (/^file:/i.test(value)) return fileURLToPath(value);
  return path.resolve(workspaceRoot, value);
}
function assertPublicFile(absolutePath) {
  // Exclusion is intentional, not an allow-anything filesystem export. In
  // particular, an HTML reference must not make .env or a private key public.
  const reason = shouldExclude(absolutePath.replace(/\\/g,'/'));
  if (reason === 'secret_like_name' || reason === 'hidden_path') throw new Error(`Referenced file is excluded (${reason}): ${absolutePath}`);
  if (/^(?:\\\\|\/\/)/.test(absolutePath)) throw new Error('Network share paths are not supported');
}

export async function preparePortableBundle({ workspaceRoot, entryPath, rootPath, html, baseDir, overrides = [], ownerId, limits = BUNDLE_LIMITS }) {
  if (!ownerId) throw new Error('Preparation owner is required');
  const inline = typeof html === 'string';
  const absoluteWorkspace = path.resolve(workspaceRoot);
  const absoluteEntry = inline ? null : resolveInputPath(entryPath, absoluteWorkspace);
  const root = inline ? (baseDir ? resolveInputPath(baseDir, absoluteWorkspace) : null) : (rootPath === undefined || rootPath === null ? path.dirname(absoluteEntry) : resolveInputPath(rootPath || '.', absoluteWorkspace));
  if (absoluteEntry && !isInside(root, absoluteEntry)) throw new Error('Entry escapes artifact root');
  const entries = new Map(), bySource = new Map(), walked = new Set(), excluded = [];
  let totalBytes = 0;
  function checkLimits() {
    if (entries.size > limits.maxFiles) throw new Error(`Bundle exceeds the ${limits.maxFiles} file limit`);
    if (totalBytes > limits.maxTotalBytes) throw new Error(`Bundle exceeds the ${limits.maxTotalBytes} byte total limit`);
  }
  function logicalFor(absolutePath) {
    if (root && isInside(root, absolutePath)) return normalizeBundlePath(path.relative(root,absolutePath).replace(/\\/g,'/'));
    return `_assets/${digest(keyFor(path.dirname(absolutePath))).slice(0,16)}/${path.basename(absolutePath)}`;
  }
  async function addFile(absolutePath, required = true) {
    absolutePath = path.resolve(absolutePath);
    const key = keyFor(absolutePath);
    if (bySource.has(key)) return bySource.get(key);
    assertPublicFile(absolutePath);
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink() || keyFor(await fs.realpath(absolutePath)) !== key) throw new Error(`Referenced path is not a regular, non-symlink file: ${absolutePath}`);
    const logicalPath = logicalFor(absolutePath);
    if (entries.has(logicalPath)) throw new Error(`Bundle path collision: ${logicalPath}`);
    if (stat.size > limits.maxFileBytes) throw new Error(`${logicalPath} exceeds the per-file byte limit`);
    const entry = { path:logicalPath, sourcePath:absolutePath, sourceSize:stat.size, modifiedMs:Math.trunc(stat.mtimeMs), size:stat.size, mime:mimeFor(logicalPath), required };
    entries.set(logicalPath, entry); bySource.set(key, entry); totalBytes += stat.size; checkLimits();
    return entry;
  }
  async function walk(directory) {
    const key = keyFor(directory);
    if (walked.has(key)) return;
    walked.add(key);
    const children = (await fs.readdir(directory,{withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const absolutePath = path.join(directory,child.name);
      const relative = root && isInside(root,absolutePath) ? path.relative(root,absolutePath) : child.name;
      // Capture runtime assets, not the generated project's development harness.
      // Explicit references still pass through addFile and are never dropped here.
      const developmentArtifact = /^(?:verification(?:[-_][^/\\]+)?|_.*\.(?:mjs|cjs|py)|(?:build|verify|finalize|refine)(?:[-_][^/\\]+)?\.cjs)$/i.test(child.name);
      const reason = shouldExclude(relative,child.isDirectory()) || (developmentArtifact ? 'development_artifact' : null);
      if (reason || child.isSymbolicLink()) { excluded.push({path:relative.replace(/\\/g,'/'),reason:reason || 'symbolic_link'}); continue; }
      if (child.isDirectory()) await walk(absolutePath);
      else if (child.isFile()) await addFile(absolutePath, false);
    }
  }
  if (root) await walk(root);
  let entry;
  if (inline) {
    let name = '__agnt_share__.html';
    for (let i=1; entries.has(name); i++) name = `__agnt_share_${i}.html`;
    entry = {path:name, sourcePath:root ? path.join(root,name) : null, content:html, size:Buffer.byteLength(html), modifiedMs:0, mime:mimeFor(name)};
    entries.set(name,entry); totalBytes += entry.size; checkLimits();
  } else entry = await addFile(absoluteEntry);
  for (const override of overrides) {
    const target = entries.get(normalizeBundlePath(override.path));
    if (!target || typeof override.content !== 'string') throw new Error(`Override file is not declared: ${override.path}`);
    totalBytes += Buffer.byteLength(override.content) - target.size;
    target.size = Buffer.byteLength(override.content); target.content = override.content; checkLimits();
  }
  // Map iteration visits newly discovered entries, including cyclic HTML graphs,
  // exactly once. Queue size and total bytes remain bounded by bundle limits.
  for (const current of entries.values()) {
    let base = current.sourcePath ? pathToFileURL(current.sourcePath) : null;
    async function resolve(reference, required = true) {
      if (!reference || reference.startsWith('#') || /^(?:data:|https?:|\/\/|mailto:|tel:|javascript:)/i.test(reference) && !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\//i.test(reference)) return reference;
      if (/^file:\/*$/i.test(reference)) return reference;
      if (/^blob:/i.test(reference)) throw new Error(`${current.path}: temporary blob URL cannot be shared; save the asset first`);
      let resolved, suffix = '';
      try {
        const localApi = reference.match(/^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/local-file\/(.*)$/i);
        const rawApi = /^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/filesystem\/raw\?/i.test(reference);
        if (localApi) {
          const pathname = localApi[1].split(/[?#]/)[0];
          resolved = path.resolve(decodeURIComponent(pathname));
          suffix = reference.slice(reference.indexOf(pathname) + pathname.length).replace(/\?[^#]*/, '');
        } else if (rawApi) {
          const parsed = new URL(reference,'http://localhost');
          const rawPath = parsed.searchParams.get('path');
          if (!rawPath) throw new Error('raw URL has no path');
          resolved = resolveInputPath(rawPath, absoluteWorkspace); suffix = parsed.hash;
        } else if (/^[a-z]:[\\/]/i.test(reference)) resolved = path.resolve(reference);
        else {
          if (!base && !/^file:/i.test(reference)) throw new Error('relative URL has no source directory');
          const parsed = new URL(reference,base || undefined);
          if (parsed.protocol !== 'file:') return parsed.href;
          suffix = parsed.search + parsed.hash; parsed.search = ''; parsed.hash = '';
          resolved = fileURLToPath(parsed);
        }
        const target = await addFile(resolved, required);
        // A linked HTML page may load siblings through tabs or runtime strings.
        if (/\.html?$/i.test(resolved)) await walk(path.dirname(resolved));
        const relative = path.posix.relative(path.posix.dirname(current.path), target.path);
        return `${relative.startsWith('.') ? '' : './'}${encodePath(relative)}${suffix}`;
      } catch (error) {
        if (!required && error.code === 'ENOENT' && !/^(?:file:|[a-z]:[\\/])|\/api\/(?:local-file|filesystem)/i.test(reference)) return reference;
        throw new Error(`${current.path}: cannot include ${reference}: ${error.message}`, {cause:error});
      }
    }
    if (TEXT_FILE.test(current.path)) {
      const source = current.content ?? await fs.readFile(current.sourcePath,'utf8');
      let rewritten;
      if (/\.(?:html?|svg|xml)$/i.test(current.path)) rewritten = await rewriteHTML(source,resolve, value => {
        const local = localApiPath(value,absoluteWorkspace);
        const parsed = local ? pathToFileURL(local + (value.split(/[?#]/)[0].endsWith('/') ? path.sep : '')) : new URL(value,base || undefined);
        base = parsed;
        return parsed.protocol === 'file:';
      });
      else if (/\.css$/i.test(current.path)) rewritten = await rewriteCSS(source,resolve);
      else rewritten = await rewriteStrings(source,resolve);
      current.bytes = Buffer.from(rewritten);
      totalBytes += current.bytes.length - current.size; current.size = current.bytes.length;
      current.sha256 = digest(current.bytes);
    } else {
      // Bounded one-file read; no media cache retained across preparations.
      current.sha256 = digest(await fs.readFile(current.sourcePath));
    }
    if (current.size > limits.maxFileBytes) throw new Error(`${current.path} exceeds the per-file byte limit`);
    if (current === entry && current.size > limits.maxEntryBytes) throw new Error('Entry HTML exceeds the byte limit');
    checkLimits();
  }
  const now = Date.now();
  for (const [id, prepared] of preparations) if (prepared.expiresAt <= now) preparations.delete(id);
  const cachedBytes = [...entries.values()].reduce((sum,file) => sum + (file.bytes?.length || 0),0);
  if (cachedBytes > MAX_CACHED_TEXT_BYTES) throw new Error('Prepared text exceeds the memory limit');
  const occupiedBytes = () => [...preparations.values()].reduce((sum,item) => sum + item.cachedBytes,0);
  while (preparations.size >= MAX_PREPARATIONS || occupiedBytes() + cachedBytes > MAX_CACHED_TEXT_BYTES) preparations.delete(preparations.keys().next().value);
  const preparationId = crypto.randomUUID();
  preparations.set(preparationId, {ownerId,entries,cachedBytes,expiresAt:now + PREPARATION_TTL_MS});
  const files = [...entries.values()].map(({path:logicalPath,size,mime,sha256,modifiedMs}) => ({path:logicalPath,size,mime,sha256,modifiedMs}));
  const workspaceRelativeRoot = root && isInside(absoluteWorkspace,root) ? path.relative(absoluteWorkspace,root).replace(/\\/g,'/') : root;
  return {schemaVersion:1, preparationId, rootPath:workspaceRelativeRoot || '', entryPath:entry.path, files, excluded,
    totals:{files:files.length,bytes:totalBytes}, manifestHash:digest(JSON.stringify(files.map(({path:logicalPath,size,sha256}) => ({path:logicalPath,size,sha256})))),
    preparationSource: inline ? {html,baseDir} : {entryPath,rootPath},
    imported: [...entries.values()].filter(file => file.sourcePath && (!root || !isInside(root,file.sourcePath))).map(file => ({path:file.path,sourcePath:file.sourcePath})),
  };
}

export async function readPreparedFile(preparationId, logicalPath, ownerId) {
  const prepared = preparations.get(preparationId);
  if (!prepared || prepared.ownerId !== ownerId || prepared.expiresAt <= Date.now()) throw new Error('Share preparation expired or belongs to another owner; prepare again');
  const entry = prepared.entries.get(normalizeBundlePath(logicalPath));
  if (!entry) throw new Error('File is not declared in this share preparation');
  if (entry.bytes) return entry.bytes;
  const realPath = await fs.realpath(entry.sourcePath);
  if (keyFor(realPath) !== keyFor(entry.sourcePath)) throw new Error(`${logicalPath} changed after preflight`);
  const bytes = await fs.readFile(realPath);
  if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`${logicalPath} changed after preflight; prepare again`);
  return bytes;
}
export function clearPreparedBundles() { preparations.clear(); }
