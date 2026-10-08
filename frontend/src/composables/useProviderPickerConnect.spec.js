/**
 * Connecting a provider from a picker runs the Connectors page's flow, then
 * selects it in the picker's own scope — and only when that is still what the
 * user wants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProviderPickerConnect } from './useProviderPickerConnect.js';

const connection = vi.hoisted(() => ({
  connected: new Set(),
  handleProviderToggle: null,
}));

vi.mock('@/composables/useProviderConnection.js', () => ({
  useProviderConnection: () => ({
    isProviderConnected: (id) => connection.connected.has(id),
    handleProviderToggle: (id) => connection.handleProviderToggle(id),
  }),
}));

const CURSOR = { label: 'Cursor', value: 'Cursor', connect: true };

function picker({ selection = 'OpenAI' } = {}) {
  const state = { selection };
  const select = vi.fn();
  const { connectFromPicker } = useProviderPickerConnect({ value: null }, {
    select,
    currentSelection: () => state.selection,
  });
  return { connectFromPicker, select, state };
}

beforeEach(() => {
  connection.connected = new Set();
  // Default: the Connectors flow finishes and the provider is connected.
  connection.handleProviderToggle = vi.fn(async (id) => { connection.connected.add(id); });
});

describe('useProviderPickerConnect', () => {
  it('connects through the Connectors flow by connection id, then selects the clicked option', async () => {
    const { connectFromPicker, select } = picker();
    await connectFromPicker(CURSOR);

    // 'Cursor' is the store name; the connection is 'cursor-cli'.
    expect(connection.handleProviderToggle).toHaveBeenCalledWith('cursor-cli');
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({ label: 'Cursor', value: 'Cursor', connect: false });
  });

  it('never hands an already-connected provider to the toggle, which would disconnect it', async () => {
    connection.connected.add('zai');
    const { connectFromPicker, select } = picker();
    await connectFromPicker({ label: 'Z.AI', value: 'Z.AI', connect: true });

    expect(connection.handleProviderToggle).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ value: 'Z.AI' }));
  });

  it('selects nothing when the sign-in is cancelled or fails', async () => {
    connection.handleProviderToggle = vi.fn(async () => {});
    const { connectFromPicker, select } = picker();
    await connectFromPicker(CURSOR);

    expect(connection.handleProviderToggle).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  it('a sign-in that finishes after the user picked something else does not replace that pick', async () => {
    const { connectFromPicker, select, state } = picker({ selection: 'OpenAI' });
    connection.handleProviderToggle = vi.fn(async (id) => {
      state.selection = 'Anthropic'; // chosen while the device login was pending
      connection.connected.add(id);
    });
    await connectFromPicker(CURSOR);

    expect(select).not.toHaveBeenCalled();
  });

  it('a second click while a sign-in is open is the same request, not another sign-in', async () => {
    let finish;
    connection.handleProviderToggle = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { connectFromPicker } = picker();

    const first = connectFromPicker(CURSOR);
    const second = connectFromPicker(CURSOR);
    expect(second).toBe(first);
    finish();
    await first;

    expect(connection.handleProviderToggle).toHaveBeenCalledTimes(1);
  });

  it('ignores an option with no provider', async () => {
    const { connectFromPicker, select } = picker();
    await connectFromPicker({ label: '', value: '' });

    expect(connection.handleProviderToggle).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});
