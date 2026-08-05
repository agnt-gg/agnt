/**
 * VOICE PARITY — every chat gets the same voice, or the suite goes red.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Voice was built on the main chat and the other composers lagged behind it
 * four separate times:
 *
 *   1. the voice button was invisible on every panel chat (wrong slot)
 *   2. the legacy dictation mic survived on surfaces the sweep missed
 *   3. the realtime session never inherited the conversation-switch guard
 *   4. natural voice and the two-register answer never reached the panels, so
 *      the workspace chat was still speaking through Windows SAPI while the
 *      main chat had speech-to-speech
 *
 * Each was found by a user, not by a test, because every guard written after
 * each fix asserted something about ONE host. A guard that names a file cannot
 * notice a second file that should have changed with it.
 *
 * So these tests do not name hosts. They DISCOVER every chat composer in the
 * tree and hold all of them to the same contract. A new composer is covered
 * the moment it renders a voice button, and a host that quietly reimplements
 * the feature fails immediately.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINES = path.join(SRC, 'composables/useVoiceEngines.js');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ALL_FILES = walk(SRC).filter((f) => /\.(vue|js)$/.test(f) && !/\.spec\.js$/.test(f));
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');

/**
 * A chat composer is a component that renders the voice toggle. The CONTROL is
 * the marker, not a CSS class or a filename: a component offering the user a
 * voice button is making a promise about what that button does.
 */
const COMPOSERS = ALL_FILES.filter((f) => f.endsWith('.vue') && read(f).includes('@click="toggleVoice"'));

describe('every chat composer uses the shared voice engine', () => {
  it('finds the composers at all (anti-vacuity)', () => {
    // If the marker ever stops matching, every test below would pass by
    // iterating an empty list — the exact failure mode this file exists for.
    expect(COMPOSERS.length).toBeGreaterThanOrEqual(3);
  });

  it('covers the three known surfaces, so the discovery is not missing any', () => {
    const names = COMPOSERS.map(rel);
    expect(names).toContain('views/Terminal/CenterPanel/BaseScreen.vue');
    expect(names).toContain('views/_components/chat/UnifiedChatContainer.vue');
    expect(names).toContain(
      'views/Terminal/CenterPanel/screens/Agents/components/AgentDetails/tabs/ChatTab.vue'
    );
  });

  it.each(COMPOSERS.map((f) => [rel(f), f]))('%s calls useVoiceEngines', (name, file) => {
    const src = read(file);
    expect(src).toMatch(/import\s*\{[^}]*useVoiceEngines[^}]*\}\s*from\s*'@\/composables\/useVoiceEngines'/);
    expect(src).toMatch(/useVoiceEngines\(\{/);
  });

  it.each(COMPOSERS.map((f) => [rel(f), f]))('%s supplies every adapter', (name, file) => {
    // Each of these is a real defect if omitted:
    //   submit          — nothing is ever sent
    //   streamingAnswer — nothing is ever spoken
    //   isStreaming     — the turn never completes, the call never resolves
    //   epoch           — the session outlives its conversation (cross-talk)
    const src = read(file);
    // `isStreaming,` and `isStreaming: isProcessing` are both valid — the
    // hosts name that ref differently, so match the key either way.
    for (const adapter of ['submit', 'streamingAnswer', 'isStreaming', 'epoch']) {
      expect(src, `${name} is missing the ${adapter} adapter`).toMatch(
        new RegExp(`\\b${adapter}\\s*[,:]`)
      );
    }
  });

  it.each(COMPOSERS.map((f) => [rel(f), f]))('%s reads the shared bindings, not an engine', (name, file) => {
    const src = read(file);
    // The status strip and the button tints are driven by these; a host that
    // re-derives them from one engine shows the wrong state for the other.
    for (const binding of ['voiceActive', 'voiceState', 'voicePartial', 'voiceError']) {
      expect(src, `${name} is missing ${binding}`).toContain(binding);
    }
  });

  it.each(COMPOSERS.map((f) => [rel(f), f]))('%s says which engine is live', (name, file) => {
    // Speech-to-speech and the cascade feel different enough that the user
    // should not have to guess which one they are talking to.
    expect(read(file)).toContain('voice-engine-badge');
  });
});

describe('the engines have exactly one consumer', () => {
  /**
   * This is the rule that makes the parity durable. As long as the engines can
   * only be reached through useVoiceEngines, a new surface cannot get a
   * PARTIAL copy of the feature — which is what happened all four times.
   */
  const directConsumers = ALL_FILES.filter((f) => {
    if (f === ENGINES) return false;
    const src = read(f);
    return (
      /import\s*\{[^}]*useVoiceSession[^}]*\}\s*from/.test(src) ||
      /import\s*\{[^}]*useRealtimeVoice[^}]*\}\s*from/.test(src)
    );
  });

  it('only useVoiceEngines imports the cascade or realtime engines', () => {
    expect(directConsumers.map(rel)).toEqual([]);
  });

  it('and useVoiceEngines really does import both (anti-vacuity)', () => {
    const src = read(ENGINES);
    expect(src).toMatch(/import\s*\{\s*useVoiceSession\s*\}/);
    expect(src).toMatch(/import\s*\{\s*useRealtimeVoice\s*\}/);
  });
});

