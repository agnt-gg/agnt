import {
  API_CONFIG
} from '@/tt.config.js';
import {
  extractMessageArtifacts
} from './messageArtifacts.js';

export const ARTIFACT_LIMIT = 24;
const TEXT_LIMIT = 200_000;
const kinds = {
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  csv: 'csv',
  tsv: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  svg: 'image',
  avif: 'image',
  pdf: 'pdf',
  zip:'archive', '7z':'archive', rar:'archive', tar:'archive', gz:'archive', bz2:'archive', xz:'archive', tgz:'archive',
  doc:'file',docx:'file',xls:'file',xlsx:'file',ppt:'file',pptx:'file',exe:'file',dll:'file',wasm:'file',bin:'file',db:'file',sqlite:'file',woff:'file',woff2:'file',ttf:'file',otf:'file',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio'
};
export function artifactKind(name) {
  return kinds[String(name).split(/[?#]/)[0].split('.').pop().toLowerCase()] || 'text';
}

/** Completed fences and file references only; prose and partially streamed fences stay in the transcript. */
export function collectChatArtifacts(content, messageId = '') {
  if (typeof content !== 'string') return [];
  const files = extractMessageArtifacts(content).map(file => ({
    ...file,
    id: `file:${file.href}`,
    kind: artifactKind(file.name),
    messageId
  }));
  const items = [...files];
  for (const match of content.matchAll(/^(`{3,}|~{3,})([\w+-]*)[^\n]*\n([\s\S]*?)^\1\s*$/gm)) {
    if (items.length >= ARTIFACT_LIMIT) break;
    const language = match[2].toLowerCase();
    if (!['html', 'markdown', 'md', 'csv', 'json', 'javascript', 'js', 'typescript', 'ts', 'python', 'py', 'css', 'mermaid', 'chartjs', 'd3', 'threejs'].includes(language)) continue;
    // A paired file remains authoritative; do not duplicate its HTML as a separate unsaved output.
    if (language === 'html' && files.some(file => file.kind === 'html')) continue;
    const kind = ['md', 'markdown'].includes(language) ? 'markdown' : ['html', 'csv'].includes(language) ? language : 'text';
    items.push({
      id: `block:${messageId}:${match.index}`,
      name: `${language === 'html' ? 'HTML preview' : language === 'csv' ? 'Table' : language.toUpperCase() + ' document'}`,
      kind,
      language,
      source: match[3].slice(0, TEXT_LIMIT),
      truncated: match[3].length > TEXT_LIMIT,
      messageId
    });
  }
  for (const hit of content.matchAll(/{{IMAGE_REF:([^}]+)}}/g)) {
    const id = hit[1];
    if (!items.some(i => i.id === 'image:' + id)) items.push({
      id: 'image:' + id,
      name: 'Generated image',
      kind: 'image',
      url: API_CONFIG.BASE_URL + '/images/' + encodeURIComponent(id),
      messageId
    });
  }
  return items.slice(0, ARTIFACT_LIMIT);
}

/** Bounded RFC4180-style parser. Values render as text, never executable spreadsheet formulas. */
export function parseCsv(text, maxRows = 201, maxColumns = 40) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < Math.min(text.length, TEXT_LIMIT); i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      if (row.length < maxColumns) row.push(cell);
      cell = '';
      if (c !== ',') {
        rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (rows.length >= maxRows) return rows;
      }
    } else cell += c;
  }
  if (cell || row.length) {
    if (row.length < maxColumns) row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Only card-supported complete text fences are removed; charts/3D retain the existing renderer. */
export function compactArtifactText(content) {
  const represented=new Set(collectChatArtifacts(content).map(item=>item.id));
  return content.replace(/^(`{3,}|~{3,})(html|markdown|md|csv|json|javascript|js|typescript|ts|python|py|css)[^\n]*\n([\s\S]*?)^\1\s*$/gm, (block,fence,language,body,offset) => represented.has('block::'+offset) ? '' : block);
}
