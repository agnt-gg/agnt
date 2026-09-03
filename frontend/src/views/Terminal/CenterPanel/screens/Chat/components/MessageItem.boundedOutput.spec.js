import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import MessageItem from './MessageItem.vue';

/**
 * The reported bug: "there is no cap or expand feature on the tool responses, so
 * if one is a million lines long, it shows all of it — enough to freeze the
 * screen or make us scroll forever."
 *
 * The fix is deliberately narrow: the SAME markup, classes and CSS as before,
 * fed a clipped string, with a bar offering Expand / Copy all / Download.
 * The first half of this file pins the fix; the second half pins the markup,
 * because a previous attempt "simplified" it and silently killed syntax
 * highlighting on every tool card in the app.
 */

const HUGE_LINES = 'line of output\n'.repeat(400000); // ~6 MB, ~400k lines

const makeStore = () =>
  createStore({
    modules: {
      agents: { namespaced: true, state: { agents: [] } },
      chat: { namespaced: true, state: { dataCache: new Map() } },
    },
  });

const mountItem = (props) =>
  mount(MessageItem, { props, global: { plugins: [makeStore()], stubs: { teleport: true } } });

const message = (toolCall) => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'done',
  timestamp: Date.now(),
  toolCalls: [{ id: 'tc-1', name: 'read_file', args: { path: 'big.txt' }, ...toolCall }],
});

const expandedProps = (toolCall) => ({
  message: message(toolCall),
  expandedToolCalls: { 'msg-1': [0] },
});

describe('MessageItem — tool output is capped', () => {
  it('does not render a million-line result into the DOM', () => {
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));
    const rendered = wrapper.find('.result-content').text();
    expect(rendered.length).toBeLessThan(4000);
    expect(rendered).toContain('[clipped for display');
  });

  it('offers Expand, Copy all and Download', () => {
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));
    const labels = wrapper.findAll('.payload-btn').map((b) => b.text());
    expect(labels).toContain('Expand');
    expect(labels).toContain('Copy all');
    expect(labels).toContain('Download');
  });

  it('reports the true size so the user knows what is being withheld', () => {
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));
    const meta = wrapper.findAll('.payload-meta').map((m) => m.text()).join(' ');
    expect(meta).toMatch(/MB/);
    expect(meta).toMatch(/lines/);
  });

  it('shows more after Expand, and is still capped', async () => {
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));
    const before = wrapper.find('.result-content').text().length;

    const expand = wrapper.findAll('.payload-btn').find((b) => b.text() === 'Expand');
    await expand.trigger('click');

    const after = wrapper.find('.result-content').text();
    expect(after.length).toBeGreaterThan(before);
    expect(after.length).toBeLessThan(52000);
    expect(wrapper.findAll('.payload-btn').map((b) => b.text())).toContain('Collapse');
  });

  it('leaves small tool results completely alone — no bar, no clipping', () => {
    const wrapper = mountItem(expandedProps({ result: { ok: true, items: 3 } }));
    expect(wrapper.find('.payload-actions').exists()).toBe(false);
    expect(wrapper.find('.result-content').text()).toContain('"items": 3');
    expect(wrapper.find('.result-content').text()).not.toContain('clipped');
  });

  it('caps the input parameters block too', () => {
    const wrapper = mountItem(expandedProps({ args: { blob: HUGE_LINES }, result: 'ok' }));
    expect(wrapper.find('.params-content').text()).toContain('[clipped for display');
  });
});

describe('MessageItem — the markup is unchanged', () => {
  // MessageItem's highlight pass targets `pre code:not(.hljs)`. If the <code>
  // element or its language class goes away, highlighting silently stops on
  // every tool card — no error, no failing test. Hence these.
  it('keeps pre.params-content > code.language-json', () => {
    const wrapper = mountItem(expandedProps({ result: 'ok' }));
    const code = wrapper.find('pre.params-content > code');
    expect(code.exists()).toBe(true);
    expect(code.classes()).toContain('language-json');
  });

  it('keeps pre.result-content > code.language-json', () => {
    const wrapper = mountItem(expandedProps({ result: { ok: true } }));
    const code = wrapper.find('pre.result-content > code');
    expect(code.exists()).toBe(true);
    expect(code.classes()).toContain('language-json');
  });

  it('keeps pre.error-content > code with no language class, as before', () => {
    const wrapper = mountItem(expandedProps({ result: null, error: 'exploded' }));
    const code = wrapper.find('pre.error-content > code');
    expect(code.exists()).toBe(true);
    expect(code.classes()).not.toContain('language-json');
  });

  it('keeps the historical type size rules', () => {
    // 0.9em on the <pre> and 0.9em again on the <code> = 0.81em effective.
    // The nested one is load-bearing: a bare <code> would inherit the global
    // absolute `code { font-size: var(--font-size-sm) }` (14px) instead.
    const source = readSource();
    expect(source).toMatch(/\.params-content,\s*\n\.result-content,\s*\n\.error-content \{[^}]*font-size: 0\.9em;/);
    expect(source).toMatch(/\.params-content code,\s*\n\.result-content code,\s*\n\.error-content code \{[^}]*font-size: 0\.9em;/);
  });
});

