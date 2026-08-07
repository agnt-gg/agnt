/**
 * One definition of how a microphone is opened, enforced.
 *
 * WHY A SOURCE SCAN AND NOT JUST A UNIT TEST. The failure this guards against
 * is not "the constants are wrong" — it is "a fourth call site was added and
 * did not use them", which is precisely what happened three times before
 * micConstraints.js existed: the cascade graph, the realtime sender and the
 * legacy dictation button each carried their own copy, and a flag fixed in one
 * stayed broken in the others. A value can only be single-source if nothing
 * else is allowed to write it down.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MIC_CONSTRAINTS, MIC_AUDIO_CONSTRAINTS } from './micConstraints.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'voice/micConstraints.js';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'libs') continue;
      walk(full, out);
    } else if (/\.(js|vue)$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments are prose, not behaviour. audioCapture.js's header explains why echo
 * cancellation is load-bearing, and a scan that cannot tell an explanation from
 * an assignment would flag the very file that documents the rule.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FILES = walk(SRC).map((f) => ({
  rel: path.relative(SRC, f).replace(/\\/g, '/'),
  text: stripComments(fs.readFileSync(f, 'utf8')),
}));

/**
 * getUserMedia calls that hand-write an AUDIO constraint object.
 *
 * Written as a scan rather than one regex because `audio\s*:\s*(?!false)`
 * silently passes `audio: false` — `\s*` backtracks to zero width and the
 * lookahead then sits on a space, which is indeed not "false". The QR scanner's
 * camera-only call would have slipped through a stricter-looking pattern.
 */
function handRolledAudioCalls(text) {
  const found = [];
  const call = /getUserMedia\(\s*\{/g;
  let match;
  while ((match = call.exec(text))) {
    const arg = text.slice(match.index, match.index + 300);
    if (!/audio\s*:/.test(arg)) continue; // video only — not a microphone
    if (/audio\s*:\s*false\b/.test(arg)) continue; // explicitly not a microphone
    found.push(arg.split('\n').slice(0, 2).join(' ').trim());
  }
  return found;
}

describe('microphone constraints are defined in exactly one place', () => {
  it('no file hand-rolls an audio getUserMedia call', () => {
    const offenders = FILES.filter((f) => f.rel !== SELF && handRolledAudioCalls(f.text).length).map(
      (f) => f.rel
    );
    expect(offenders).toEqual([]);
  });

  it('no file outside micConstraints names the individual audio flags', () => {
    const offenders = FILES.filter(
      (f) => f.rel !== SELF && /\b(noiseSuppression|autoGainControl|echoCancellation)\s*:/.test(f.text)
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('the hand-rolled scan can still see one when it is there (anti-vacuity)', () => {
    // Without this, a regex that matches nothing at all would look like a pass.
    expect(handRolledAudioCalls('getUserMedia({ audio: { noiseSuppression: true } })')).toHaveLength(1);
    expect(handRolledAudioCalls('getUserMedia({ audio: true })')).toHaveLength(1);
    expect(handRolledAudioCalls('getUserMedia({ audio: false, video: {} })')).toHaveLength(0);
    expect(handRolledAudioCalls('getUserMedia(MIC_CONSTRAINTS)')).toHaveLength(0);
  });

  it('the scan is not vacuous — the real call sites are found and they import it', () => {
    const openers = FILES.filter((f) => f.rel !== SELF && /getUserMedia\(MIC_CONSTRAINTS\)/.test(f.text));
    // audioCapture (cascade), useRealtimeVoice (WebRTC), useSpeechRecognition
    // (legacy dictation). If this drops below three, a mic path stopped using
    // the shared constraints rather than the guard above getting stricter.
    expect(openers.length).toBeGreaterThanOrEqual(3);
    for (const f of openers) {
      expect(f.text).toMatch(/import \{[^}]*MIC_CONSTRAINTS[^}]*\} from ['"][^'"]*micConstraints\.js['"]/);
    }
  });
});

describe('the constraints themselves', () => {
  it('keeps echo cancellation on, because barge-in depends on it', () => {
    expect(MIC_AUDIO_CONSTRAINTS.echoCancellation).toBe(true);
  });

  it('turns off the two processors that attenuate the first syllable', () => {
    expect(MIC_AUDIO_CONSTRAINTS.noiseSuppression).toBe(false);
    expect(MIC_AUDIO_CONSTRAINTS.autoGainControl).toBe(false);
  });

  it('is frozen, so a call site cannot mutate the shared object', () => {
    expect(Object.isFrozen(MIC_CONSTRAINTS)).toBe(true);
    expect(Object.isFrozen(MIC_AUDIO_CONSTRAINTS)).toBe(true);
    expect(MIC_CONSTRAINTS.audio).toBe(MIC_AUDIO_CONSTRAINTS);
  });
});
