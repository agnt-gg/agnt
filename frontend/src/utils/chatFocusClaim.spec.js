// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { clickKeepsFocus } from './chatFocusClaim.js';

describe('clickKeepsFocus', () => {
  let screen;
  beforeEach(() => {
    // Mirrors the real chat screen: the root is focusable (tabindex=-1), which
    // must NOT make every click inside it count as a focus claim.
    document.body.innerHTML = `
      <div id="screen" tabindex="-1">
        <p id="text">message text</p>
        <div class="browser-live-card" data-keeps-focus>
          <div id="toolbar-gap"></div>
          <canvas id="page" tabindex="0"></canvas>
        </div>
        <canvas id="chart"></canvas>
        <iframe id="preview"></iframe>
        <div id="editor" contenteditable="true"><span id="inside">x</span></div>
        <div id="readonly" contenteditable="false">y</div>
        <button id="btn"><i id="icon"></i></button>
        <textarea id="input"></textarea>
      </div>`;
    screen = document.getElementById('screen');
  });

  const at = (id) => document.getElementById(id);

  it('lets a click on dead space focus the chat input', () => {
    expect(clickKeepsFocus(at('text'))).toBe(false);
    expect(clickKeepsFocus(screen)).toBe(false);
    expect(clickKeepsFocus(at('readonly'))).toBe(false);
  });

  it('keeps focus on the live browser canvas (the regression)', () => {
    expect(clickKeepsFocus(at('page'))).toBe(true);
  });

  it('keeps focus anywhere inside a data-keeps-focus host', () => {
    expect(clickKeepsFocus(at('toolbar-gap'))).toBe(true);
  });

  it('keeps focus on embedded surfaces and editors', () => {
    expect(clickKeepsFocus(at('chart'))).toBe(true);
    expect(clickKeepsFocus(at('preview'))).toBe(true);
    expect(clickKeepsFocus(at('inside'))).toBe(true);
  });

  it('keeps focus on controls, including their children', () => {
    expect(clickKeepsFocus(at('icon'))).toBe(true);
    expect(clickKeepsFocus(at('input'))).toBe(true);
  });

  it('tolerates targets that are not elements', () => {
    expect(clickKeepsFocus(null)).toBe(false);
    expect(clickKeepsFocus(document)).toBe(false);
    expect(clickKeepsFocus(document.createTextNode('t'))).toBe(false);
  });
});
