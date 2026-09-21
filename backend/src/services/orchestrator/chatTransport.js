/** HTTP is an observer of execution, not its lifetime owner. */
export function createChatTransport(response, { onError = console.warn, heartbeatMs = 15000 } = {}) {
  let open = true;
  let heartbeat;
  const closeListeners = new Set();
  const close = () => {
    if (!open) return;
    open = false;
    clearInterval(heartbeat);
    for (const listener of closeListeners) listener();
    closeListeners.clear();
  };
  response.on('close', close);
  return {
    onClose(listener) {
      if (!open) { listener(); return () => {}; }
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    reject(status, error) {
      response.setHeader('Content-Type', 'application/json');
      return response.status(status).json({ error });
    },
    start() {
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.flushHeaders();
      heartbeat = setInterval(() => {
        if (!open || response.writableFinished) { close(); return; }
        try { response.write(': keepalive\n\n'); }
        catch (error) { close(); onError('[Chat transport heartbeat]', error); }
      }, heartbeatMs);
      heartbeat.unref?.();
    },
    send(eventName, payload) {
      if (!open) return;
      try { response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`); }
      catch (error) { close(); onError('[Chat transport write]', error); }
    },
    finish() {
      clearInterval(heartbeat);
      response.removeListener('close', close);
      if (!open) return;
      close();
      try { response.end(); }
      catch (error) { onError('[Chat transport end]', error); }
    },
  };
}
