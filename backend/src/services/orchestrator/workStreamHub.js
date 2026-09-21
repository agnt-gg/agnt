import { createWorkEventTransport } from './workEventTransport.js';

/** One HTTP stream spans all segments; model 'done' is not task 'done'. */
export function createWorkStreamHub({ store, onError = console.error }) {
  const subscribers = new Map();
  return {
    async attach(work, transport) {
      transport.start();
      transport.send('conversation_started', { conversationId: work.conversation_id });
      let listeners = subscribers.get(work.id);
      if (!listeners) { listeners = new Set(); subscribers.set(work.id, listeners); }
      const entry = { transport, replay: null };
      listeners.add(entry);
      entry.replay = createWorkEventTransport({ store, work, onError,
        send: async (name, event) => {
          transport.send(name, { ...event, newObjective: true });
          if (['succeeded','paused','cancelled','waiting_auth','waiting_permission','waiting_dependency'].includes(event.status)) {
            transport.send('done', { workId: work.id, status: event.status });
            transport.finish();
            listeners.delete(entry);
            if (!listeners.size) subscribers.delete(work.id);
            // Do not await stop from inside the poll being stopped.
            queueMicrotask(() => entry.replay.stop().catch(onError));
          }
        },
      });
      entry.replay.start();
      transport.onClose?.(() => {
        listeners.delete(entry);
        if (!listeners.size) subscribers.delete(work.id);
        queueMicrotask(() => entry.replay.stop().catch(onError));
      });
    },
    async forWork(work) {
      return {
        start() {}, finish() {},
        reject(_status, error) { throw new Error(error); },
        send(name, payload) {
          if (name === 'done' || name === 'conversation_started') return;
          for (const entry of subscribers.get(work.id) || []) entry.transport.send(name, payload);
        },
      };
    },
    async close() {
      const entries = [...subscribers.values()].flatMap(listeners => [...listeners]);
      subscribers.clear();
      for (const entry of entries) { await entry.replay.stop(); entry.transport.finish(); }
    },
  };
}
