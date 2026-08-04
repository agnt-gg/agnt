/**
 * The capture background color the client hands to the backend.
 *
 * A widget that declares `html,body{background:transparent}` renders correctly
 * in the live preview (the iframe shows the app behind it) but captures over
 * Chrome's default WHITE, because the injected capture stylesheet lands first
 * in <head> and loses the cascade to the widget's own rule. The backend now
 * applies this color at the compositor, so the value here must always be a
 * SOLID color — never 'transparent'.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveCaptureBgColor } from './widgetThumbnail.js';

/** Stub getComputedStyle with a fixed set of custom properties. */
function stubTheme({ root = {}, body = {} }) {
  vi.stubGlobal('getComputedStyle', (el) => {
    const vars = el === document.body ? body : root;
    return { getPropertyValue: (prop) => vars[prop] ?? '' };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveCaptureBgColor', () => {
  it('uses --color-background when it is solid', () => {
    stubTheme({ root: { '--color-background': '#0c0c18' } });
    expect(resolveCaptureBgColor()).toBe('#0c0c18');
  });

  it('prefers the body-scoped value over :root (theme overrides live on body)', () => {
    stubTheme({ root: { '--color-background': '#0c0c18' }, body: { '--color-background': '#ffffff' } });
    expect(resolveCaptureBgColor()).toBe('#ffffff');
  });

  it('falls back to the RGB triplet when custom backgrounds make it transparent', () => {
    stubTheme({ root: { '--color-background': 'transparent', '--color-background-rgb': '12,12,24' } });
    expect(resolveCaptureBgColor()).toBe('rgb(12,12,24)');
  });

  it('falls back to the RGB triplet for a fully transparent rgba()', () => {
    stubTheme({ root: { '--color-background': 'rgba(0,0,0,0)', '--color-background-rgb': '20,20,30' } });
    expect(resolveCaptureBgColor()).toBe('rgb(20,20,30)');
  });

  it('never returns a transparent value, even with no theme at all', () => {
    stubTheme({});
    const color = resolveCaptureBgColor();
    expect(color).toBe('#0c0c18');
    expect(color).not.toMatch(/transparent/);
  });

  it('trims whitespace from computed custom properties', () => {
    stubTheme({ root: { '--color-background': '  #101020  ' } });
    expect(resolveCaptureBgColor()).toBe('#101020');
  });
});
