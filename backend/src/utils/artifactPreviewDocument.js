import { createRequire } from 'module';
import { fileURLToPreviewURL, rewritePreviewCSS, PREVIEW_MESSAGE, PREVIEW_CHANNEL_PARAM } from './artifactPreviewUrls.js';

// cheerio and htmlparser2 load on the first preview, not at boot (see
// backend/boot.importBudget.test.js). Planning is synchronous, so both come
// through require (their CommonJS builds) rather than import().
const requireOnDemand = createRequire(import.meta.url);
let cheerio = null;
let htmlparser2 = null;
const load = (...args) => (cheerio ??= requireOnDemand('cheerio')).load(...args);
const createTokenizer = (handlers, options) => new (htmlparser2 ??= requireOnDemand('htmlparser2')).Parser(handlers, options);

export const MAX_PREVIEW_TEXT_BYTES = 8 * 1024 * 1024;

/** Compare the browser's original path, before Express normalizes mount slashes. */
export function previewDocumentBase(originalURL, documentURL) {
  return originalURL.split('?')[0] === documentURL ? undefined : documentURL;
}

export function previewResourceURL(value, prefix = '/api/local-preview/') {
  if (/^file:\/\//i.test(value || '')) return fileURLToPreviewURL(value,prefix);
  // Only known local API forms. Never rewrite an unrelated remote service.
  return value.replace(/^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/api\/local-file\//i,prefix);
}

/** Reports load/errors, not correctness. Existing CSP may deliberately block it. */
export function previewReporterSource(channel) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(channel || '')) return '';
  return `(()=>{const channel=${JSON.stringify(channel)},type=${JSON.stringify(PREVIEW_MESSAGE)};let errors=0;const report=(state,detail='')=>parent.postMessage({type,channel,state,detail},'*');addEventListener('error',event=>{if(errors++>=10)return;const tag=event.target?.tagName;report('warning',tag?'Could not load '+tag.toLowerCase()+' resource.': 'The artifact reported a script error.');},true);addEventListener('unhandledrejection',()=>{if(errors++<10)report('warning','The artifact reported an unhandled promise rejection.');});const loaded=()=>report('loaded');if(document.readyState==='complete')loaded();else addEventListener('load',loaded,{once:true});})();`;
}

const escapeAttribute = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;');

/**
 * A preview is the author's bytes plus at most three kinds of change: local
 * URLs rewritten to /api/local-preview/, a <base> so relative URLs resolve
 * against the real file, and the diagnostics reporter. The reporter carries a
 * per-iframe channel, so it is spliced in per request (withPreviewReporter);
 * everything else depends only on the file and is planned once per revision.
 *
 * @returns {{ html: string, reporterAt: number }} reporterAt is where the
 *   reporter script goes, as an offset into `html`.
 */
export function planPreviewDocument(source, options = {}) {
  return planPreviewDocumentFast(source, options) ?? planWithFullParse(source, options);
}

/** The plan when the landmark scan can produce it, otherwise null (needs planWithFullParse). */
export function planPreviewDocumentFast(source, options = {}) {
  const landmarks = scanPreviewLandmarks(source);
  return landmarks ? planFromLandmarks(source, landmarks, options) : null;
}

export function withPreviewReporter({ html, reporterAt }, channel) {
  const reporter = previewReporterSource(channel);
  return reporter ? html.slice(0, reporterAt) + `<script>${reporter}</script>` + html.slice(reporterAt) : html;
}

/** Preserve source bytes outside edited attributes/styles; never rewrite JavaScript. */
export function preparePreviewHTML(source, { channel = '', ...options } = {}) {
  return withPreviewReporter(planPreviewDocument(source, options), channel);
}

/**
 * The reference transform: a located parse5 DOM, so every attribute and
 * <style> edit lands on exact source offsets. Cost grows with document size
 * (~450 ms for a 4.8 MB page), which is why scanPreviewLandmarks exists.
 */