describe('MessageItem — the payload controls read as card chrome', () => {
  const rule = (selector) => {
    const source = readSource();
    const start = source.indexOf(`\n${selector} {`);
    return start === -1 ? null : source.slice(start, source.indexOf('}', start));
  };

  it('puts the controls inside the existing label row, not a bar of their own', () => {
    // Reusing the label row means no extra vertical chrome per tool card, and
    // the controls inherit its typography rather than inventing a second style.
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));
    expect(wrapper.find('.result-label .payload-actions').exists()).toBe(true);
    expect(wrapper.find('.params-label .payload-actions').exists()).toBe(false); // small args
  });

  it('inherits the label typography instead of declaring its own', () => {
    const btn = rule('.payload-btn');
    expect(btn).toMatch(/font: inherit;/);
    expect(btn).toMatch(/color: inherit;/);
    expect(btn).toMatch(/background: none;/);
    expect(btn).toMatch(/border: none;/);
    // The bordered-pill look these replaced matched nothing else in the app.
    expect(btn).not.toMatch(/border-radius/);
    expect(btn).not.toMatch(/font-size/);
  });

  it('stays reachable without a hover pointer', () => {
    // A touch pointer cannot hover, so a hover-revealed control is absent on a
    // phone rather than subtle. Quiet is done with opacity, not visibility.
    const btn = rule('.payload-btn');
    expect(btn).not.toMatch(/opacity: 0;/);
    expect(btn).toMatch(/opacity: 0\.\d/);
  });

  it('keeps every label row the same height, with or without controls', () => {
    // Measured against the built bundle at 1400px: baseline alignment sizes the
    // row by the tallest ascent PLUS deepest descent, so a <button> made the
    // row 14.13px against a plain label's 13.13px. Centring pins both to 13.13.
    const label = rule('.params-label,\n.result-label,\n.error-label');
    expect(label).toMatch(/display: flex;/);
    expect(label).toMatch(/align-items: center;/);
    expect(label).toMatch(/margin-bottom: 6px;/); // unchanged from before
  });

  it('bounds the payload block to a scrollable slice of the viewport', () => {
    // The character cap bounds the STRING; this bounds the BOX. Without it a
    // 50,000-char expanded payload rendered 12,348px tall at 1400x900 — 13.7
    // viewports of chat pushed down. Measured after: 540px, content reachable
    // by scrolling inside the block, whole-page scroll 12,997px -> 1,396px.
    const pre = rule('.params-content,\n.result-content,\n.error-content');
    expect(pre).toMatch(/max-height: 60vh;/);
    expect(pre).toMatch(/overflow: auto;/);
    // A <pre> is content-box by default, so padding would be added on top of
    // the cap and 60vh would render as 66% of the screen.
    expect(pre).toMatch(/box-sizing: border-box;/);
  });

  it('keeps the meta on one line', () => {
    // A wrapped meta string turned the 13px label row into a 40px block.
    expect(rule('.payload-meta')).toMatch(/white-space: nowrap;/);
  });
});

describe('MessageItem — the Copy all button confirms', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const mountWithClipboard = (writeText = vi.fn().mockResolvedValue(undefined)) => {
    Object.assign(navigator, { clipboard: { writeText } });
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));
    return { wrapper, writeText };
  };

  const copyButton = (wrapper) =>
    wrapper.findAll('.payload-btn').find((b) => /Copy all|Copied/.test(b.text()));

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says "Copy all" until it is clicked', () => {
    const { wrapper } = mountWithClipboard();
    expect(copyButton(wrapper).text()).toBe('Copy all');
  });

  it('says "Copied" right after a successful copy', async () => {
    const { wrapper } = mountWithClipboard();
    await copyButton(wrapper).trigger('click');
    await flush();
    expect(copyButton(wrapper).text()).toBe('Copied');
  });

  it('reverts to "Copy all" after the feedback window', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));

    await copyButton(wrapper).trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(copyButton(wrapper).text()).toBe('Copied');

    await vi.advanceTimersByTimeAsync(1500);
    expect(copyButton(wrapper).text()).toBe('Copy all');
  });

  it('does not claim success when the clipboard write fails', async () => {
    // Clipboard writes reject on insecure origins and when permission is denied.
    // Showing "Copied" there would be a lie about data the user needs.
    const { wrapper } = mountWithClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await copyButton(wrapper).trigger('click');
    await flush();
    expect(copyButton(wrapper).text()).toBe('Copy all');
  });

  it('copies the FULL payload, not the clipped view', async () => {
    const { wrapper, writeText } = mountWithClipboard();
    await copyButton(wrapper).trigger('click');
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0].length).toBeGreaterThan(HUGE_LINES.length - 1);
  });

  it('confirms only the button that was clicked', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const wrapper = mountItem(expandedProps({ args: { blob: HUGE_LINES }, result: { content: HUGE_LINES } }));

    const copyButtons = () => wrapper.findAll('.payload-btn').filter((b) => /Copy all|Copied/.test(b.text()));
    expect(copyButtons()).toHaveLength(2);

    await copyButtons()[0].trigger('click');
    await flush();

    expect(copyButtons().map((b) => b.text())).toEqual(['Copied', 'Copy all']);
  });

  it('restarts the window on a second click instead of expiring early', async () => {
    vi.useFakeTimers();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));

    await copyButton(wrapper).trigger('click');
    await vi.advanceTimersByTimeAsync(1400);
    await copyButton(wrapper).trigger('click');
    await vi.advanceTimersByTimeAsync(200); // first timer would have fired here

    expect(copyButton(wrapper).text()).toBe('Copied');
  });

  it('leaves no pending timer behind when unmounted mid-confirmation', async () => {
    // A message can unmount inside the feedback window (scrolled out of a
    // virtualised list, chat cleared). An earlier version of this test only
    // asserted "no console error", which passed even with the cleanup deleted —
    // the leak is observable in the timer queue, so measure that instead.
    vi.useFakeTimers();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const wrapper = mountItem(expandedProps({ result: { content: HUGE_LINES } }));

    // A total-timer count is too noisy here — rendering schedules its own
    // timers. Identify the confirmation timer by its delay and assert that
    // exact handle is cleared.
    const setSpy = vi.spyOn(globalThis, 'setTimeout'); // records, still calls through
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await copyButton(wrapper).trigger('click');
    await vi.advanceTimersByTimeAsync(0);

    const confirmationTimers = setSpy.mock.calls
      .map((args, i) => ({ delay: args[1], id: setSpy.mock.results[i].value }))
      .filter((call) => call.delay === 1500);
    expect(confirmationTimers, 'copy should schedule one confirmation timer').toHaveLength(1);

    wrapper.unmount();
    expect(clearSpy).toHaveBeenCalledWith(confirmationTimers[0].id);

    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});

