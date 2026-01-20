export function playBounceSound(y) {
  // Create or reuse AudioContext. Browsers require user interaction before
  // audio can start, but the first keyboard interaction that controls the
  // game should satisfy this requirement.
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return; // Audio not supported
  if (!playBounceSound._ctx) {
    playBounceSound._ctx = new AudioContext();
  }
  const ctx = playBounceSound._ctx;
  // In case the context is suspended (happens on some mobile browsers until
  // user gesture), try to resume. Ignore errors.
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const baseFreq = 220; // A3 ~220 Hz base note
  // Major scale pattern (user-edited) in semitone offsets
  const MAJOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

  // Keep track of the last platform height and current scale index
  if (playBounceSound._scaleIndex === undefined) {
    playBounceSound._scaleIndex = 0; // start at root
  }
  if (playBounceSound._lastY !== undefined) {
    // We want pitch progression to feel smoother.  Instead of jumping
    // several scale steps at once when the vertical distance is large,
    // we limit the change to at most ±1 step per bounce.  This still
    // lets higher bounces trend upwards over time, but prevents the
    // pitch from spiking too quickly.
    const stepHeight = 60;
    const diff = playBounceSound._lastY - y; // positive if we moved up

    // How many nominal platform-steps did we move?
    const rawSteps = Math.round(diff / stepHeight);

    // Clamp to [-1, 1] to soften rapid jumps.
    const deltaSteps = Math.max(-1, Math.min(1, rawSteps));

    playBounceSound._scaleIndex += deltaSteps;
  }
  // Save current height for next call
  playBounceSound._lastY = y;

  // ---- Reset to base tone if we are in the "low" area of the screen ----
  // If the platform (or ground) is near the bottom portion of the viewport,
  // treat it as returning to baseline and start the musical progression over.
  const LOW_AREA_RATIO = 0.95; // bottom 5% of the screen
  const viewHeight = window.innerHeight || 0;
  if (viewHeight && y >= viewHeight * LOW_AREA_RATIO) {
    // Return to root note
    playBounceSound._scaleIndex = 0;
  }

  // Convert scaleIndex to semitone offset
  const scaleIndex = playBounceSound._scaleIndex;
  const octave = Math.floor(scaleIndex / MAJOR_SCALE.length);
  let stepInOctave = scaleIndex % MAJOR_SCALE.length;
  if (stepInOctave < 0) stepInOctave += MAJOR_SCALE.length; // handle negative mods
  const semitoneOffset = MAJOR_SCALE[stepInOctave] + octave * 12;

  let freq = baseFreq * Math.pow(2, semitoneOffset / 12);
  // Clamp frequency to reasonable audio range
  if (freq < 60) freq = 60;
  if (freq > 8000) freq = 8000;

  // Create a short "blip" using an oscillator and gain envelope.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.25, now);           // initial volume
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25); // fade out quickly

  osc.start(now);
  osc.stop(now + 0.25);
}

export function resetBounceScale() {
  playBounceSound._scaleIndex = 0;
  playBounceSound._lastY = undefined;
}

// Establish a custom baseline height (e.g., starting platform)
export function setBounceBaseline(y) {
  playBounceSound._scaleIndex = 0;
  playBounceSound._lastY = y;
} 