export function planWithFullParse(source, { documentURL, prefix = '/api/local-preview/' } = {}) {
  const $=load(source,{sourceCodeLocationInfo:true});
  const edits=[];
  const resolve=value=>previewResourceURL(value,prefix);
  let hasBase=false;
  for(const element of $('*').toArray()) {
    const location=element.sourceCodeLocation;if(!location)continue;
    for(const [name,value] of Object.entries(element.attribs||{})) {
      if(element.name==='base'&&name==='href')hasBase=true;
      const attr=location.attrs?.[name];if(!attr)continue;
      let replacement=value;
      if(['src','href','poster','data','xlink:href'].includes(name))replacement=resolve(value);
      else if(name==='style')replacement=rewritePreviewCSS(value,resolve);
      else if(name==='srcset'||name==='imagesrcset') {
        // Replace only explicit local URL tokens, preserving data URI commas.
        replacement=value.replace(/(?:file:\/\/|\/api\/local-file\/)[^\s,]+/gi,resolve);
      }
      if(replacement!==value)edits.push({start:attr.startOffset,end:attr.endOffset,text:`${name}="${escapeAttribute(replacement)}"`});
    }
    if(element.name==='style'&&location.startTag&&location.endTag) {
      const start=location.startTag.endOffset,end=location.endTag.startOffset;
      const content=source.slice(start,end),replacement=rewritePreviewCSS(content,resolve);
      if(replacement!==content)edits.push({start,end,text:replacement});
    }
  }
  if(!hasBase&&documentURL) {
    // Use the actual resolved file, not a stale requested path, as the relative base.
    const at=baseInsertionOffset(source,{
      headEnd:$('head')[0]?.sourceCodeLocation?.startTag?.endOffset,
      htmlEnd:$('html')[0]?.sourceCodeLocation?.startTag?.endOffset,
      policies:$('meta[http-equiv]').toArray().filter(element =>
        element.attribs['http-equiv'].toLowerCase() === 'content-security-policy'
      ).map(element => element.sourceCodeLocation?.endOffset || 0),
    });
    edits.push({start:at,end:at,text:`<base href="${escapeAttribute(documentURL)}">`});
  }
  return applyEdits(source,edits,$('body')[0]?.sourceCodeLocation?.endTag?.startOffset ?? source.length);
}

function planFromLandmarks(source, { hasBase, headEnd, htmlEnd, policies, reporterAt }, { documentURL } = {}) {
  if (hasBase || !documentURL) return { html: source, reporterAt };
  const at = baseInsertionOffset(source, { headEnd, htmlEnd, policies });
  return applyEdits(source, [{ start: at, end: at, text: `<base href="${escapeAttribute(documentURL)}">` }], reporterAt);
}

/** After the author's CSP, never before it: a <base> is subject to base-uri. */
function baseInsertionOffset(source, { headEnd, htmlEnd, policies }) {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
  return Math.max(headEnd ?? htmlEnd ?? doctype?.[0].length ?? 0, ...policies);
}

/**
 * Applies non-overlapping edits back to front and carries the reporter offset
 * through them. A zero-width insertion AT the reporter offset lands before
 * the reporter, which is where the reporter always went.
 */
function applyEdits(source, edits, reporterAt) {
  let html = source, boundary = source.length, shift = 0;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (edit.end > boundary || (edit.start < reporterAt && edit.end > reporterAt)) throw new Error('Overlapping preview edits');
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
    boundary = edit.start;
    if (edit.start < reporterAt || (edit.start === reporterAt && edit.end === edit.start)) shift += edit.text.length - (edit.end - edit.start);
  }
  return { html, reporterAt: reporterAt + shift };
}

// ── Fast path ────────────────────────────────────────────────────────────────
//
// previewResourceURL, rewritePreviewCSS and the srcset rewrite change only
// values that name a local file. A document with none needs no attribute or
// CSS edit, just the <base> and reporter insertions, and their offsets come
// from a streaming tokenizer ~40x faster than parse5's located DOM.
//
// parse5 stays the reference. The scan answers only when it can prove
// parse5 would agree, and returns null (use the full parse) otherwise.

