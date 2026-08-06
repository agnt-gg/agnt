/**
 * SUBRESOURCE vs NAVIGATION.
 *
 * THE BUG: a link to a file on disk was rewritten to
 * http://localhost:3333/api/local-file/<path> exactly like an <img> src, then
 * opened in the user's real browser (every anchor here is target=_blank, and
 * Electron sends those to shell.openExternal). That browser holds no AGNT
 * session, so the endpoint answered 401 "Authentication required" — measured
 * live against the running backend — and the user's own file never opened.
 *
 * Both directions are pinned: anchors must survive intact when the host
 * intercepts clicks, and every real subresource must still be rewritten,
 * because THAT rewrite is the only thing that can work (an <img> cannot carry
 * an Authorization header; the media cookie is its only credential).
 */

import { describe, it, expect } from 'vitest';
import {
  rewriteLocalFileURLsInHTML,
  fileUrlToLocalFileUrl,
  fileUrlToPath,
  absolutePathFromFileUrl,
  buildLocalFileUrl,
  LOCAL_PATH_ATTR,
} from './localFileUrl.js';
import { renderMarkdown } from './markdownPipeline.js';

const WIN = 'file:///C:/Users/Studio/AppData/Roaming/AGNT/projects/report.html';

describe('absolutePathFromFileUrl', () => {
  it('gives back a path the OS can actually open', () => {
    expect(absolutePathFromFileUrl(WIN)).toBe('C:/Users/Studio/AppData/Roaming/AGNT/projects/report.html');
    // THE POSIX TRAP: the URL form drops the root (LocalFileRoutes.js re-adds
    // it), so anything handing this to shell.openPath must put it back or the
    // path resolves against the process cwd.
    expect(absolutePathFromFileUrl('file:///home/nathan/report.html')).toBe('/home/nathan/report.html');
    expect(fileUrlToPath('file:///home/nathan/report.html')).toBe('home/nathan/report.html');
  });

  it('keeps the host of a UNC path, which is part of the path', () => {
    expect(absolutePathFromFileUrl('file://server/share/report.html')).toBe('//server/share/report.html');
  });

  it('decodes percent-escapes so spaces survive', () => {
    expect(absolutePathFromFileUrl('file:///C:/My%20Files/a%20b.html')).toBe('C:/My Files/a b.html');
  });

  it('is empty for anything that is not a file URL', () => {
    for (const v of ['https://agnt.gg', '/relative/path', '', null, undefined]) {
      expect(absolutePathFromFileUrl(v)).toBe('');
    }
  });
});

describe('rewriteLocalFileURLsInHTML — subresources', () => {
  it('rewrites src, poster and non-anchor href regardless of the option', () => {
    for (const intercepts of [false, true]) {
      const out = rewriteLocalFileURLsInHTML(
        `<img src="${WIN}"><video src="${WIN}" poster="${WIN}"></video><link rel="stylesheet" href="file:///C:/x/a.css">`,
        { interceptsLinkClicks: intercepts }
      );
      expect(out, `src must be rewritten (intercepts=${intercepts})`).not.toMatch(/src="file:/);
      expect(out, `poster must be rewritten (intercepts=${intercepts})`).not.toMatch(/poster="file:/);
      // <link> is a SUBRESOURCE that happens to use href. Treating "href" as
      // navigational would leave a stylesheet the renderer cannot load.
      expect(out, `<link href> must be rewritten (intercepts=${intercepts})`).not.toMatch(/href="file:/);
      expect(out).toMatch(/\/local-file\/C:\/x\/a\.css/);
    }
  });
});

describe('rewriteLocalFileURLsInHTML — anchors', () => {
  it('leaves the true file:// href alone when the host intercepts clicks', () => {
    const out = rewriteLocalFileURLsInHTML(`<a href="${WIN}">Open</a>`, { interceptsLinkClicks: true });
    expect(out).toContain(`href="${WIN}"`);
    // Scoped to the anchor: an injected <base> legitimately carries a
    // /api/local-file/ URL, and a whole-string assertion measured that instead.
    const anchor = /<a [^>]*>/.exec(out)[0];
    expect(anchor, 'the localhost URL is exactly what 401s in an external browser').not.toContain('/api/local-file/');
    expect(anchor).toContain(`${LOCAL_PATH_ATTR}="C:/Users/Studio/AppData/Roaming/AGNT/projects/report.html"`);
  });

  it('still rewrites anchors for hosts that CANNOT intercept (srcdoc, widgets)', () => {
    // Inside an iframe no handler of ours ever runs, and a file:// navigation
    // from an http origin is blocked outright. There the rewritten URL is the
    // only thing that loads — it is same-origin, so the media cookie applies.
    const out = rewriteLocalFileURLsInHTML(`<a href="${WIN}">Open</a>`);
    expect(out).toContain('/local-file/C:/Users/Studio/AppData/Roaming/AGNT/projects/report.html');
    expect(out).not.toContain(`href="${WIN}"`);
    expect(out).not.toContain(LOCAL_PATH_ATTR);
  });

  it('leaves anchors that are not local files completely untouched', () => {
    const html = '<a href="https://agnt.gg/docs">docs</a><a href="#anchor">jump</a>';
    expect(rewriteLocalFileURLsInHTML(html, { interceptsLinkClicks: true })).toBe(html);
  });

  it('an anchor still supplies the base dir for sibling assets', () => {
    // The base-dir scan used to run inside the rewrite branch. Skipping the
    // rewrite must not silently cost a message its <base>.
    const out = rewriteLocalFileURLsInHTML(`<html><head></head><body><a href="${WIN}">Open</a><img src="chart.png"></body></html>`, {
      interceptsLinkClicks: true,
    });
    expect(out).toMatch(/<base href="[^"]*\/local-file\/C:\/Users\/Studio\/AppData\/Roaming\/AGNT\/projects\/"/);
  });
});

describe('the whole chat pipeline', () => {
  it('carries a markdown link to a local file through as a file:// href', () => {
    // If marked or the rewrite mangled this, the click handler would never see
    // a path and the fix would be silently dead in the one place it matters.
    const html = renderMarkdown(`[Open the report](${WIN})`);
    const out = rewriteLocalFileURLsInHTML(html, { interceptsLinkClicks: true });
    expect(out).toContain(`href="${WIN}"`);
    expect(out).toContain(LOCAL_PATH_ATTR);
  });
});

describe('URL builders agree with the backend', () => {
  it('round-trips a windows path', () => {
    expect(fileUrlToLocalFileUrl(WIN)).toBe(buildLocalFileUrl('C:/Users/Studio/AppData/Roaming/AGNT/projects/report.html'));
  });
});
