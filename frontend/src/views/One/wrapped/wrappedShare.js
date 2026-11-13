/**
 * Sharing the year: the post text, the X link, and the summary card as an image.
 * Spend and goal names stay out of anything shared unless the person turns them on.
 */
import { MARK_DOTS } from './wrappedModel.js';

export const SHARE_IMAGE = Object.freeze({ width: 1080, height: 1350 });

const INK = '#070710';
const PINK = '#e53d8f';
const WHITE = '#ffffff';
const FONT = '"League Spartan", sans-serif';
const MONO = '"Fira Code", monospace';

/** The summary's figures that may leave the app, under the person's choice. */
export function shareableFigures(summary, { includePrivate = false } = {}) {
  return {
    year: summary.year,
    streak: summary.streak,
    calls: summary.calls,
    topModel: summary.topModel,
    built: summary.built,
    modelCount: summary.modelCount,
    persona: summary.persona,
    topGoal: includePrivate ? summary.topGoal : null,
    saved: includePrivate ? summary.saved : null,
  };
}

export function shareText(summary, options) {
  const f = shareableFigures(summary, options);
  const facts = [`${f.streak}-day streak`, `${f.calls} model calls`];
  if (f.topModel) facts.push(`#1 model: ${f.topModel}`);
  if (f.built) facts.push(`${f.built.count} ${f.built.kind} built`);
  if (f.saved) facts.push(`${f.saved} saved by caching`);
  const persona = f.persona ? ` I'm The ${f.persona}.` : '';
  return `My ${f.year} in @agnt_gg: ${facts.join(' · ')}.${persona} agnt.gg`;
}

export const shareIntentUrl = (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;

/** The lines of `text` that fit `maxWidth`, at most `maxLines`; a cut last line ends in an ellipsis. */
export function wrapLines(measure, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next) <= maxWidth) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

function glow(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(7, 7, 16, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SHARE_IMAGE.width, SHARE_IMAGE.height);
}

function label(ctx, text, x, y) {
  ctx.save();
  ctx.font = `500 26px ${MONO}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.restore();
}

/** Shrinks the font until `text` fits `maxWidth`, down to `minSize`. */
function fitFont(ctx, weight, family, size, minSize, text, maxWidth) {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > minSize && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

/** Draws the summary card, 1080×1350, from figures already filtered by shareableFigures. */
export function drawShareCard(ctx, f) {
  const { width: W, height: H } = SHARE_IMAGE;
  const P = 96;
  const inner = W - P * 2;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W * 0.86, 0, 900, 'rgba(229, 61, 143, 0.55)');
  glow(ctx, 0, H, 820, 'rgba(209, 61, 229, 0.3)');
  ctx.textBaseline = 'alphabetic';

  const s = 2.4;
  ctx.fillStyle = PINK;
  for (const [cx, cy] of MARK_DOTS) {
    ctx.beginPath();
    ctx.arc(P + cx * s, P + cy * s, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  label(ctx, `${f.year} Wrapped`, P + 37 * s + 30, P + 18 * s + 9);

  ctx.fillStyle = WHITE;
  ctx.font = `900 132px ${FONT}`;
  ctx.fillText(`My ${f.year}`, P, 382);
  ctx.fillText('in AGNT', P, 508);

  let y = 640;
  const pair = (left, right) => {
    ctx.fillStyle = WHITE;
    ctx.font = `800 96px ${FONT}`;
    ctx.fillText(left.value, P, y);
    if (right) ctx.fillText(right.value, W / 2 + 12, y);
    label(ctx, left.label, P, y + 48);
    if (right) label(ctx, right.label, W / 2 + 12, y + 48);
    y += 168;
  };
  pair({ value: f.streak, label: 'day streak' }, { value: f.calls, label: 'model calls' });

  if (f.topModel) {
    label(ctx, '#1 model', P, y);
    ctx.fillStyle = WHITE;
    fitFont(ctx, 600, MONO, 54, 30, f.topModel, inner);
    ctx.fillText(f.topModel, P, y + 66);
    y += 128;
  }
  if (f.topGoal) {
    label(ctx, 'Most-run goal', P, y);
    ctx.fillStyle = WHITE;
    ctx.font = `700 48px ${FONT}`;
    const lines = wrapLines((t) => ctx.measureText(t).width, f.topGoal, inner, 2);
    lines.forEach((line, i) => ctx.fillText(line, P, y + 62 + i * 54));
    y += 86 + lines.length * 54;
  }
  const builtFigure = f.built ? { value: f.built.count, label: `${f.built.kind} built` } : { value: f.modelCount, label: 'models tried' };
  const fourth = f.saved ? { value: f.saved, label: 'saved by caching' } : f.built ? { value: f.modelCount, label: 'models tried' } : null;
  pair(builtFigure, fourth);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fillRect(P, H - P - 72, inner, 2);
  ctx.fillStyle = WHITE;
  ctx.font = `700 42px ${FONT}`;
  if (f.persona) ctx.fillText(`The ${f.persona}`, P, H - P);
  ctx.font = `500 32px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText('agnt.gg', W - P, H - P);
  ctx.textAlign = 'left';
}

async function fontsReady(doc) {
  if (!doc.fonts?.load) return;
  await Promise.allSettled([`900 132px ${FONT}`, `800 96px ${FONT}`, `700 48px ${FONT}`, `500 26px ${MONO}`, `600 54px ${MONO}`].map((font) => doc.fonts.load(font)));
}

export async function shareImageBlob(summary, options, doc = document) {
  const canvas = doc.createElement('canvas');
  canvas.width = SHARE_IMAGE.width;
  canvas.height = SHARE_IMAGE.height;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) throw new Error('This device cannot draw the image.');
  await fontsReady(doc);
  drawShareCard(ctx, shareableFigures(summary, options));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be made.'))), 'image/png');
  });
}

/** Saves the image through the browser's downloads; returns the file name. */
export async function saveShareImage(summary, options, doc = document) {
  const blob = await shareImageBlob(summary, options, doc);
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = `agnt-${summary.year}-wrapped.png`;
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  doc.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return link.download;
}

export async function copyShareImage(summary, options, doc = document) {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.write || typeof globalThis.ClipboardItem !== 'function') throw new Error('Copying images is not available here. Save it instead.');
  const blob = await shareImageBlob(summary, options, doc);
  await clipboard.write([new globalThis.ClipboardItem({ 'image/png': blob })]);
}
