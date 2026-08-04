/**
 * Capture background resolution.
 *
 * ROOT CAUSE PINNED (2026-08-04): widgets normally declare
 * `html,body{background:transparent}` so the LIVE preview shows the app
 * background through the iframe. The client also injects
 * `html,body{background-color:<theme>}` — but that lands FIRST inside <head>,
 * so at equal specificity the widget's own later rule wins and the page is
 * genuinely transparent. An iframe composites that over the app; a screenshot
 * has nothing behind it, so Chrome paints its default WHITE and a dark-theme
 * widget captures as washed-out grey (measured avg rgb(215,215,217) on
 * "PTCG Arena Lab"; rgb(20,20,31) once composited correctly).
 *
 * The fix sets the COMPOSITOR's default background color, which no widget CSS
 * can override. These tests cover the color parsing and the resolution order.
 */
import { describe, it, expect } from 'vitest';
import { parseCssColorToRgba, resolveCaptureBackground } from './WidgetDefinitionService.js';

describe('parseCssColorToRgba', () => {
  it('parses 6-digit hex', () => {
    expect(parseCssColorToRgba('#0c0c18')).toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });

  it('parses shorthand hex', () => {
    expect(parseCssColorToRgba('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
  });

  it('parses 8-digit hex with alpha', () => {
    const c = parseCssColorToRgba('#0c0c18ff');
    expect(c).toMatchObject({ r: 12, g: 12, b: 24 });
    expect(c.a).toBeCloseTo(1);
  });

  it('parses rgb() and rgba(), comma or space separated', () => {
    expect(parseCssColorToRgba('rgb(12, 12, 24)')).toEqual({ r: 12, g: 12, b: 24, a: 1 });
    expect(parseCssColorToRgba('rgba(12,12,24,0.5)')).toEqual({ r: 12, g: 12, b: 24, a: 0.5 });
    expect(parseCssColorToRgba('rgb(12 12 24 / 0.5)')).toEqual({ r: 12, g: 12, b: 24, a: 0.5 });
  });

  it('parses a bare r,g,b triplet (the --color-background-rgb form)', () => {
    expect(parseCssColorToRgba('12,12,24')).toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });

  it('is case and whitespace insensitive', () => {
    expect(parseCssColorToRgba('  #0C0C18  ')).toEqual({ r: 12, g: 12, b: 24, a: 1 });
    expect(parseCssColorToRgba('RGB(12,12,24)')).toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });

  it('clamps out-of-range channels instead of emitting garbage to CDP', () => {
    expect(parseCssColorToRgba('rgb(300,-20,24)')).toEqual({ r: 255, g: 0, b: 24, a: 1 });
    expect(parseCssColorToRgba('rgba(12,12,24,5)')).toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });

  it('REJECTS transparent — handing that to the compositor is the bug itself', () => {
    expect(parseCssColorToRgba('transparent')).toBeNull();
    expect(parseCssColorToRgba('rgba(0,0,0,0)')).toBeNull();
    expect(parseCssColorToRgba('#00000000')).toBeNull();
  });

  it('rejects unparseable, empty and non-string input', () => {
    for (const bad of ['', '   ', 'none', 'initial', 'inherit', 'papayawhip', '#12345', 'rgb(1,2)', 'var(--x)', null, undefined, 42, {}]) {
      expect(parseCssColorToRgba(bad)).toBeNull();
    }
  });
});

describe('resolveCaptureBackground', () => {
  const injected = (color) => `<html><head><style>html,body{background-color:${color};}</style></head><body></body></html>`;

  it('prefers the explicit color sent by the client', () => {
    expect(resolveCaptureBackground({ backgroundColor: '#101020', html: injected('#0c0c18') }))
      .toEqual({ r: 16, g: 16, b: 32, a: 1 });
  });

  it('falls back to the injected capture CSS when no explicit color is sent', () => {
    expect(resolveCaptureBackground({ html: injected('rgb(12,12,24)') }))
      .toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });

  it('falls back to the injected CSS when the explicit color is unusable', () => {
    expect(resolveCaptureBackground({ backgroundColor: 'transparent', html: injected('#0c0c18') }))
      .toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });

  it('tolerates whitespace in the injected rule', () => {
    const html = '<style> html , body { background-color : #0c0c18 ; } </style>';
    expect(resolveCaptureBackground({ html })).toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });

  it('ignores an unrelated background-color elsewhere in the document', () => {
    const html = '<style>.card{background-color:#ff0000;}</style>';
    expect(resolveCaptureBackground({ html })).toBeNull();
  });

  it('returns null when there is nothing to go on (caller then keeps Chrome default)', () => {
    expect(resolveCaptureBackground({})).toBeNull();
    expect(resolveCaptureBackground()).toBeNull();
    expect(resolveCaptureBackground({ html: '<html><body>hi</body></html>' })).toBeNull();
  });

  it('resolves a real widget that declares its own transparent background', () => {
    // This is the exact shape that produced the grey capture: injected theme
    // background FIRST, widget's own transparent rule SECOND (and winning).
    const html = [
      '<!DOCTYPE html><html><head>',
      '<style>html,body{background-color:#0c0c18;}</style>',
      '<style>html,body{margin:0;background:transparent;color:var(--color-text);}</style>',
      '</head><body><div>PTCG Arena Lab</div></body></html>',
    ].join('');
    expect(resolveCaptureBackground({ backgroundColor: '#0c0c18', html }))
      .toEqual({ r: 12, g: 12, b: 24, a: 1 });
  });
});