describe('MessageItem — offloaded DATA_REF payloads', () => {
  const withCache = (dataId, content) => {
    const dataCache = new Map([[dataId, { content, size: content.length, path: 'x' }]]);
    return mountItem({ ...expandedProps({ result: { data: `{{DATA_REF:${dataId}}}` } }), dataCache });
  };

  it('does not re-inflate a multi-megabyte offloaded blob into the view', () => {
    // The backend deliberately ships the FULL offloaded content to the browser,
    // so the display path is the only thing standing between it and the DOM.
    expect(withCache('d1', HUGE_LINES).find('.result-content').text().length).toBeLessThan(4000);
  });

  it('caps each offloaded field for display but not for export', () => {
    const wrapper = withCache('d1', HUGE_LINES);
    const value = { data: '{{DATA_REF:d1}}' };
    const shown = wrapper.vm.serializeToolPayload(value, { full: false });
    const exported = wrapper.vm.serializeToolPayload(value, { full: true });
    expect(shown.length).toBeLessThan(HUGE_LINES.length);
    expect(exported.length).toBeGreaterThan(HUGE_LINES.length - 1);
  });

  it('still shows a placeholder when the blob is not cached', () => {
    const wrapper = mountItem(expandedProps({ result: { data: '{{DATA_REF:missing}}' } }));
    expect(wrapper.find('.result-content').text()).toContain('[Large data - missing]');
  });

  it('leaves small offloaded payloads fully inlined', () => {
    expect(withCache('d1', 'small payload').find('.result-content').text()).toContain('small payload');
  });
});

describe('MessageItem — a card whose arguments have not arrived yet', () => {
  // tool_pending draws the card before the model has finished writing the
  // arguments; tool_start fills them in. Between the two, `args` is undefined.
  it('says the arguments are still being written instead of throwing on expand', () => {
    const wrapper = mountItem(expandedProps({ args: undefined }));
    expect(wrapper.find('.params-content').text()).toContain('Writing arguments');
  });

  it('serialises a missing payload as an empty string, never undefined', () => {
    const wrapper = mountItem(expandedProps({}));
    expect(wrapper.vm.serializeToolPayload(undefined)).toBe('');
  });
});

describe('MessageItem — tool output cannot inject markup', () => {
  it('escapes HTML in a tool result', () => {
    // JSON.stringify does not escape < or >, so the original raw v-html let tool
    // output inject markup. The text rendered is identical either way.
    const wrapper = mountItem(expandedProps({ result: { note: '<img src=x onerror="window.__pwned=1">' } }));
    expect(wrapper.find('.result-content img').exists()).toBe(false);
    expect(wrapper.find('.result-content').text()).toContain('onerror=');
  });

  it('escapes HTML in a tool error', () => {
    const wrapper = mountItem(expandedProps({ result: null, error: '<b>exploded</b>' }));
    expect(wrapper.find('.error-content b').exists()).toBe(false);
    expect(wrapper.find('.error-content').text()).toContain('<b>exploded</b>');
  });
});

function readSource() {
  // vitest cwd is frontend/
  // eslint-disable-next-line global-require
  return require('node:fs').readFileSync(
    'src/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue',
    'utf8',
  );
}