describe('only one surface can be listening', () => {
  /**
   * A host cannot answer "is another chat already listening?" about itself,
   * and several are alive at once (KeepAlive caches screens; panel chats stay
   * mounted behind whatever is on top). That is how one utterance ended up
   * committed into two conversations with both answers spoken over each other.
   *
   * The floor is the app-wide answer. These assert the seam is actually wired,
   * because voiceExclusivity.spec.js can only prove the behaviour of the
   * composable as written today — it cannot notice a host that starts an
   * engine by some other route tomorrow.
   */
  const src = read(ENGINES);

  it('useVoiceEngines claims the floor before opening a microphone', () => {
    expect(src).toMatch(/import\s*\{[^}]*claimVoiceFloor[^}]*\}\s*from\s*'\.\.\/voice\/voiceFloor\.js'/);

    const toggle = src.indexOf('const toggleVoice = async () => {');
    expect(toggle).toBeGreaterThan(-1);
    const body = src.slice(toggle, src.indexOf('\n  };', toggle));
    expect(body).toMatch(/claimVoiceFloor\(stopVoice\)/);

    // Claimed BEFORE either engine starts, or two sessions overlap for the
    // length of the handshake.
    const claim = body.indexOf('claimVoiceFloor(');
    for (const start of ['realtime.start()', 'cascade.toggle()']) {
      expect(body.indexOf(start), `${start} is not started in toggleVoice`).toBeGreaterThan(-1);
      expect(claim, `the floor is claimed after ${start}`).toBeLessThan(body.indexOf(start));
    }
  });

  it('stopping a session gives the floor back', () => {
    const at = src.indexOf('const stopVoice = () => {');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf('\n  };', at))).toMatch(/releaseFloor\(\)/);
  });

  it('a host that goes off-screen or away stops its session', () => {
    // onUnmounted alone is not enough: <KeepAlive> DEACTIVATES a screen on
    // navigation and never unmounts it, which is precisely how a session used
    // to keep a microphone open in a chat the user could no longer see.
    expect(src).toMatch(/onDeactivated\(stopVoice\)/);
    expect(src).toMatch(/onUnmounted\(stopVoice\)/);
  });

  it('nothing else touches the floor directly', () => {
    // Compared as resolved paths, not by suffix: `endsWith('voice/voiceFloor.js')`
    // never matches on Windows, where the separator is a backslash — and the
    // module would exclude itself only by accident on one platform.
    const FLOOR = path.join(SRC, 'voice/voiceFloor.js');
    const others = ALL_FILES.filter((f) => f !== ENGINES && f !== FLOOR && /voiceFloor/.test(read(f)));
    expect(others.map(rel)).toEqual([]);
  });

  it('anti-vacuity: the floor module is where it is expected to be', () => {
    expect(fs.existsSync(path.join(SRC, 'voice/voiceFloor.js'))).toBe(true);
  });
});

describe('every send path marks a spoken turn', () => {
  /**
   * The voice arm is consumed where a message is SENT, not where voice is
   * started, because that is the only place that knows the text actually went
   * out. A send path that forgets leaves voiceMode off the request, so the
   * assistant writes a full essay and the whole thing is read aloud — the
   * four-minute monologue the two-register design exists to prevent.
   *
   * That is exactly what happened to the panel chats: the main chat consumed
   * the arm and chatUnified never did.
   */
  const SEND_PATHS = [
    ['store/features/chat.js', 'startStreamingConversation'],
    ['store/features/chat.js', 'startAgentStreamingConversation'],
    ['store/features/chatUnified.js', 'sendMessage'],
  ];

  it.each(SEND_PATHS)('%s / %s consumes the voice arm', (file, action) => {
    const src = read(path.join(SRC, file));
    expect(src, `${file} does not import consumeVoiceTurn`).toMatch(
      /import\s*\{\s*consumeVoiceTurn\s*\}\s*from\s*'@\/services\/voiceTurn\.js'/
    );

    // Scoped to THIS action's body — bounded by the next top-level action — so
    // one call in a neighbouring action cannot satisfy all three assertions.
    const at = src.indexOf(`async ${action}(`);
    expect(at, `${action} not found in ${file}`).toBeGreaterThan(-1);
    const nextAction = src.slice(at + 1).search(/\n {4}async \w+\(/);
    const body = nextAction === -1 ? src.slice(at) : src.slice(at, at + 1 + nextAction);

    expect(body, `${action} never calls consumeVoiceTurn`).toMatch(/consumeVoiceTurn\(/);
    expect(body, `${action} never sends voiceMode`).toMatch(/voiceMode/);
  });

  it('finds all three send paths (anti-vacuity)', () => {
    expect(SEND_PATHS).toHaveLength(3);
    for (const [file] of SEND_PATHS) {
      expect(fs.existsSync(path.join(SRC, file))).toBe(true);
    }
  });
});
