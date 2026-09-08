import { it, expect } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createLocalAsrSession } from './localAsrSession.js';
import { normalizeVoiceMetadata } from './voiceMetadata.js';
import { normalizeVoiceMetadata as hydrate } from '../../../../frontend/src/voice/voiceMetadata.js';
it('retains typed local ASR evidence through JSON persistence and frontend hydration', () => {
  const entry = { type: 'voice-input', kind: 'local-asr-hard-final', utteranceId: 'asr-1', observedTranscript: 'Nicht verschieben.', delegatedInterpretation: null };
  expect(hydrate(JSON.parse(JSON.stringify(normalizeVoiceMetadata([entry]))))).toEqual([entry]);
});
it('uses a real WebSocket single reader, ordered audio/reset, fresh socket per identical utterance', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(r => server.once('listening', r));
  const wire = []; let connections = 0;
  server.on('connection', ws => {
    connections++; const messages = []; wire.push(messages);
    ws.send(JSON.stringify({ type: 'ready' }));
    ws.on('message', (data, binary) => {
      messages.push(binary ? { audioBytes: data.length } : JSON.parse(data.toString()));
      if (!binary) {
        ws.send(JSON.stringify({ type: 'transcript', text: 'Ja', is_final: true, finalize: false }));
        ws.send(JSON.stringify({ type: 'transcript', text: 'Nein, nicht verschieben.', is_final: true, finalize: true }));
      }
    });
  });
  let session;
  try {
    for (const utteranceId of ['wire-a', 'wire-b']) {
      session = createLocalAsrSession({ openSocket: () => new WebSocket(`ws://127.0.0.1:${server.address().port}`, { maxPayload: 65536 }), utteranceId, timeoutMs: 1000 });
      expect(await session.ready).toEqual({ ok: true });
      expect(await session.sendAudio(Buffer.alloc(640))).toEqual({ ok: true });
      expect(await session.finalize()).toMatchObject({ ok: true, transcript: 'Nein, nicht verschieben.', utteranceId, audioBytes: 640 });
    }
    expect(connections).toBe(2);
    expect(wire).toEqual(Array.from({ length: 2 }, () => [{ audioBytes: 640 }, { type: 'reset', finalize: true }]));
  } finally {
    session?.cancel(); for (const ws of server.clients) ws.terminate(); await new Promise(r => server.close(r));
  }
});
