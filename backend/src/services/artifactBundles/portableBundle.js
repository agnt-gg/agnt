import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUNDLE_LIMITS, mimeFor, normalizeBundlePath, shouldExclude } from './manifest.js';

// A bundle is the entry plus what it references, followed recursively: HTML
// attributes, srcset, srcdoc, CSS url()/@import and static path strings in
// scripts. Nothing is captured for merely sharing the entry's folder: a page's
// neighbours (drafts, renders, notes) are not published by accident.
// Runtime-built names (`frames/${i}.png`, 'level_' + n + '.json') become
// patterns matched inside exactly one folder. Loads the scanner cannot see
// (fetch(url), img.src = computed) become warnings naming a folder the owner
// can opt in (includeDirs). Every file records why it is in the bundle.
//
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
// Speculative strings need a filename before the extension: '.svg' is often
// a generated download suffix, not a dependency. Explicit URL attributes and
// CSS URLs still resolve directly and retain all filesystem exclusions.
const PATH_LITERAL = /^(?:file:\/\/[^\s]+|(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/(?:local-file\/|filesystem\/raw\b)|\.{1,2}\/|[a-z]:[\\/])|^[^\s<>]+\.(?:html?|css|m?js|json|gltf|glb|wasm|png|jpe?g|webp|gif|svg|avif|mp4|webm|mp3|wav|woff2?|ttf|bin)(?:[?#].*)?$/i;
// Extensions a runtime-built name must end in before it is matched as a pattern.
const PATTERN_EXT = /\.(?:html?|css|m?js|json|gltf|glb|bin|wasm|png|jpe?g|webp|gif|svg|avif|mp4|webm|mov|mp3|wav|ogg|m4a|woff2?|ttf|otf|txt|csv|xml|obj|mtl|ktx2|hdr|exr)$/i;
const DYNAMIC = '\u0000';                  // stands for one computed segment of a runtime-built name
const MAX_INCLUDE_DIRS = 16;
const MAX_WARNINGS = 40;
const formatBytes = bytes => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB`
  : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;

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
  // Static string values only; never evaluate user JavaScript. Runtime-built
  // names are handled by scanRuntimeNames, which matches them as patterns.
  return replaceMatches(source, /(["'`])((?:\\.|(?!\1)[^\\\r\n])*?)\1/g, async match => {
    const value = match[2].replace(/\\\//g, '/');
    if (value.includes('${')) return match[0];
    let rewritten = value;
    // CSS assigned from script: el.style.background = "url('bg.png')"
    if (/url\(/i.test(value) && !value.includes('\\')) rewritten = await rewriteCSS(value, reference => resolve(reference, false));
    else if (PATH_LITERAL.test(value) && !/^file:\/*$/i.test(value)) rewritten = await resolve(value, false);
    return rewritten === value ? match[0] : `${match[1]}${rewritten.replaceAll(match[1], `\\${match[1]}`)}${match[1]}`;
  });
}

// Runtime-built names in script text. Returns path candidates in which each
// computed segment is DYNAMIC, static paths that live inside template markup
// (never rewritten, since the template itself is not), and computed loads the
// scanner cannot resolve at all. Pure text analysis: nothing is evaluated.
const STR = String.raw`'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*"`;
const EXPR = String.raw`(?:[A-Za-z_$][\w$]*|\d+|\((?:[^()\r\n]|\([^()\r\n]*\))*\))(?:\.[A-Za-z_$][\w$]*|\[[^\]\r\n]*\]|\((?:[^()\r\n]|\([^()\r\n]*\))*\))*`;
const CONCATENATION = new RegExp(`(?:${STR})(?:\\s*\\+\\s*(?:${EXPR})(?:\\s*\\+\\s*(?:${STR}))?)+`, 'g');
const TEMPLATE = /`((?:\\[\s\S]|\$\{[^}]*\}|[^`\\$]|\$(?!\{))*)`/g;
const COMPUTED_LOAD = /(?:\b(?:fetch|import|new\s+(?:URL|Worker|Audio|Request)|loadTexture|loadImage)|\.load(?:Async)?)\s*\(\s*(?![\s'"`)])([^,)\r\n]{1,60})|\.src\s*=(?!=)\s*(?![\s'"`])([^;,\r\n]{1,60})/g;
const NOT_A_FILE_LOAD = /toDataURL|createObjectURL|location|import\.meta|blob|data:|https?:|\bnull\b|\bundefined\b/i;
function pathCandidates(text) {
  if (!/[<=]|url\(/i.test(text)) return [text.trim()];
  const found = [];
  for (const match of text.matchAll(/(?:^|[\s<])(?:src|href|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) found.push(match[1] ?? match[2]);
  for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) found.push(match[1]);
  return found;
}
function scanRuntimeNames(source) {
  const patterns = [], statics = [], computed = [];
  const consider = (text, snippet) => {
    for (const raw of pathCandidates(text)) {
      const value = raw.split(/[?#]/)[0];
      if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) continue;       // remote, data:, root-relative: not a bundle file
      if (!PATTERN_EXT.test(value.replaceAll(DYNAMIC, 'x'))) continue;
      if (!value.includes(DYNAMIC)) { statics.push(value); continue; }
      const slash = value.lastIndexOf('/');
      const folder = slash < 0 ? '' : value.slice(0, slash + 1), name = value.slice(slash + 1);
      if (folder.includes(DYNAMIC) || !name.replaceAll(DYNAMIC, '')) computed.push(snippet);   // computed folder: cannot be bounded
      else patterns.push({ folder, name, display: value.replaceAll(DYNAMIC, '*') });
    }
  };
  for (const match of source.matchAll(TEMPLATE)) {
    if (match[1].includes('${')) consider(match[1].replace(/\$\{[^}]*\}/g, DYNAMIC), match[0].slice(0, 80));
  }
  for (const match of source.matchAll(CONCATENATION)) {
    let text = '', last = 0;
    const literals = [...match[0].matchAll(new RegExp(STR, 'g'))];
    for (const literal of literals) {
      if (/[^\s+]/.test(match[0].slice(last, literal.index))) text += DYNAMIC;
      text += literal[0].slice(1, -1).replace(/\\\//g, '/');
      last = literal.index + literal[0].length;
    }
    if (/[^\s+]/.test(match[0].slice(last))) text += DYNAMIC;
    if (text.includes(DYNAMIC)) consider(text, match[0].slice(0, 80));
  }
  for (const match of source.matchAll(COMPUTED_LOAD)) {
    const argument = (match[1] ?? match[2]).trim();
    if (NOT_A_FILE_LOAD.test(argument)) continue;
    // A variable visibly holding an in-memory URL (worker blobs, canvas data) loads no file:
    // `const r = URL.createObjectURL(new Blob([...]))` ... `new Worker(r)`
    if (/^[A-Za-z_$][\w$]*$/.test(argument)
      && new RegExp(`(?:^|[^\\w$.])${argument.replace(/\$/g, '\\$')}\\s*=\\s*[^;\\r\\n]*?(?:createObjectURL|toDataURL)\\s*\\(`).test(source)) continue;
    computed.push(match[0].slice(0, 80));
  }
  return { patterns, statics, computed };
}
async function rewriteSrcset(source, resolve) {
  // URL token ends at whitespace, not a comma inside a data URI.
  return replaceMatches(source, /(^|,\s*)(\S+)([^,]*)/g, async match => {
    const trailingComma = match[2].endsWith(',') && !match[2].startsWith('data:');
    const value = trailingComma ? match[2].slice(0,-1) : match[2];
    return `${match[1]}${await resolve(value)}${trailingComma ? ',' : ''}${match[3]}`;
  });
}
async function rewriteHTML(source, resolve, setBase, onScript = () => {}) {
  // cheerio is loaded on first use, not at boot. See backend/boot.importBudget.test.js.
  const { load } = await import('cheerio');
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
      // srcdoc is a whole document; its relative URLs resolve against this page's base
      else if (name === 'srcdoc') rewritten = await rewriteHTML(value, resolve, () => false, onScript);
      else if (name === 'srcset' || name === 'imagesrcset') rewritten = await rewriteSrcset(value, resolve);
      else if (['src','href','xlink:href','poster','data'].includes(name)) rewritten = await resolve(value);
      else if (name.startsWith('data-') && PATH_LITERAL.test(value)) rewritten = await resolve(value, false);
      if (rewritten !== value) edits.push({start:attr.startOffset, end:attr.endOffset, text:`${name}="${rewritten.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"`});
    }
    if ((element.name === 'script' || element.name === 'style') && location.startTag && location.endTag) {
      const start = location.startTag.endOffset, end = location.endTag.startOffset;
      const contents = source.slice(start,end);
      if (element.name === 'script') onScript(contents);
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

// rootPath sets the bundle layout (logical paths are relative to it); it does
// not capture anything. includeDirs are folders the owner explicitly opted in:
// the only way a file travels without being referenced.
export async function preparePortableBundle({ workspaceRoot, entryPath, rootPath, html, baseDir, overrides = [], includeDirs = [], ownerId, limits = BUNDLE_LIMITS }) {
  if (!ownerId) throw new Error('Preparation owner is required');
  if (!Array.isArray(includeDirs) || includeDirs.length > MAX_INCLUDE_DIRS || includeDirs.some(dir => typeof dir !== 'string' || !dir.trim())) {
    throw new Error(`includeDirs must be a list of at most ${MAX_INCLUDE_DIRS} folder paths`);
  }
  if (!Array.isArray(overrides) || overrides.some(item => typeof item?.content !== 'string')) throw new Error('Override file is not declared: overrides must carry text content');
  const inline = typeof html === 'string';
  // Canonicalize BEFORE containment / identity checks. On macOS, os.tmpdir()
  // is under /var and /var realpaths to /private/var; comparing path.resolve
  // against fs.realpath then rejects every regular temp file as a "symlink".
  // realpath workspace/root directories (and a verified regular entry) once so
  // isInside/logicalFor/bySource stay coherent. Entry must be lstat-checked
  // BEFORE realpath — otherwise a leaf symlink entry is silently resolved and
  // bypasses the non-symlink file rule that addFile enforces for dependencies.
  const absoluteWorkspace = await fs.realpath(path.resolve(workspaceRoot));
  let absoluteEntry = null;
  if (!inline) {
    absoluteEntry = resolveInputPath(entryPath, absoluteWorkspace);
    assertPublicFile(absoluteEntry);
    const entryStat = await fs.lstat(absoluteEntry);
    if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
      throw new Error(`Referenced path is not a regular, non-symlink file: ${absoluteEntry}`);
    }
    absoluteEntry = await fs.realpath(absoluteEntry);
    assertPublicFile(absoluteEntry);
  }
  const resolvedRoot = inline ? (baseDir ? resolveInputPath(baseDir, absoluteWorkspace) : null) : (rootPath === undefined || rootPath === null ? path.dirname(absoluteEntry) : resolveInputPath(rootPath || '.', absoluteWorkspace));
  const root = resolvedRoot ? await fs.realpath(resolvedRoot) : null;
  if (absoluteEntry && !isInside(root, absoluteEntry)) throw new Error('Entry escapes artifact root');
  const entries = new Map(), bySource = new Map(), walked = new Set(), excluded = [], warnings = [];
  // Editor content replaces a file's bytes when that file joins the bundle. A
  // dirty tab nothing references is not part of this share and is ignored.
  const overrideByPath = new Map(overrides.map(item => [normalizeBundlePath(item.path), item.content]));
  let totalBytes = 0;
  const workspaceDisplay = absolutePath => isInside(absoluteWorkspace, absolutePath) ? (path.relative(absoluteWorkspace, absolutePath).replace(/\\/g, '/') || '.') : absolutePath;
  function describeVia(via) {
    if (via.kind === 'entry') return 'the entry';
    if (via.kind === 'pattern') return `matched by ${via.pattern} in ${via.from}`;
    if (via.kind === 'folder') return `in included folder ${via.dir}`;
    return `referenced by ${via.from}`;
  }
  // Name what pushed the bundle over: "1.4 GB in 1140 files matched by frames/*.png in index.html"
  function limitDetail() {
    const groups = new Map();
    for (const file of entries.values()) {
      const via = file.via || { kind:'entry' };
      const why = via.kind === 'entry' ? 'for the entry' : describeVia(via);
      const group = groups.get(why) || { why, bytes:0, files:0 };
      group.bytes += file.size; group.files += 1; groups.set(why, group);
    }
    const top = [...groups.values()].sort((a,b) => b.bytes - a.bytes || b.files - a.files).slice(0, 3);
    return top.length ? `: ${top.map(g => `${formatBytes(g.bytes)} in ${g.files} file${g.files === 1 ? '' : 's'} ${g.why}`).join('; ')}` : '';
  }
  function checkLimits() {
    if (entries.size > limits.maxFiles) throw new Error(`Bundle exceeds the ${limits.maxFiles} file limit${limitDetail()}`);
    if (totalBytes > limits.maxTotalBytes) throw new Error(`Bundle exceeds the ${limits.maxTotalBytes} byte total limit${limitDetail()}`);
  }
  function warn(warning) {
    const key = `${warning.kind}|${warning.file}|${warning.detail}`;
    if (warnings.length < MAX_WARNINGS && !warnings.some(w => `${w.kind}|${w.file}|${w.detail}` === key)) warnings.push(warning);
  }
  function logicalFor(absolutePath) {
    if (root && isInside(root, absolutePath)) return normalizeBundlePath(path.relative(root,absolutePath).replace(/\\/g,'/'));
    return `_assets/${digest(keyFor(path.dirname(absolutePath))).slice(0,16)}/${path.basename(absolutePath)}`;
  }
  async function addFile(absolutePath, required = true, via = { kind:'reference' }) {
    absolutePath = path.resolve(absolutePath);
    assertPublicFile(absolutePath);
    const stat = await fs.lstat(absolutePath);
    // Reject the LEAF symlink first. Only then canonicalize ancestor directory
    // symlinks (macOS /var → /private/var) so identity keys match realpath.
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Referenced path is not a regular, non-symlink file: ${absolutePath}`);
    absolutePath = await fs.realpath(absolutePath);
    // Both spellings must satisfy exclusions before the canonical identity is reused.
    assertPublicFile(absolutePath);
    const key = keyFor(absolutePath);
    if (bySource.has(key)) return bySource.get(key);
    const logicalPath = logicalFor(absolutePath);
    if (entries.has(logicalPath)) throw new Error(`Bundle path collision: ${logicalPath}`);
    if (stat.size > limits.maxFileBytes) throw new Error(`${logicalPath} exceeds the per-file byte limit`);
    const entry = { path:logicalPath, sourcePath:absolutePath, sourceSize:stat.size, modifiedMs:Math.trunc(stat.mtimeMs), size:stat.size, mime:mimeFor(logicalPath), required, via };
    if (overrideByPath.has(logicalPath)) { entry.content = overrideByPath.get(logicalPath); entry.size = Buffer.byteLength(entry.content); }
    entries.set(logicalPath, entry); bySource.set(key, entry); totalBytes += entry.size; checkLimits();
    return entry;
  }
  // Opted-in folders only (includeDirs). Never reached from a reference.
  async function walk(directory, via) {
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
      if (child.isDirectory()) await walk(absolutePath, via);
      else if (child.isFile()) await addFile(absolutePath, false, via);
    }
  }
  // Runtime-built names: match `folder/name*` in that one folder, relative to
  // the referring file. Matches keep their relative layout, so the page's
  // runtime string still resolves after publishing.
  async function addPattern(current, base, pattern) {
    if (!base || base.protocol !== 'file:') { warn({ kind:'runtime_pattern_unresolved', file:current.path, detail:pattern.display, folder:null }); return; }
    const folder = fileURLToPath(new URL(pattern.folder || './', base));
    if (root && !isInside(root, folder)) {
      warn({ kind:'runtime_pattern_outside_root', file:current.path, detail:pattern.display, folder:workspaceDisplay(folder) });
      return;
    }
    let children;
    try { children = await fs.readdir(folder, { withFileTypes:true }); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return; throw error; }
    const escaped = pattern.name.split(DYNAMIC).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const matcher = new RegExp(`^${escaped.join('[^/\\\\]*')}$`, process.platform === 'win32' ? 'i' : '');
    for (const child of children.sort((a,b) => a.name.localeCompare(b.name))) {
      if (!child.isFile() || child.isSymbolicLink() || !matcher.test(child.name)) continue;
      const absolutePath = path.join(folder, child.name);
      const reason = shouldExclude(root ? path.relative(root, absolutePath) : child.name);
      if (reason) { excluded.push({ path:workspaceDisplay(absolutePath), reason }); continue; }
      await addFile(absolutePath, false, { kind:'pattern', pattern:pattern.display, from:current.path });
    }
  }
  let entry;
  if (inline) {
    let name = '__agnt_share__.html';
    for (let i=1; entries.has(name); i++) name = `__agnt_share_${i}.html`;
    entry = {path:name, sourcePath:root ? path.join(root,name) : null, content:html, size:Buffer.byteLength(html), modifiedMs:0, mime:mimeFor(name), via:{kind:'entry'}};
    entries.set(name,entry); totalBytes += entry.size; checkLimits();
  } else entry = await addFile(absoluteEntry, true, { kind:'entry' });
  const includedDirs = [];
  for (const requested of includeDirs) {
    const lexical = resolveInputPath(requested, absoluteWorkspace);
    if (path.parse(lexical).root === lexical) throw new Error(`Refusing to include a filesystem root: ${requested}`);
    const reason = shouldExclude(lexical.replace(/\\/g, '/'), true);
    if (reason === 'secret_like_name' || reason === 'hidden_path') throw new Error(`Included folder is excluded (${reason}): ${requested}`);
    const stat = await fs.lstat(lexical);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Included folder is not a regular directory: ${requested}`);
    const directory = await fs.realpath(lexical);
    const display = workspaceDisplay(directory);
    includedDirs.push(display);
    await walk(directory, { kind:'folder', dir:display });
  }
  // Map iteration visits newly discovered entries, including cyclic HTML graphs,
  // exactly once. Queue size and total bytes remain bounded by bundle limits.
  for (const current of entries.values()) {
    let base = current.sourcePath ? pathToFileURL(current.sourcePath) : null;
    const runtime = { patterns:[], statics:[], computed:[] };
    const scanScript = source => { const found = scanRuntimeNames(source); for (const key of Object.keys(runtime)) runtime[key].push(...found[key]); };
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
        // A linked page's own references are followed when the loop reaches it.
        const target = await addFile(resolved, required, { kind:'reference', from:current.path, ref:reference.slice(0, 120) });
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
      }, scanScript);
      else if (/\.css$/i.test(current.path)) rewritten = await rewriteCSS(source,resolve);
      else {
        if (/\.m?js$/i.test(current.path)) scanScript(source);
        rewritten = await rewriteStrings(source,resolve);
      }
      // Runtime names resolve against the final base (a <base href> may have moved it).
      for (const pattern of runtime.patterns) await addPattern(current, base, pattern);
      for (const value of runtime.statics) {
        if (!base || base.protocol !== 'file:') continue;
        // Paths inside template markup are not rewritten; they must stay where the page expects them.
        const target = fileURLToPath(new URL(value, base));
        if (root && !isInside(root, target)) { warn({ kind:'runtime_pattern_outside_root', file:current.path, detail:value, folder:workspaceDisplay(path.dirname(target)) }); continue; }
        try { await addFile(target, false, { kind:'reference', from:current.path, ref:value }); }
        catch (error) { if (!(error.code === 'ENOENT' || error.cause?.code === 'ENOENT')) throw error; }
      }
      if (runtime.computed.length) {
        const folder = current.sourcePath ? workspaceDisplay(path.dirname(current.sourcePath)) : null;
        warn({ kind:'runtime_load', file:current.path, detail:`${runtime.computed.length} load${runtime.computed.length === 1 ? '' : 's'} with a computed path, e.g. ${runtime.computed[0]}`, folder });
      }
      current.bytes = Buffer.from(rewritten);
      totalBytes += current.bytes.length - current.size; current.size = current.bytes.length;
      current.sha256 = digest(current.bytes);
    } else if (current.content !== undefined) {
      current.bytes = Buffer.from(current.content);   // editor content for a non-text extension
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
  // sources and warnings describe the local filesystem: the publisher keeps them out of the remote manifest.
  const sources = Object.fromEntries([...entries.values()].map(file => [file.path, { ...file.via, reason:describeVia(file.via || { kind:'entry' }) }]));
  return {schemaVersion:1, preparationId, rootPath:workspaceRelativeRoot || '', entryPath:entry.path, files, excluded,
    totals:{files:files.length,bytes:totalBytes}, manifestHash:digest(JSON.stringify(files.map(({path:logicalPath,size,sha256}) => ({path:logicalPath,size,sha256})))),
    sources, warnings, includeDirs:includedDirs,
    preparationSource: inline ? {html,baseDir,includeDirs} : {entryPath,rootPath,includeDirs},
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
