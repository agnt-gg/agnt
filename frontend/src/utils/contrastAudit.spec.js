/**
 * The runtime auditor is the only layer that can see COMPOSITIONAL contrast
 * failures — text styled by one component sitting on a background painted by
 * another. These tests pin the two behaviours that make it worth having:
 *
 *   1. it climbs to the real backdrop rather than reading the element's own
 *      (usually transparent) background;
 *   2. it refuses to judge text over an image or gradient, instead of
 *      inventing a ratio. A guard that cries wolf gets switched off.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { auditContrast } from './contrastAudit.js';

/** jsdom has no layout, so getBoundingClientRect is all zeros. */
function giveLayout(el, w = 120, h = 20) {
  el.getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h });
  for (const child of el.querySelectorAll('*')) {
    child.getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h });
  }
}

const mount = (html, bodyBg = 'rgb(252, 252, 252)') => {
  document.body.style.backgroundColor = bodyBg;
  document.body.innerHTML = html;
  giveLayout(document.body);
  return document.body;
};

describe('contrastAudit', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('flags white text on a light backdrop inherited from an ancestor', () => {
    // The element itself has no background — exactly the Workspace palette shape.
    mount('<div style="background-color: rgb(252,252,252)">'
      + '<span id="bad" style="color: rgb(255,255,255)">invisible row label</span>'
      + '</div>');
    const found = auditContrast({ quiet: true });
    expect(found.map((f) => f.path).join(' ')).toMatch(/span#bad/);
    expect(found[0].ratio).toBeLessThan(1.2);
  });

  it('passes dark text on the same backdrop', () => {
    mount('<div style="background-color: rgb(252,252,252)">'
      + '<span id="ok" style="color: rgb(74,74,96)">readable row label</span>'
      + '</div>');
    expect(auditContrast({ quiet: true })).toHaveLength(0);
  });

  it('uses the nearest OPAQUE ancestor, not the immediate parent', () => {
    // The parent is transparent; the grandparent is the real (dark) backdrop,
    // so white text here is correct and must NOT be reported.
    mount('<div style="background-color: rgb(7,7,16)">'
      + '<div style="background-color: transparent">'
      + '<span id="scrim" style="color: rgb(255,255,255)">text on a dark panel</span>'
      + '</div></div>');
    expect(auditContrast({ quiet: true })).toHaveLength(0);
  });

  it('refuses to judge text sitting on a background image or gradient', () => {
    // Marketplace's card art is a gradient: its luminance is unknowable from
    // computed style, so reporting a ratio would be a fabricated number.
    mount('<div style="background-image: linear-gradient(#000, #fff)">'
      + '<span id="art" style="color: rgb(255,255,255)">text on art</span>'
      + '</div>');
    expect(auditContrast({ quiet: true })).toHaveLength(0);
  });

  it('ignores elements with no text of their own', () => {
    mount('<div id="wrap" style="color: rgb(255,255,255)">'
      + '<span id="inner" style="color: rgb(74,74,96)">only this node owns text</span>'
      + '</div>');
    const paths = auditContrast({ quiet: true }).map((f) => f.path);
    expect(paths.some((p) => /div#wrap$/.test(p))).toBe(false);
  });

  it('honours a stricter threshold', () => {
    // ~3.9:1 — fine at the default 3.0 gate, reported at the AA gate.
    mount('<div style="background-color: rgb(255,255,255)">'
      + '<span id="mid" style="color: rgb(140,140,140)">borderline</span>'
      + '</div>');
    expect(auditContrast({ quiet: true })).toHaveLength(0);
    expect(auditContrast({ quiet: true, min: 4.5 }).length).toBe(1);
  });

  it('reports one row per distinct element path, not per node', () => {
    // Three sibling rows with identical styling should surface as ONE finding:
    // a palette with 40 invisible rows must not produce 40 console lines.
    mount('<div style="background-color: rgb(252,252,252)">'
      + '<span class="ws-palette-item" style="color:#fff">Workspace chat</span>'
      + '<span class="ws-palette-item" style="color:#fff">Agent roster</span>'
      + '<span class="ws-palette-item" style="color:#fff">Spend ledger</span>'
      + '</div>');
    expect(auditContrast({ quiet: true })).toHaveLength(1);
  });

  it('parses hex colours instead of scraping digits out of them', () => {
    // #8b93a7 read digit-wise gives [8, 93, 7] — a near-black that would be
    // reported as failing when it is actually a legible mid-grey.
    mount('<div style="background-color: #ffffff">'
      + '<span id="hexed" style="color: #4a4a60">dark text written in hex</span>'
      + '</div>');
    expect(auditContrast({ quiet: true })).toHaveLength(0);
  });
});