/** Attribute values parse5 hands to the rewriters, entity-decoded. */
const REWRITTEN_ATTRIBUTES = new Set(['src', 'href', 'poster', 'data', 'xlink:href', 'style', 'srcset', 'imagesrcset']);
const LOCAL_REFERENCE = /file:|local-file/i;
/**
 * Markup the two tokenizers read differently: <template>/<frameset> change the
 * tree, <plaintext> swallows the rest of the file, and CDATA, `--!>` and the
 * abrupt `<!-->`/`<!--->` comments end in different places.
 */
const TOKENIZER_HAZARD = /<(?:template|plaintext|frameset)[\t\n\f\r />]|<!\[CDATA\[|--!>|<!--->|<!-->/i;
/** Every written occurrence of the tags the plan depends on, wherever it sits. */
const WRITTEN_LANDMARK = /<(\/?)(html|head|body|base|meta)(?=[\t\n\f\r />])/gi;
/** parse5 reads their content as text (raw text, scripting-enabled noscript) or foreign content; htmlparser2 parses tags inside. */
const PARSE5_OPAQUE = new Set(['iframe', 'noembed', 'noframes', 'noscript', 'svg', 'math']);
/** parse5 keeps these in <head>, even after </head>, without implying <body>. */
const HEAD_CONTENT = new Set(['base', 'link', 'meta', 'noframes', 'noscript', 'script', 'style', 'title']);
/** parse5 reopens these after misnesting (active formatting elements); htmlparser2 does not. */
const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u']);
const HTML_WHITESPACE_ONLY = /^[\t\n\f\r ]*$/;

/**
 * Whether an attribute value, as parse5 would decode it, could name a local
 * file. The tokenizer runs without entity decoding (3x faster), so this
 * decodes only what can matter: no named reference yields an ASCII letter or
 * `-`, and `&colon;` is the only one yielding `:`. Numeric references are
 * decoded with or without their `;`, as attribute values allow. Over-matching
 * only ever costs a full parse.
 */
function mayNameLocalFile(raw) {
  if (!raw.includes('&')) return LOCAL_REFERENCE.test(raw);
  const decoded = raw
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_, hex, decimal) => {
      const point = parseInt(hex ?? decimal, hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
    })
    .replace(/&colon;/gi, ':');
  return LOCAL_REFERENCE.test(decoded);
}

/**
 * The offsets planPreviewDocument needs, or null when the document needs a
 * rewrite or parse5 might place them differently.
 *
 * The proof obligations, in order:
 *   - no local reference, raw or entity-encoded, so no attribute/CSS edit;
 *   - every written <html>/<head>/<body>/<base>/<meta>/</body> is a tag to
 *     htmlparser2, outside any element parse5 reads as text, so the two agree
 *     on which landmarks exist;
 *   - <html> and <head> follow only whitespace, comments and the doctype, so
 *     parse5 builds them from those tags rather than implying them;
 *   - <body> opens before anything that makes parse5 imply one, and </body>
 *     closes it with nothing else open. parse5 records the end tag only then.
 */
export function scanPreviewLandmarks(source) {
  if (source.charCodeAt(0) === 0xfeff || LOCAL_REFERENCE.test(source) || TOKENIZER_HAZARD.test(source)) return null;
  const written = { html: 0, head: 0, body: 0, base: 0, meta: 0, '/body': 0, '/html': 0 };
  for (const [, slash, name] of source.matchAll(WRITTEN_LANDMARK)) {
    const key = slash + name.toLowerCase();
    if (key in written) written[key]++;
  }
  if (written.html > 1 || written.head > 1 || written.body > 1 || written['/body'] > 1) return null;
  // Without </body>, parse5 records </html> as the body's end.
  if (written['/body'] === 0 && written['/html'] > 0) return null;

  const seen = { html: 0, head: 0, body: 0, base: 0, meta: 0, '/body': 0 };
  const open = [];
  const policies = [];
  let ambiguous = false;
  let opaqueDepth = 0;
  let beforeHead = true;
  let beforeBody = true;
  let bodyTrusted = false;
  let hasBase = false;
  let htmlEnd = null;
  let headEnd = null;
  let bodyEnd = null;
  let impliedCloseAt = -1;
  let scriptStart = -1;
  let nextComment = -1;
  const atTopLevel = () => open.every(name => name === 'html' || name === 'head');
  const leaveTrivia = () => {
    beforeHead = false;
    if (atTopLevel()) beforeBody = false;
  };

  const parser = createTokenizer({
    onopentag(name, attribs, implied) {
      if (implied) {
        // A stray </p> or </br>: parse5 ignores the first before <body> and
        // implies <body> for the second. Neither is trivia.
        leaveTrivia();
      } else {
        if (name in seen) {
          seen[name]++;
          if (opaqueDepth) ambiguous = true;
        }
        if (name === 'html') {
          if (beforeHead) htmlEnd ??= parser.endIndex + 1;
        } else if (name === 'head') {
          if (beforeHead) headEnd = parser.endIndex + 1;
          beforeHead = false;
        } else {
          beforeHead = false;
          const topLevel = atTopLevel();
          if (name === 'body') {
            bodyTrusted = beforeBody && topLevel;
            beforeBody = false;
          } else if (topLevel && !HEAD_CONTENT.has(name)) {
            beforeBody = false;
          }
          if (name === 'base' && 'href' in attribs) hasBase = true;
          if (name === 'meta' && 'http-equiv' in attribs) {
            const equiv = attribs['http-equiv'];
            // Raw value: an encoded one is decoded by parse5 and might match.
            if (equiv.includes('&')) ambiguous = true;
            else if (equiv.toLowerCase() === 'content-security-policy') policies.push(parser.endIndex + 1);
          }
        }
        for (const key in attribs) {
          if (REWRITTEN_ATTRIBUTES.has(key) && mayNameLocalFile(attribs[key])) ambiguous = true;
        }
        if (name === 'script') scriptStart = parser.endIndex + 1;
      }
      if (PARSE5_OPAQUE.has(name)) opaqueDepth++;
      open.push(name);
    },
    onclosetag(name, implied) {
      if (implied) {
        impliedCloseAt = parser.startIndex;
        // parse5 reads an opaque element's content as text up to its own end
        // tag (`<iframe />` is not self-closing); htmlparser2 just closed it
        // early, so everything after is markup to one and text to the other.
        if (FORMATTING.has(name) || PARSE5_OPAQUE.has(name)) ambiguous = true;
      } else if (name === 'body') {
        seen['/body']++;
        // Anything closed implicitly by this </body> was still open: parse5
        // then leaves the body's end tag unrecorded.
        if (!bodyTrusted || impliedCloseAt === parser.startIndex || opaqueDepth) ambiguous = true;
        bodyEnd = parser.startIndex;
      }
      if (name === 'script' && scriptStart >= 0) {
        // `<!--` in a script can start parse5's double-escaped state, where
        // `</script>` no longer ends it. htmlparser2 has no such state.
        if (nextComment < scriptStart) {
          const found = source.indexOf('<!--', scriptStart);
          nextComment = found < 0 ? Infinity : found;
        }
        if (nextComment < (implied ? source.length : parser.startIndex)) ambiguous = true;
        scriptStart = -1;
      }
      if (PARSE5_OPAQUE.has(name)) opaqueDepth--;
      const index = open.lastIndexOf(name);
      if (index >= 0) open.length = index;
    },
    ontext(text) {
      if ((beforeHead || beforeBody) && !HTML_WHITESPACE_ONLY.test(text)) leaveTrivia();
    },
    onprocessinginstruction(name) {
      if (name !== '!doctype') leaveTrivia();
    },
  }, { decodeEntities: false });
  parser.end(source);

  if (ambiguous) return null;
  for (const key of Object.keys(seen)) if (seen[key] !== written[key]) return null;
  if ((seen.html && htmlEnd === null) || (seen.head && headEnd === null)) return null;
  return { hasBase, headEnd, htmlEnd, policies, reporterAt: bodyEnd ?? source.length };
}

export function previewChannel(query) {
  const value=query?.[PREVIEW_CHANNEL_PARAM];
  return typeof value==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(value)?value:'';
}
