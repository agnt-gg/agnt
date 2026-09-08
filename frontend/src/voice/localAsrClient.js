/** Candidate-only input boundary. Caller supplies synthetic or permissioned
 * 16kHz mono s16le bytes; this module never opens a microphone or submits a task.
 * Typed hard-final output is compatible with the existing native submit seam.
 * Stopping input cannot cancel an already accepted task or switch its model.
 */
export function createLocalAsrClient({ apiBase = '/api', fetch: fetchImpl = globalThis.fetch, getToken = () => null, timeoutMs = 65000 } = {}) {
  const endpoint = `${apiBase.replace(/\/$/, '')}/speech/transcribe-local`;
  let active = null;
  const attempts = new Set(); // fail closed at cap; caller lifecycle owns a new session
  return {
    stopListening() { active?.cancel('cancelled'); },
    async transcribe({ pcm, utteranceId } = {}) {
      const fail = reason => ({ ok: false, reason });
      if (active) return fail('busy');
      if (!(pcm instanceof Uint8Array) || !pcm.length || pcm.length % 2 || pcm.length > 1920000 ||
          typeof utteranceId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(utteranceId)) return fail('invalid-input');
      if (attempts.has(utteranceId)) return fail('duplicate-utterance');
      if (attempts.size >= 2048) return fail('session-limit');
      let token; try { token = getToken(); } catch { /* content-blind failure */ }
      if (typeof token !== 'string' || !token.trim()) return fail('authentication-required');
      attempts.add(utteranceId);
      const controller = new AbortController();
      let reader, timer, rejectCancel;
      const cancellation = new Promise((_, reject) => { rejectCancel = reject; });
      cancellation.catch(() => {});
      const error = reason => Object.assign(new Error(reason), { reason });
      const operation = { cancel(reason) { controller.abort(); rejectCancel(error(reason)); } };
      active = operation;
      const wait = promise => Promise.race([promise, cancellation]);
      try {
        const bound = Number.isFinite(timeoutMs) ? Math.min(65000, Math.max(1, timeoutMs)) : 65000;
        timer = setTimeout(() => operation.cancel('timeout'), bound);
        // Own the input snapshot until the request completes; no model/URL override.
        const response = await wait(fetchImpl(endpoint, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/pcm', 'X-ASR-Utterance-Id': utteranceId },
          body: pcm.slice(), signal: controller.signal,
        }));
        if (!response.ok) throw error(`http-${response.status}`);
        if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body?.getReader) throw error('invalid-final');
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let text = '', bytes = 0;
        while (true) {
          const next = await wait(reader.read());
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 65536) throw error('response-limit');
          text += decoder.decode(next.value, { stream: true });
        }
        text += decoder.decode();
        let r; try { r = JSON.parse(text); } catch { throw error('invalid-final'); }
        if (controller.signal.aborted) throw error('cancelled');
        if (r?.ok !== true || r.utteranceId !== utteranceId || r.kind !== 'local-asr-hard-final' || r.audioBytes !== pcm.byteLength ||
            typeof r.transcript !== 'string' || !r.transcript.trim() || r.transcript.length > 16384) throw error('invalid-final');
        return { ok: true, turn: { text: r.transcript, transcript: r.transcript, commitKind: r.kind, utteranceId, delegatedInterpretation: null } };
      } catch (e) {
        return fail(e.reason || (controller.signal.aborted ? 'cancelled' : 'transport'));
      } finally {
        clearTimeout(timer); controller.abort();
        try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* already closed */ }
        try { reader?.releaseLock(); } catch { /* already released */ }
        if (active === operation) active = null;
      }
    },
  };
}
