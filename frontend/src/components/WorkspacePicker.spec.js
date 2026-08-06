import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import WorkspacePicker from './WorkspacePicker.vue';

const bridge = (overrides = {}) => ({
  chooseDirectory: vi.fn(async () => ({ ok: true, path: '/chosen/folder' })),
  connection: {
    get: vi.fn(async () => ({ activeMode: 'local' })),
    onState: vi.fn(() => () => {}),
  },
  ...overrides,
});

/**
 * Records what v-tooltip was bound to.
 *
 * The real directive is registered globally in main.js and paints through the
 * tooltip engine; asserting on that here would couple this spec to engine
 * internals. What belongs to THIS component is which string it hands over.
 */
const tooltips = new WeakMap();
const recordTooltip = {
  mounted: (el, binding) => tooltips.set(el, binding.value),
  updated: (el, binding) => tooltips.set(el, binding.value),
};

const mountPicker = (props = {}, options = {}) =>
  mount(WorkspacePicker, {
    props: { modelValue: '', defaultPath: '/home/user/agnt-workspace', ...props },
    global: {
      stubs: { SvgIcon: { template: '<span class="svg-icon-stub" />', props: ['name'] } },
      directives: { tooltip: recordTooltip },
    },
    ...options,
  });

afterEach(() => {
  delete window.electron;
});

describe('WorkspacePicker — typing always works', () => {
  it('renders the path field with no Electron bridge at all', () => {
    const wrapper = mountPicker();
    expect(wrapper.find('.wp-input').exists()).toBe(true);
  });

  it('offers no Browse button in a browser, where there is no native dialog', () => {
    const wrapper = mountPicker();
    expect(wrapper.find('.wp-browse').exists()).toBe(false);
  });

  it('still emits what the user types', async () => {
    const wrapper = mountPicker();
    await wrapper.find('.wp-input').setValue('/typed/by/hand');
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['/typed/by/hand']);
  });

  it('submits on enter and cancels on escape', async () => {
    const wrapper = mountPicker();
    await wrapper.find('.wp-input').trigger('keyup.enter');
    await wrapper.find('.wp-input').trigger('keyup.escape');
    expect(wrapper.emitted('submit')).toHaveLength(1);
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});

describe('WorkspacePicker — browsing', () => {
  it('shows Browse when a native dialog is reachable', async () => {
    window.electron = bridge();
    const wrapper = mountPicker();
    await flushPromises();
    expect(wrapper.find('.wp-browse').exists()).toBe(true);
  });

  it('adopts the chosen folder', async () => {
    window.electron = bridge();
    const wrapper = mountPicker();
    await flushPromises();
    await wrapper.find('.wp-browse').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['/chosen/folder']);
    expect(wrapper.emitted('browsed').at(-1)).toEqual(['/chosen/folder']);
  });

  it('opens where the user already is, not at an unrelated corner of the disk', async () => {
    window.electron = bridge();
    const wrapper = mountPicker({ modelValue: '/current/root' });
    await flushPromises();
    await wrapper.find('.wp-browse').trigger('click');
    await flushPromises();
    expect(window.electron.chooseDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '/current/root' }),
    );
  });

  it('falls back to the default path when the field is empty', async () => {
    window.electron = bridge();
    const wrapper = mountPicker({ modelValue: '' });
    await flushPromises();
    await wrapper.find('.wp-browse').trigger('click');
    await flushPromises();
    expect(window.electron.chooseDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '/home/user/agnt-workspace' }),
    );
  });

  it('changes nothing when the user cancels', async () => {
    // Clearing a field because someone changed their mind is its own small
    // betrayal — and it would wipe a path they had already typed.
    window.electron = bridge({ chooseDirectory: vi.fn(async () => ({ ok: false, reason: 'canceled' })) });
    const wrapper = mountPicker({ modelValue: '/kept' });
    await flushPromises();
    await wrapper.find('.wp-browse').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('browsed')).toBeUndefined();
  });

  it('cannot open two dialogs from a double click', async () => {
    /**
     * Both clicks fire in ONE tick, before Vue can patch `disabled` onto the
     * button. Going through two awaited `trigger('click')` calls instead lets
     * the re-render land between them, so `disabled` blocks the second click
     * and the test passes whether or not the re-entry guard exists — which is
     * to say it tests nothing. (Verified: NC10 stayed green until this changed.)
     */
    let release;
    window.electron = bridge({
      chooseDirectory: vi.fn(
        () => new Promise((resolve) => {
          release = () => resolve({ ok: true, path: '/x' });
        }),
      ),
    });
    const wrapper = mountPicker();
    await flushPromises();

    wrapper.vm.onBrowse();
    wrapper.vm.onBrowse();

    expect(window.electron.chooseDirectory).toHaveBeenCalledTimes(1);
    release();
    await flushPromises();
  });

  it('also disables the button while a dialog is open', async () => {
    // Belt and braces, and the only half a user can see.
    let release;
    window.electron = bridge({
      chooseDirectory: vi.fn(
        () => new Promise((resolve) => {
          release = () => resolve({ ok: true, path: '/x' });
        }),
      ),
    });
    const wrapper = mountPicker();
    await flushPromises();
    await wrapper.find('.wp-browse').trigger('click');
    expect(wrapper.find('.wp-browse').attributes('disabled')).toBeDefined();
    release();
    await flushPromises();
    expect(wrapper.find('.wp-browse').attributes('disabled')).toBeUndefined();
  });

  it('re-enables the button after a dialog that failed', async () => {
    window.electron = bridge({
      chooseDirectory: vi.fn(async () => {
        throw new Error('ipc died');
      }),
    });
    const wrapper = mountPicker();
    await flushPromises();
    await wrapper.find('.wp-browse').trigger('click');
    await flushPromises();
    expect(wrapper.find('.wp-browse').attributes('disabled')).toBeUndefined();
  });
});

