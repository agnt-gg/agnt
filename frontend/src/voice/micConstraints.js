/**
 * micConstraints — how this application opens a microphone, decided once.
 *
 * WHY THIS IS A MODULE AND NOT THREE OBJECT LITERALS
 * --------------------------------------------------
 * There are three places that open a mic — the cascade's audio graph, the
 * realtime session's WebRTC sender, and the legacy dictation button — and they
 * each carried their own copy of the constraint object. That is the same shape
 * as every other voice bug this codebase has shipped: identical intent, written
 * out three times, then fixed in one or two of them. A constraint that is
 * dangerous on one path is dangerous on all three, because they are all the
 * same microphone in the same room.
 *
 * WHY EACH FLAG IS WHAT IT IS
 * ---------------------------
 * echoCancellation: TRUE — load-bearing, do not turn off. Barge-in requires the
 *   mic to stay open while the assistant is speaking. Without AEC the assistant
 *   hears itself, the VAD fires, and it interrupts its own sentence on every
 *   reply. audioCapture's `duckedOnsetMultiplier` is the belt to this braces.
 *
 * noiseSuppression: FALSE — this ate the beginning of sentences.
 *   Chrome's suppressor classifies the channel while it is quiet and needs a few
 *   hundred milliseconds to re-decide once speech starts. It spends that time
 *   attenuating the very first syllable, which is how "Hetzner" reached the
 *   transcript as "petzler". The same reasoning already removed server-side
 *   denoising from the realtime session (39391f2, "stop denoising the mic input
 *   — it can swallow a barge-in"); this is the client half of that fix, which
 *   was left behind. The VAD does not need a clean signal: it learns the room's
 *   noise floor and triggers on a RATIO above it, so a noisier input moves the
 *   floor and the threshold together.
 *
 * autoGainControl: FALSE — same failure, different mechanism. After silence the
 *   AGC has wound its gain up to hunt for signal; when speech arrives it must
 *   wind back down, and it does that BY ATTENUATING the first syllable. It also
 *   fights the VAD directly, because a learned noise floor and an automatically
 *   moving input level are two control loops on the same signal.
 *
 * If a future device genuinely needs different handling, add it HERE as a
 * documented exception. Do not hand-roll a constraint object at a call site —
 * micConstraints.spec.js fails the build if you do.
 */

/** The `audio` member of a getUserMedia constraint object. */
export const MIC_AUDIO_CONSTRAINTS = Object.freeze({
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
});

/** A complete getUserMedia argument. Pass this straight to getUserMedia. */
export const MIC_CONSTRAINTS = Object.freeze({ audio: MIC_AUDIO_CONSTRAINTS });

export default { MIC_CONSTRAINTS, MIC_AUDIO_CONSTRAINTS };
