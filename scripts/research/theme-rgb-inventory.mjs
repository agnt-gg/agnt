#!/usr/bin/env node
// Research only: literal source occurrences, not CSS validity or runtime reachability.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { parse: parseSfc } = requireFrontend('@vue/compiler-sfc');
const { parse: parseMarkup } = requireFrontend('@vue/compiler-dom');
const { parse: parseJs } = requireFrontend('@babel/parser');
const token = String.raw`(--[\w-]+-rgb)(?![\w-])`;
const patterns = {
  references: String.raw`\bvar\(\s*${token}(?=\s*[,\)])`,
  directRgba: String.raw`\brgba\(\s*var\(\s*${token}(?=\s*[,\)])`,
  declarations: String.raw`${token}\s*:`,
};
const excluded = /(?:^|\/)(?:node_modules|plugins|\.cache|cache|caches|dist|coverage)(?:\/|$)/;
export function inScope(path) {
  return path.startsWith('frontend/src/') && /\.(vue|css|js|ts|html)$/.test(path)
    && !/\.(spec|test)\./.test(path) && !excluded.test(path);
}

// Blank ranges rather than deleting them: comments must not join unrelated lexemes.
function blankRanges(source, ranges) {
  let end = 0;
  return ranges.sort((a, b) => a.start - b.start).map((range) => {
    const part = source.slice(end, range.start) + source.slice(range.start, range.end).replace(/[^\r\n]/g, ' ');
    end = range.end;
    return part;
  }).join('') + source.slice(end);
}
export function stripJsComments(source, lang = 'js') {
  const ast = parseJs(source, {
    sourceType: 'unambiguous', plugins: lang === 'ts' ? ['typescript'] : lang === 'tsx' ? ['typescript', 'jsx'] : ['jsx'],
  });
  return blankRanges(source, ast.comments);
}
export function stripCssComments(source) {
  const ranges = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      while (++i < source.length && source[i] !== quote) if (source[i] === '\\') i++;
      if (i >= source.length) throw new Error('Unterminated CSS string');
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated CSS comment');
      ranges.push({ start: i, end: end + 2 });
      i = end + 1;
    }
  }
  return blankRanges(source, ranges);
}
export function stripHtmlComments(source) {
  const ast = parseMarkup(source, { parseMode: 'html', onError: (error) => { throw error; } });
  const ranges = [];
  const parts = [];
  function expression(exp, statements = false) {
    if (!exp || !/\/[/*]/.test(exp.loc.source)) return;
    const text = exp.loc.source;
    parts.push(statements ? stripJsComments(text, 'ts') : stripJsComments('(' + text + '\n)', 'ts').slice(1, -2));
    ranges.push({ start: exp.loc.start.offset, end: exp.loc.end.offset });
  }
  function visit(node) {
    const start = node.loc.start.offset;
    const end = node.loc.end.offset;
    if (node.type === 3) ranges.push({ start, end });
    else if (node.type === 1 && ['script', 'style'].includes(node.tag)) {
      // Raw-text children have exact offsets, including '<' inside JS strings.
      for (const child of node.children) {
        const text = child.loc.source;
        parts.push(node.tag === 'style' ? stripCssComments(text) : stripJsComments(text));
        ranges.push({ start: child.loc.start.offset, end: child.loc.end.offset });
      }
    } else {
      if (node.type === 5) expression(node.content);
      for (const prop of node.props || []) if (prop.type === 7) expression(prop.exp, prop.name === 'on');
      for (const child of node.children || []) visit(child);
    }
  }
  visit(ast);
  return [blankRanges(source, ranges), ...parts].join('\n');
}
export function sourceParts(source, path) {
  if (path.endsWith('.vue')) {
    const { descriptor, errors } = parseSfc(source, { filename: path });
    if (errors.length) throw new Error(errors.map((e) => e.message || e).join('; '));
    return [
      ...(descriptor.template ? [stripHtmlComments(descriptor.template.content)] : []),
      ...[descriptor.script, descriptor.scriptSetup].filter(Boolean).map((b) => stripJsComments(b.content, b.lang)),
      ...descriptor.styles.map((b) => stripCssComments(b.content)),
    ];
  }
  if (path.endsWith('.html')) return [stripHtmlComments(source)];
  if (path.endsWith('.css')) return [stripCssComments(source)];
  return [stripJsComments(source, path.endsWith('.ts') ? 'ts' : 'js')];
}
export function countParts(parts) {
  const counts = {};
  for (const part of parts) for (const [kind, pattern] of Object.entries(patterns)) {
    for (const match of part.matchAll(new RegExp(pattern, 'g'))) {
      counts[match[1]] ||= { references: 0, directRgba: 0, declarations: 0 };
      counts[match[1]][kind]++;
    }
  }
  return counts;
}
export function parseArgs(args) {
  if (!args.length) return null;
  if (args.length === 2 && args[0] === '--ref' && args[1] && !args[1].startsWith('-')) return args[1];
  throw new Error('Usage: node scripts/research/theme-rgb-inventory.mjs [--ref <git-ref>]');
}
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function inventory(ref = null) {
  const commit = ref ? git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim() : null;
  const listed = commit
    ? git(['ls-tree', '-r', '-z', commit, '--', 'frontend/src/']).split('\0').filter(Boolean)
      .filter((entry) => /^100(?:644|755) blob /.test(entry)).map((entry) => entry.split('\t')[1])
    : git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'frontend/src/']).split('\0');
  const files = [...new Set(listed.filter(inScope))].sort();
  let candidates = null;
  if (commit) {
    // One grep avoids fetching hundreds of irrelevant blobs individually.
    try {
      candidates = new Set(git(['grep', '-l', '-z', '-F', '-e', '-rgb', commit, '--', 'frontend/src/'])
        .split('\0').filter(Boolean).map((path) => path.slice(commit.length + 1)));
    } catch (error) { if (error.status === 1) candidates = new Set(); else throw error; }
  }
  const kinds = Object.keys(patterns);
  const totals = Object.fromEntries(kinds.map((kind) => [kind, { occurrences: 0, files: 0 }]));
  const tokens = {};
  let parsedFiles = 0;
  for (const path of files) {
    if (candidates && !candidates.has(path)) continue;
    if (!commit) {
      try { if (!lstatSync(resolve(root, path)).isFile()) continue; }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    }
    const source = commit ? git(['show', `${commit}:${path}`]) : readFileSync(resolve(root, path), 'utf8');
    if (!source.includes('-rgb')) continue;
    let counts;
    try { counts = countParts(sourceParts(source, path)); }
    catch (error) { throw new Error(`${path}: ${error.message}`); }
    parsedFiles++;
    for (const kind of kinds) {
      const occurrences = Object.values(counts).reduce((sum, count) => sum + count[kind], 0);
      totals[kind].occurrences += occurrences;
      if (occurrences) totals[kind].files++;
    }
    for (const [name, count] of Object.entries(counts)) {
      tokens[name] ||= Object.fromEntries(kinds.map((kind) => [kind, { occurrences: 0, files: 0 }]));
      for (const kind of kinds) {
        tokens[name][kind].occurrences += count[kind];
        if (count[kind]) tokens[name][kind].files++;
      }
    }
  }
  return {
    schema: 'agnt.theme-rgb-inventory.v1',
    git: { mode: commit ? 'snapshot' : 'working-tree', commit },
    scope: {
      root: 'frontend/src', extensions: ['vue', 'css', 'js', 'ts', 'html'],
      files: commit ? 'tracked regular blobs' : 'tracked + nonignored untracked regular files (deleted skipped)',
      excludes: ['.spec.', '.test.', 'node_modules/', 'plugins/', '.cache/', 'cache/', 'caches/', 'dist/', 'coverage/'],
      listedFiles: files.length, parsedFiles,
      semantics: 'Literal ASCII *-rgb source occurrences; comments excluded; strings included; not runtime reachability.',
      parsing: 'Only files containing -rgb are parsed; Vue custom blocks omitted; no external src loading or CSS evaluation.',
    },
    totals, tokens: Object.fromEntries(Object.entries(tokens).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
  };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(inventory(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) {
    console.error(JSON.stringify({ schema: 'agnt.theme-rgb-inventory.v1', error: String(error.message).replaceAll(root, '') }));
    process.exitCode = 1;
  }
}
