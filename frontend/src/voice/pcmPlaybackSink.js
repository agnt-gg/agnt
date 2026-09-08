/** One owned PCM write, including context resume and source setup. Awaiting
 * onended bounds browser audio to one <=1-second chunk; stop settles locally
 * without waiting for resume or compute cancellation. Candidate mode prioritizes
 * a small auditable queue over gapless scheduling.
 */
export function createPcmPlaybackSink({ createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), volume = 1, onPostGatePcm, onRenderedStream } = {}) {
  let context, operation, stopped = false, draining = false, renderedTap;
  function releaseTap() {
    if (!renderedTap) return;
    const tap = renderedTap; renderedTap = null;
    for (const track of tap.stream.getTracks()) track.stop();
    try { tap.disconnect(); } catch { /* detached */ }
  }
  function stop() {
    stopped = true;
    // Pending resume has no source yet, but it still owns a promise to settle.
    operation?.finish(new Error(operation.source ? 'cancelled' : 'stale'));
    releaseTap();
    if (context) {
      const closing = context; context = null;
      try { Promise.resolve(closing.close()).catch(() => {}); } catch { /* closed */ }
    }
  }
  return {
    async write(samples, sampleRate, { isAllowed = () => true, onStarted = () => {}, ...identity } = {}) {
      if (stopped || operation || draining) throw new Error('stale');
      // Reserve BEFORE any await or externally supplied callback. A resume
      // rejection, source failure, ended event and stop all use the same owner.
      const owned = { source: null, gain: null, finished: false, finish: null };
      operation = owned;
      return new Promise((resolve, reject) => {
        owned.finish = error => {
          if (owned.finished) return;
          owned.finished = true;
          if (owned.source) {
            owned.source.onended = null;
            if (error) { try { owned.source.stop(); } catch { /* not started / ended */ } }
            try { owned.source.disconnect(); } catch { /* detached */ }
          }
          try { owned.gain?.disconnect(); } catch { /* detached */ }
          if (operation === owned) operation = null;
          error ? reject(error) : resolve();
        };
        const guard = () => {
          if (stopped || owned.finished || operation !== owned || !isAllowed()) throw new Error('stale');
        };
        let ctx;
        try {
          guard(); context ||= createContext(); ctx = context;
          // Attach rejection handling immediately. stop() can settle this write
          // even if resume never resolves, and late rejection stays observed.
          Promise.resolve(ctx.resume()).then(() => {
            try {
              guard();
              if (context !== ctx) throw new Error('stale');
              const buffer = ctx.createBuffer(1, samples.length, sampleRate);
              buffer.copyToChannel(samples, 0);
              const active = owned.source = ctx.createBufferSource();
              active.buffer = buffer;
              const gain = owned.gain = ctx.createGain();
              gain.gain.value = Math.min(1, Math.max(0, Number(volume) || 0));
              active.connect(gain); gain.connect(ctx.destination);
              // Optional observation of the ACTUAL graph after gain, not a
              // copy of scheduled bytes. Consumer captures it independently.
              if (onRenderedStream) {
                if (!renderedTap) {
                  renderedTap = ctx.createMediaStreamDestination();
                  try { onRenderedStream({ stream: renderedTap.stream, context: ctx, stage: 'rendered-post-gain-stream' }); }
                  catch (error) { releaseTap(); throw error; }
                }
                guard(); gain.connect(renderedTap);
              }
              active.onended = () => owned.finish();
              guard(); active.start();
              onStarted();
              guard();
              // Scheduled post-permission samples, NOT claimed hardware output.
              onPostGatePcm?.({ ...identity, samples: samples.slice(), sampleRate, stage: 'scheduled-post-gate' });
            } catch (error) { owned.finish(error); }
          }, error => owned.finish(error));
        } catch (error) { owned.finish(error); }
      });
    },
    async drain() {
      if (stopped || operation || draining) throw new Error('not-drained');
      draining = true;
      try {
        releaseTap();
        if (context) { const closing = context; context = null; await closing.close(); }
      } finally { draining = false; }
    },
    stop,
  };
}
