import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { themeVariables, _resetThemeVariables } from './themeVariables.js';

let style;
beforeEach(() => {
  _resetThemeVariables();
  style = document.createElement('style');
  style.textContent = ':root { --color-pink: #e53d8f; --space: 8px; } .x { color: red; }';
  document.head.appendChild(style);
});
afterEach(() => {
  style.remove();
  document.body.className = '';
});

describe('the theme variables iframes get', () => {
  it('lists every custom property with its live value', () => {
    expect(themeVariables('dark')).toEqual(expect.arrayContaining([['--color-pink', '#e53d8f'], ['--space', '8px']]));
    expect(themeVariables('dark').some(([name]) => name === 'color')).toBe(false);
  });

  it('reads the stylesheets once, until the theme or the page changes', () => {
    const first = themeVariables('dark');
    expect(themeVariables('dark')).toBe(first);
    expect(themeVariables('light')).not.toBe(first);
    const light = themeVariables('light');
    document.body.className = 'theme-custom';
    expect(themeVariables('light')).not.toBe(light);
    const custom = themeVariables('light');
    const more = document.createElement('style');
    more.textContent = ':root { --added: 1px; }';
    document.head.appendChild(more);
    expect(themeVariables('light')).not.toBe(custom);
    expect(themeVariables('light')).toEqual(expect.arrayContaining([['--added', '1px']]));
    more.remove();
  });
});
