// Isomorphic URL/CSS handling shared by disk previews and srcdoc previews.
// No filesystem reads, network requests, JavaScript evaluation, or auth changes.
export const PREVIEW_MESSAGE = 'agnt:artifact-preview';
export const PREVIEW_CHANNEL_PARAM = '__agnt_preview';

export function fileURLToPreviewURL(value, prefix = '/api/local-preview/') {
  if (!/^file:\/\//i.test(value || '')) return value;
  try {
    const parsed = new URL(value);
    // Do not turn UNC references into requests for an unrelated local path.
    if (parsed.hostname && parsed.hostname !== 'localhost') return value;
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/(?=[a-z]:\/)/i, '');
    const encoded = pathname.split('/').map((segment, index) =>
      index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)
    ).join('/');
    return prefix + encoded + parsed.search + parsed.hash;
  } catch {
    return value;
  }
}

function quotedEnd(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === quote) return i;
  }
  return -1;
}
function decodeCSS(value) {
  return value.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])/gi, (_, hex, character) => {
    if (!hex) return character;
    const point = parseInt(hex,16);
    return point === 0 || point > 0x10ffff ? '\ufffd' : String.fromCodePoint(point);
  });
}
const cssString = value => '"' + value.replaceAll('\\','\\\\').replaceAll('"','\\"').replace(/[\n\r\f]/g,'') + '"';

/** Rewrite actual CSS URL tokens, never comments or ordinary quoted strings. */
export function rewritePreviewCSS(source, resolve) {
  if (!source || !/file:|local-file/i.test(source)) return source;
  let cursor = 0, result = '', index = 0;
  const replace = (start,end,text) => { result += source.slice(cursor,start) + text; cursor=end; };
  const urlToken = /url\(\s*/giy;
  const importToken = /@import\s+/giy;
  while (index < source.length) {
    if (source.startsWith('/*',index)) {
      const end=source.indexOf('*/',index+2); index=end<0?source.length:end+2; continue;
    }
    if (source[index] === '"' || source[index] === "'") {
      const end=quotedEnd(source,index); index=end<0?source.length:end+1; continue;
    }
    urlToken.lastIndex = index;
    const url = urlToken.exec(source);
    if (url && (index===0 || !/[\w-]/.test(source[index-1]))) {
      const start=index; let contentStart=index+url[0].length; let end, close, value;
      if (/['"]/.test(source[contentStart] || '\0')) {
        end=quotedEnd(source,contentStart);
        if(end<0)break;
        value=source.slice(contentStart+1,end); close=end+1;
      } else {
        end=contentStart;
        while(end<source.length && source[end]!==')') { if(source[end]==='\\')end++; end++; }
        value=source.slice(contentStart,end).trim(); close=end;
      }
      while(/\s/.test(source[close] || '\0'))close++;
      if(source[close]===')') {
        const decoded=decodeCSS(value); const rewritten=resolve(decoded);
        if(rewritten!==decoded)replace(start,close+1,`url(${cssString(rewritten)})`);
        index=close+1; continue;
      }
      index=end+1; continue;
    }
    importToken.lastIndex = index;
    const imported = importToken.exec(source);
    if(imported) {
      const start=index+imported[0].length;
      if(source[start]==='"'||source[start]==="'") {
        const end=quotedEnd(source,start);if(end<0)break;
        const value=decodeCSS(source.slice(start+1,end)), rewritten=resolve(value);
        if(rewritten!==value)replace(start,end+1,cssString(rewritten));
        index=end+1;continue;
      }
    }
    index++;
  }
  return result + source.slice(cursor);
}
