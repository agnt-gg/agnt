/**
 * The app's realtime socket must never stay dead.
 *
 * It used to give up after 5 reconnect attempts (~15s). One sleep or network
 * blip left the window deaf until a reload: the chat kept working over HTTP,
 * so the only visible symptom was a live browser card stuck on "channel
 * unavailable", with a Retry button that could not revive the socket.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

const fake = vi.hoisted(() => ({ socket: null, io: null }));

vi.mock('socket.io-client', () => {
  fake.io = vi.fn(() => {
    const handlers = new Map();
    fake.socket = {
      connected: true,
      on: vi.fn((name, fn) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      fire: (name, ...args) => (handlers.get(name) || []).forEach((fn) => fn(...args)),
    };
    return fake.socket;
  });
  return { io: fake.io };
});
const catchUpAfterResume = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../services/runResume.js', () => ({ catchUpAfterResume }));
vi.mock('vuex', () => ({ useStore: () => ({ state: { userAuth: { user: { id: 'u1' } } }, dispatch: vi.fn(), commit: vi.fn() }) }));

const { useRealtimeSync, ensureRealtimeConnected } = await import('./useRealtimeSync.js');

beforeEach(async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'token' });
  if (!fake.socket) {
    mount(defineComponent({ setup() { useRealtimeSync(); return () => h('div'); } }));
    await flushPromises();
  }
  fake.socket.connect.mockClear();
  fake.socket.connected = true;
});

describe('the realtime socket never gives up', () => {
  it('reconnects forever, with a capped backoff', () => {
    const options = fake.io.mock.calls[0][1];
    expect(options.reconnection).toBe(true);
    expect(options.reconnectionAttempts).toBe(Infinity);
    expect(options.reconnectionDelayMax).toBeLessThanOrEqual(5000);
  });

  it('reconnects after a server-initiated disconnect, which socket.io does not retry on its own', () => {
    fake.socket.connected = false;
    fake.socket.fire('disconnect', 'io server disconnect');
    expect(fake.socket.connect).toHaveBeenCalledTimes(1);
  });

  it('leaves ordinary transport drops to the built-in reconnection', () => {
    fake.socket.connected = false;
    fake.socket.fire('disconnect', 'transport close');
    expect(fake.socket.connect).not.toHaveBeenCalled();
  });

  it('reconnects immediately when the network returns or the window is looked at again', () => {
    fake.socket.connected = false;
    window.dispatchEvent(new Event('online'));
    expect(fake.socket.connect).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.socket.connect).toHaveBeenCalledTimes(2);
  });

  it('catches the chats up when the window is looked at again', async () => {
    catchUpAfterResume.mockClear();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(catchUpAfterResume).toHaveBeenCalledWith(expect.anything(), { reason: 'visible' });
  });

  it('catches the chats up once the socket signs back in after a drop, not on every sign-in', async () => {
    fake.socket.fire('authenticated', { success: true, userId: 'u1' });
    await flushPromises();
    catchUpAfterResume.mockClear();

    fake.socket.fire('authenticated', { success: true, userId: 'u1' });
    await flushPromises();
    expect(catchUpAfterResume).not.toHaveBeenCalled();

    fake.socket.fire('disconnect', 'transport close');
    fake.socket.fire('authenticated', { success: true, userId: 'u1' });
    await flushPromises();
    expect(catchUpAfterResume).toHaveBeenCalledTimes(1);
    expect(catchUpAfterResume).toHaveBeenCalledWith(expect.anything(), { reason: 'reconnect' });
  });

  it('never disturbs a socket that is already connected', () => {
    fake.socket.connected = true;
    ensureRealtimeConnected();
    window.dispatchEvent(new Event('online'));
    expect(fake.socket.connect).not.toHaveBeenCalled();
  });
});
