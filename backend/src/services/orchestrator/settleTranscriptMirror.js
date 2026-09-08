/** Bound terminal latency without claiming cancellation of an in-flight DB write.
 * A timeout means unknown mirror outcome; a late write may still become durable. */
export async function settleTranscriptMirror(write, timeoutMs = 2000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(write).catch(() => ({ written: false, reason: 'mirror_error' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ written: false, reason: 'mirror_timeout_unknown' }), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
