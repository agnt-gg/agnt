/**
 * energyVad — voice activity detection over raw PCM frames.
 *
 * WHY NOT A FIXED THRESHOLD
 * -------------------------
 * A hardcoded RMS cutoff works on exactly one microphone in one room. A laptop
 * fan, an open window, or a cheap USB mic with +20dB of gain each move the
 * noise floor by an order of magnitude. So the floor is LEARNED: silent frames
 * feed an exponential moving average, and speech is declared relative to that
 * floor rather than against an absolute number.
 *
 * WHY HYSTERESIS
 * --------------
 * Speech energy is not a step function — it dips between syllables and drops to
 * near-silence on stops (the /t/ in "start"). A single threshold makes the
 * detector chatter: speech/silence/speech/silence within one word. Two
 * thresholds plus frame-count confirmation turn that into a clean edge:
 *
 *   onset:   needs `onsetFrames` consecutive frames ABOVE  floor * onsetRatio
 *   release: needs `releaseFrames` consecutive frames BELOW floor * releaseRatio
 *
 * releaseRatio < onsetRatio deliberately — once we believe someone is talking,
 * we require clearly quieter audio before we stop believing it. This is the
 * same asymmetry a Schmitt trigger uses, and for the same reason.
 *
 * The floor only adapts while we believe the channel is SILENT. Adapting during
 * speech would let a long sentence raise the floor until the speaker's own
 * voice reads as background — the classic self-muting bug.
 *
 * This module is pure and synchronous: no AudioContext, no timers, no DOM. It
 * is driven by whoever owns the audio graph, which makes it testable against
 * synthetic frames and replayable against recorded audio.
 */

/** Root-mean-square amplitude of a frame. 0 for an empty frame. */
export function rms(frame) {
  if (!frame || frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export const DEFAULT_VAD_CONFIG = Object.freeze({
  /** Speech onset when energy exceeds floor * onsetRatio. */
  onsetRatio: 3.5,
  /** Speech release when energy falls below floor * releaseRatio. */
  releaseRatio: 2.0,
  /** Consecutive loud frames required to declare speech. ~3 frames @20ms = 60ms. */
  onsetFrames: 3,
  /** Consecutive quiet frames required to declare silence. Kept small — the
   *  endpointer, not the VAD, decides how long a pause must be to end a turn. */
  releaseFrames: 3,
  /** EMA weight for the noise floor. Low = slow, stable adaptation. */
  floorAlpha: 0.05,
  /** Starting guess for the noise floor before any audio is seen. */
  initialFloor: 0.005,
  /** Hard lower bound. Digital silence would otherwise drive the floor to 0 and
   *  make every ratio comparison meaningless (0 * 3.5 === 0, so any nonzero
   *  sample would read as speech). */
  minFloor: 0.0008,
  /** Hard upper bound, so a burst of noise cannot raise the floor so far that
   *  real speech can never clear it. */
  maxFloor: 0.08,
  /** Frame duration in ms. Used to report speech/silence durations. */
  frameMs: 20,
  /**
   * Calibration window, in frames, before speech may be declared at all.
   *
   * WHY THIS IS NOT OPTIONAL. `initialFloor` is a guess. Open the mic in a room
   * that is already louder than that guess — a fan, a café, a noisy USB mic with
   * hot gain — and the very first frames clear the onset ratio, so ambient noise
   * is declared speech. The floor then STOPS adapting (by design, so a long
   * sentence cannot raise the floor into the speaker's own voice), which means
   * the detector latches ON and never recovers for the life of the session.
   *
   * Holding speech off for a few hundred ms lets the floor find the real room
   * first. It costs one calibration window at session start and removes an
   * entire class of unrecoverable failure.
   */
  warmupFrames: 15,
});

/**
 * Create a stateful VAD. Feed it frames; it returns a snapshot per frame.
 * @param {Partial<typeof DEFAULT_VAD_CONFIG>} [config]
 */
export function createVad(config = {}) {
  const cfg = { ...DEFAULT_VAD_CONFIG, ...config };

  let floor = cfg.initialFloor;
  let speaking = false;
  let loudRun = 0;
  let quietRun = 0;
  let speechMs = 0;
  let silenceMs = 0;
  /** Frames observed since construction/reset — lets callers ignore warm-up. */
  let frames = 0;

  function reset() {
    floor = cfg.initialFloor;
    speaking = false;
    loudRun = 0;
    quietRun = 0;
    speechMs = 0;
    silenceMs = 0;
    frames = 0;
  }

  /**
   * @param {Float32Array|number[]} frame  PCM samples in [-1, 1]
   * @returns {{
   *   speaking: boolean, onset: boolean, release: boolean,
   *   energy: number, floor: number, ratio: number,
   *   speechMs: number, silenceMs: number, frames: number
   * }}
   */
  function push(frame) {
    frames += 1;
    const energy = rms(frame);
    const ratio = floor > 0 ? energy / floor : 0;

    let onset = false;
    let release = false;

    // Calibration window: learn the room, declare nothing. See warmupFrames.
    if (frames <= cfg.warmupFrames) {
      const next = floor * (1 - cfg.floorAlpha) + energy * cfg.floorAlpha;
      floor = Math.min(cfg.maxFloor, Math.max(cfg.minFloor, next));
      silenceMs += cfg.frameMs;
      return { speaking: false, onset: false, release: false, energy, floor, ratio, speechMs: 0, silenceMs, frames, warmup: true };
    }

    if (energy > floor * cfg.onsetRatio) {
      loudRun += 1;
      quietRun = 0;
    } else if (energy < floor * cfg.releaseRatio) {
      quietRun += 1;
      loudRun = 0;
    } else {
      // Between the two thresholds: the ambiguous band. Hold both runs so a
      // signal hovering in the middle neither triggers nor releases.
      loudRun = 0;
      quietRun = 0;
    }

    if (!speaking && loudRun >= cfg.onsetFrames) {
      speaking = true;
      onset = true;
      speechMs = loudRun * cfg.frameMs; // credit the frames that proved it
      silenceMs = 0;
    } else if (speaking && quietRun >= cfg.releaseFrames) {
      speaking = false;
      release = true;
      silenceMs = quietRun * cfg.frameMs;
      speechMs = 0;
    } else if (speaking) {
      speechMs += cfg.frameMs;
    } else {
      silenceMs += cfg.frameMs;
    }

    // Adapt the floor ONLY on confident silence. See header.
    if (!speaking && quietRun > 0) {
      const next = floor * (1 - cfg.floorAlpha) + energy * cfg.floorAlpha;
      floor = Math.min(cfg.maxFloor, Math.max(cfg.minFloor, next));
    }

    return { speaking, onset, release, energy, floor, ratio, speechMs, silenceMs, frames, warmup: false };
  }

  return {
    push,
    reset,
    get config() {
      return cfg;
    },
    get isSpeaking() {
      return speaking;
    },
    get noiseFloor() {
      return floor;
    },
    /**
     * True while still calibrating; callers should not act on `isSpeaking`.
     * `push` consumes frames 1..warmupFrames, so after exactly warmupFrames
     * pushes the window is closed — strict `<`, not `<=`.
     */
    get isCalibrating() {
      return frames < cfg.warmupFrames;
    },
    /** ms of continuous silence since speech last ended. 0 while speaking. */
    get silenceMs() {
      return speaking ? 0 : silenceMs;
    },
  };
}

export default { createVad, rms, DEFAULT_VAD_CONFIG };
