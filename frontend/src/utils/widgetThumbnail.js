/**
 * Widget Thumbnail Capture Utility
 *
 * Sends widget HTML to the backend which uses Puppeteer (headless Chrome)
 * to render a pixel-perfect screenshot. The HTML preparation logic is
 * identical to CustomWidgetRenderer.vue's renderedSource — so the capture
 * looks EXACTLY like the live preview the user sees.
 */

import { API_CONFIG } from '@/tt.config.js';

/**
 * Build the theme style tag — EXACT same logic as CustomWidgetRenderer.buildThemeStyleTag()
 */
function buildThemeStyleTag() {
  const vars = [];
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];
              if (prop.startsWith('--')) {
                vars.push(prop);
              }
            }
          }
        }
      } catch (_) {}
    }
  } catch (_) {}

  const uniqueVars = [...new Set(vars)];
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);

  const lines = uniqueVars
    .map((prop) => {
      const val = bodyStyle.getPropertyValue(prop).trim() || rootStyle.getPropertyValue(prop).trim();
      return val ? `  ${prop}: ${val};` : null;
    })
    .filter(Boolean);

  return `<style id="agnt-theme">\n:root {\n${lines.join('\n')}\n}\n</style>`;
}

// EXACT same as CustomWidgetRenderer line 136
const noScrollbarCSS =
  '<style>html,body{scrollbar-width:none;-ms-overflow-style:none;}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;}</style>';

/**
 * Build the final HTML — EXACT same logic as CustomWidgetRenderer.renderedSource (lines 138-150).
 * This ensures the Puppeteer capture looks identical to the live preview.
 */
function buildRenderedSource(sourceCode) {
  const html = sourceCode || '';
  const theme = buildThemeStyleTag();

  if (html.trim().toLowerCase().startsWith('<!doctype') || html.trim().toLowerCase().startsWith('<html')) {
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${theme}${noScrollbarCSS}`);
    }
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${theme}${noScrollbarCSS}</head>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${theme}<style>html,body{scrollbar-width:none;-ms-overflow-style:none;}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;}</style></head><body>${html}</body></html>`;
}

/**
 * Build rendered HTML for markdown — mirrors CustomWidgetRenderer's renderedMarkdown + wrapping
 */
function buildRenderedMarkdown(sourceCode) {
  const md = sourceCode || '';
  const rendered = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');

  const theme = buildThemeStyleTag();
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${theme}<style>
    html,body{scrollbar-width:none;-ms-overflow-style:none;}
    html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;}
    body{padding:12px;font-size:13px;color:var(--color-light-0,#c8c8d4);line-height:1.6;font-family:inherit;background:var(--color-background,#0c0c18);}
    h1{font-size:18px;color:var(--color-green);margin-bottom:8px;}
    h2{font-size:15px;color:var(--color-green);margin-bottom:6px;}
    h3{font-size:13px;color:var(--color-green);margin-bottom:4px;}
    code{background:rgba(255,255,255,0.05);padding:1px 4px;border-radius:3px;font-size:12px;}
    strong{color:var(--color-light-0,#eee);}
  </style></head><body>${rendered}</body></html>`;
}

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

/**
 * Capture a thumbnail screenshot of a widget.
 *
 * Builds the EXACT same HTML as CustomWidgetRenderer (so the capture matches
 * the live preview), then sends it to the backend which renders it in headless
 * Chrome via Puppeteer and returns a pixel-perfect JPEG screenshot.
 *
 * @param {string} sourceCode - The widget's source HTML/markdown
 * @param {string} widgetType - 'html', 'markdown', 'template', 'iframe'
 * @returns {Promise<string|null>} Base64 JPEG data URL, or null on failure
 */
export async function captureWidgetThumbnail(sourceCode, widgetType) {
  if (!sourceCode || (widgetType !== 'html' && widgetType !== 'markdown')) {
    return null;
  }

  // Build the SAME HTML that CustomWidgetRenderer renders in the live preview
  const html = widgetType === 'markdown' ? buildRenderedMarkdown(sourceCode) : buildRenderedSource(sourceCode);

  if (!html) return null;

  try {
    // Send ALL of localStorage so Puppeteer can replicate the exact browser state.
    // Widgets read arbitrary keys (auth token, theme, map data, settings, etc.)
    const storageData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      storageData[key] = localStorage.getItem(key);
    }

    const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions/capture-thumbnail`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ html, storageData }),
    });

    if (!response.ok) {
      console.warn('[widgetThumbnail] Server capture failed:', response.status);
      return null;
    }

    const data = await response.json();
    return data.thumbnail || null;
  } catch (err) {
    console.warn('[widgetThumbnail] Capture failed:', err);
    return null;
  }
}