describe('WorkspacePicker — the remote backend case', () => {
  it('hides Browse and explains which machine the path is on', async () => {
    window.electron = bridge({
      connection: {
        get: vi.fn(async () => ({ activeMode: 'remote', url: 'http://box.local:3333' })),
        onState: vi.fn(() => () => {}),
      },
    });
    const wrapper = mountPicker();
    await flushPromises();
    expect(wrapper.find('.wp-browse').exists()).toBe(false);
    expect(wrapper.find('.wp-hint').text()).toContain('box.local:3333');
    // Not a dead end: the field is right there and still works.
    expect(wrapper.find('.wp-input').attributes('disabled')).toBeUndefined();
    expect(wrapper.findAll('code')).toHaveLength(0);
  });
});

describe('WorkspacePicker — the hint line', () => {
  it('shows the default path once the field holds something else', () => {
    const wrapper = mountPicker({ modelValue: '/somewhere/else' });
    expect(wrapper.find('.wp-hint').text()).toContain('/home/user/agnt-workspace');
  });

  it('does not repeat the default underneath the placeholder showing it', () => {
    // Empty field: the placeholder already displays the default, so printing it
    // again below spends a row and the loudest colour on screen to say nothing.
    const wrapper = mountPicker({ modelValue: '' });
    expect(wrapper.find('.wp-input').attributes('placeholder')).toBe('/home/user/agnt-workspace');
    expect(wrapper.find('.wp-hint').text()).not.toContain('/home/user/agnt-workspace');
  });

  it('shows an error in place of the default, and marks it', () => {
    const wrapper = mountPicker({ error: 'EACCES: permission denied' });
    const hint = wrapper.find('.wp-hint');
    expect(hint.text()).toContain('EACCES');
    expect(hint.classes()).toContain('error');
    expect(hint.text()).not.toContain('/home/user/agnt-workspace');
  });

  it('binds a failure to the field that caused it', () => {
    // A red sentence under an untouched field reads as page-level noise.
    const wrapper = mountPicker({ error: 'nope' });
    expect(wrapper.find('.wp-input').classes()).toContain('invalid');
    expect(wrapper.find('.wp-input').attributes('aria-invalid')).toBe('true');
  });

  it('leaves the field unmarked when there is no error', () => {
    const wrapper = mountPicker();
    expect(wrapper.find('.wp-input').classes()).not.toContain('invalid');
    expect(wrapper.find('.wp-input').attributes('aria-invalid')).toBeUndefined();
  });

  it('never renders a path in a <code> element', () => {
    /**
     * `<code>` is a syntax-highlighting element here. Global rules give it an
     * ABSOLUTE `font-size: var(--font-size-sm)` that ignores the density it
     * sits in, and the highlight.js theme paints every `code` --color-pink. In
     * the sidebar dialog that made the default path the largest text in the
     * box — bigger than the field and the title — and close enough to
     * --color-red to read as a warning. Chrome is not a code block.
     */
    for (const props of [
      { modelValue: '/x' },
      { modelValue: '', defaultPath: '' },
      { error: 'boom' },
    ]) {
      expect(mountPicker(props).findAll('code')).toHaveLength(0);
    }
    expect(mountPicker({ modelValue: '/x' }).find('.wp-path').exists()).toBe(true);
  });

  it('shows the full path on hover, since a long one is clipped by the field', () => {
    // Through v-tooltip, not a native `title`. uiContracts.spec.js bans the
    // latter: it renders the OS tooltip, which is unstyled, slow, and invisible
    // on touch.
    const wrapper = mountPicker({ modelValue: '/very/long/path/to/a/workspace' });
    expect(tooltips.get(wrapper.find('.wp-input').element)).toBe('/very/long/path/to/a/workspace');
  });

  it('falls back to the path it would use when the field is empty', () => {
    const wrapper = mountPicker({ modelValue: '', defaultPath: '/the/default' });
    expect(tooltips.get(wrapper.find('.wp-input').element)).toBe('/the/default');
  });

  it('offers no tooltip when there is no path to show', () => {
    // Blank renders nothing rather than an empty bubble.
    const wrapper = mountPicker({ modelValue: '', defaultPath: '', placeholder: '' });
    expect(tooltips.get(wrapper.find('.wp-input').element)).toBe('');
  });

  it('explains the empty case when there is no default yet', () => {
    expect(mountPicker({ defaultPath: '' }).find('.wp-hint').text()).toContain('default location');
  });

  it('ties the hint to the field for screen readers', () => {
    const wrapper = mountPicker({ inputId: 'wsRoot' });
    expect(wrapper.find('.wp-input').attributes('aria-describedby')).toBe('wsRoot-hint');
    expect(wrapper.find('.wp-hint').attributes('id')).toBe('wsRoot-hint');
  });

  it('labels the field, so two pickers on one page stay distinguishable', () => {
    const wrapper = mountPicker({ inputId: 'wsRoot', label: 'Workspace Folder' });
    expect(wrapper.find('label').attributes('for')).toBe('wsRoot');
    expect(wrapper.find('.wp-input').attributes('id')).toBe('wsRoot');
  });
});

describe('WorkspacePicker — focus', () => {
  it('exposes focus(), because the dialogs that open it focus the path', () => {
    // attachTo is a MOUNT option, not a prop — document.activeElement only
    // moves for an element that is actually in the document.
    const wrapper = mountPicker({}, { attachTo: document.body });
    expect(typeof wrapper.vm.focus).toBe('function');
    wrapper.vm.focus();
    expect(document.activeElement).toBe(wrapper.find('.wp-input').element);
  });
});
