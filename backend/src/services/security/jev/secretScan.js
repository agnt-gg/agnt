/**
 * Deterministic, local secret evidence for the Jev gate.
 *
 * WHY THIS EXISTS
 * The soak proved Jev blocks the FAMOUS FILENAME (~/.ssh/id_rsa, absent on this
 * machine) and allows the REAL key (~/.ssh/id_ed25519). Filename reputation is
 * not a security control. This module answers two factual questions the model
 * cannot: does the path exist, and does its content/permission look like a
 * secret?
 *
 * RULES
 * - Never returns file content. Only path + why. Callers log this verbatim.
 * - Reads at most SNIFF_BYTES from a regular file, never a device/fifo.
 * - A path that does not exist is `absent` and is NOT secret evidence.
 * - Redirection (`> /dev/null`) cannot launder anything: evidence is derived
 *   from the paths a command touches, not from where stdout goes.
 */
import { statSync, openSync, readSync, closeSync, existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { homedir } from "node:os";
import { canonicalPath, isNonPathToken } from './paths.js';

export const SNIFF_BYTES = 4096;

/** Content signatures. Proof, not reputation. */
const CONTENT_SIGNATURES = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, "pem-private-key"],
  [/PuTTY-User-Key-File-\d/, "putty-private-key"],
  [/^\s*ssh-(rsa|ed25519|dss) AAAA\S+\s+\S*PRIVATE/m, "ssh-private-blob"],
  [/\bsk-[A-Za-z0-9]{16,}/, "openai-style-token"],
  [/\bghp_[A-Za-z0-9]{20,}/, "github-token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "slack-token"],
  [/\bAKIA[0-9A-Z]{12,}/, "aws-access-key-id"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "google-api-key"],
  [/-----BEGIN PGP PRIVATE KEY BLOCK-----/, "pgp-private-key"],
];

/** dotenv-ish assignment whose NAME claims a secret and whose value is real. */
const ENV_SECRET_LINE =
  /^\s*(?:export\s+)?([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(.+)$/m;

// Hyphenated placeholders are the common real-world spelling: your-token-here,
// replace-me, my_api_key. Missing those is a false "secret" on a sample file.
const PLACEHOLDER =
  /^["']?(?:|x+|changeme|change[-_ ]me|replace[-_ ]?me|placeholder|todo|none|null|your[-_ ][\w-]*|my[-_ ](?:api[-_ ]?key|token|secret)[\w-]*|example[\w.-]*|<[^>]*>|\$\{[^}]*\}|\$[A-Z_]+)["']?$/i;

/**
 * Commands that can move bytes off this machine. Blocks a phantom downgrade.
 *
 * Matched against COMMAND POSITION ONLY, never the whole string. A substring
 * test is wrong here: `\bssh\b` matches the PATH `/Users/x/.ssh/id_rsa`, which
 * made every key path look like egress and silently disabled the phantom
 * downgrade. Basename comparison also catches `/usr/bin/curl`.
 */
const EGRESS_PROGRAMS = new Set([
  "curl", "wget", "nc", "ncat", "netcat", "scp", "sftp", "rsync",
  "ssh", "mail", "sendmail", "mutt", "ftp", "telnet", "openssl",
]);

/** Wrappers that delegate to the next word. */
const PASSTHROUGH = new Set(["sudo", "env", "nohup", "time", "command", "exec", "xargs", "doas"]);

/** Marker used by our own safe fixtures — explicitly NOT a secret. */

/** Strip one layer of surrounding quotes. */
function unquote(token) {
  return String(token || "").replace(/^["']|["']$/g, "");
}

/**
 * Remove heredoc BODIES from a command.
 *
 * WHY: a heredoc body is CONTENT BEING WRITTEN, not paths being read. The soak
 * caught this for real — `cat > /tmp/x.mjs <<'EOF' … EOF` was blocked as
 * `secret-content` because the script being written happened to mention
 * `~/.ssh/id_ed25519` in a string. Under enforce that refuses any attempt to
 * write a test, doc or script that merely NAMES a key path, while reading the
 * key is what the gate is actually for.
 *
 * The opener line is KEPT: `cat > /tmp/x.mjs` names a real write target.
 * Herestrings (`<<<`) are deliberately not matched — the name pattern cannot
 * start with `<`.
 */
export function stripHeredocBodies(command) {
  const text = String(command || "");
  if (!text.includes("<<")) return text;

  // `<<-?` then an optionally-quoted word.
  //
  // The lookaround is load-bearing. In `grep x <<< foo` the `<<` ALSO matches
  // at the second and third angle brackets, leaving ` foo` — which parses as a
  // heredoc named `foo`, so every following line was swallowed until a line
  // said `foo`. That predates this change and was hidden because the only
  // herestring test used a path (`<<< /Users/…`), and a leading `/` cannot
  // start a terminator name. A bare word exposes it.
  const OPENER = /(?<!<)<<-?(?!<)\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/;

  const out = [];
  let terminator = null;
  for (const line of text.split("\n")) {
    if (terminator === null) {
      const m = OPENER.exec(line);
      // Keep the opener line — `cat > /tmp/x.mjs` names a real write target —
      // but DROP the `<<EOF` token itself. It names the terminator, not a
      // file, and it survives tokenisation as the bare word `EOF`: with a cd
      // in effect, a file actually called EOF in that directory would then be
      // scanned as though the command had read it.
      out.push(m ? line.replace(OPENER, "") : line);
      if (m) terminator = m[2];
      continue;
    }
    // Inside a body: drop the line. The terminator itself is not content.
    if (line.trim() === terminator) terminator = null;
  }
  return out.join("\n");
}

/** Segments that each begin a new command position. */
export function commandSegments(command) {
  return String(command || "").split(/(?:\|\||&&|[;|&\n]|\$\(|`)+/);
}

/**
 * Programs that never OPEN their arguments — a path here is being NAMED, not
 * read. Same class as the heredoc defect: `echo "the key is at ~/.ssh/id_x"`
 * was scored as secret evidence, so under enforce merely talking about a path
 * was refused.
 *
 * DELIBERATELY GIVEN UP: a redirect target, as in `echo x > ~/.ssh/id_ed25519`.
 * That is a destructive overwrite rather than a secret being exposed, and it
 * is the reversibility question's job, not this scanner's. A substitution like
 * `echo "$(cat ~/.ssh/id_x)"` is unaffected — commandSegments splits on `$(`,
 * so the `cat` is judged on its own.
 */
const NON_READING = new Set(["echo", "printf", "true", "false", ":"]);

/** `NAME=value`, which is an assignment rather than a path being touched. */
const ASSIGN_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** `$NAME` / `${NAME}` / `"$NAME"` after unquoting. */
const DEREF = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/;

/**
 * Variable assignments anywhere in the command.
 *
 * WHY: `K=~/.ssh/id_ed25519; cat $K` read the real key and was MISSED, because
 * the assignment token was stat'd whole (and counted as an ABSENT path, which
 * also polluted the signal the phantom downgrade reads) while `$K` was never
 * resolved to anything. Indirection through a variable is a shape an agent
 * writes naturally, not an evasion, so it has to resolve.
 */
export function collectAssignments(command) {
  const vars = new Map();
  const re = /(?:^|[\s;&|(])(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|)]*)/g;
  for (const m of String(command || "").matchAll(re)) {
    vars.set(m[1], unquote(m[2]));
  }
  return vars;
}

/**
 * Resolve `$NAME`.
 *
 * The hop cap is load-bearing and the equality check does NOT subsume it: a
 * SELF-reference (`K=$K`) is caught by the equality test, but a MUTUAL pair
 * (`A=$B; B=$A`) alternates forever and is stopped only by the cap. The cost
 * is that a chain deeper than the cap stays unresolved — pinned by test.
 */
export function derefToken(token, vars) {
  let t = String(token || "");
  for (let hop = 0; hop < 3; hop += 1) {
    const m = DEREF.exec(t);
    // An unknown name (notably $HOME) is left alone for canonicalPath to expand.
    if (!m || !vars.has(m[1])) return t;
    const next = vars.get(m[1]);
    if (!next || next === t) return t;
    t = next;
  }
  return t;
}

const GLOB_CHARS = /[*?[]/;

/**
 * A glob in a large directory must not stall the tool path, and the evidence
 * only needs to prove SOMETHING secret is in reach — not enumerate everything.
 */
export const MAX_GLOB_MATCHES = 64;

/** Shell-style glob -> anchored RegExp. `*` and `?` never cross a separator. */
export function globToRegExp(pattern) {
  let rx = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      rx += "[^/]*";
    } else if (c === "?") {
      rx += "[^/]";
    } else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        rx += "\\[";
      } else {
        rx += `[${pattern.slice(i + 1, end)}]`;
        i = end;
      }
    } else {
      rx += c.replace(/[.+^${}()|\\\]]/g, "\\$&");
    }
  }
  return new RegExp(`^${rx}$`);
}

/**
 * Expand a glob against the real filesystem.
 *
 * WHY: `cat ~/.ssh/*` reads every key in the directory and was MISSED, because
 * the token never named a file that exists. Only the LAST segment is expanded;
 * a glob in the directory part is not worth the complexity and returns nothing
 * rather than guessing. Leading dots follow shell semantics — `*` does not
 * match a dotfile unless the pattern itself starts with one.
 */
export function expandGlob(token, opts = {}, cwd = null) {
  const cut = token.lastIndexOf("/");
  const dirPart = cut === -1 ? "." : token.slice(0, cut) || "/";
  const namePart = cut === -1 ? token : token.slice(cut + 1);
  if (!namePart) return [];
  // NOTE: a glob in the DIRECTORY part (`dir*/name`) is not expanded. No guard
  // is needed for it — the directory read below simply fails and yields no
  // evidence. An explicit check here was removed because no test could kill
  // it: it was redundant with that failure, and an unkillable line is a line
  // pretending to be a safeguard.

  const base = cwd ? { ...opts, projectDir: cwd } : opts;
  const dir = dirPart === "." ? cwd || opts.projectDir || process.cwd() : canonicalPath(dirPart, base);

  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return []; // unreadable or absent directory: no evidence, not an error
  }

  const rx = globToRegExp(namePart);
  const wantsDotfiles = namePart.startsWith(".");
  const hits = [];
  for (const name of names) {
    if (!wantsDotfiles && name.startsWith(".")) continue;
    if (!rx.test(name)) continue;
    hits.push(`${dir}/${name}`);
    if (hits.length >= MAX_GLOB_MATCHES) break;
  }
  return hits;
}

/** The program a segment runs, past any VAR=value prefixes and wrappers. */
function programOf(words) {
  let i = 0;
  while (
    i < words.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || PASSTHROUGH.has(basename(words[i])))
  ) {
    i += 1;
  }
  return { index: i, name: i < words.length ? basename(unquote(words[i])) : "" };
}

export function isEgressCommand(command) {
  const text = String(command || "");
  // Each segment after a separator starts a new command position.
  for (const segment of text.split(/(?:\|\||&&|[;|&\n]|\$\(|`)+/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    // skip VAR=value prefixes and wrappers like sudo/env
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || PASSTHROUGH.has(basename(words[i])))) {
      i += 1;
    }
    if (i >= words.length) continue;
    const prog = basename(words[i].replace(/^["']|["']$/g, ""));
    if (EGRESS_PROGRAMS.has(prog)) return true;
  }
  return false;
}

/** Owner-only (0600 / 0400) is how private keys are actually stored. */
export function isRestrictedMode(mode) {
  return (mode & 0o077) === 0;
}

function sniff(file) {
  let fd;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(SNIFF_BYTES);
    const n = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Content verdict for already-read text. Exported so tests need no real key. */
export function classifyContent(text) {
  if (typeof text !== "string" || !text) return null;
  for (const [re, why] of CONTENT_SIGNATURES) {
    if (re.test(text)) return why;
  }
  const m = text.match(ENV_SECRET_LINE);
  if (m) {
    const value = String(m[2] || "").trim();
    if (value && !PLACEHOLDER.test(value) && value.replace(/["']/g, "").length >= 8) {
      return "env-secret-assignment";
    }
  }
  return null;
}

/**
 * Inspect one path. Returns { path, status, why, restricted }.
 * status: 'secret' | 'restricted' | 'clean' | 'absent' | 'unreadable'
 */
export function inspectPath(rawPath, opts = {}) {
  const path = canonicalPath(String(rawPath || ""), opts);
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    return {
      path,
      status: e.code === "ENOENT" ? "absent" : "unreadable",
      why: e.code === "ENOENT" ? "path-does-not-exist" : `stat-${e.code || "error"}`,
      restricted: false,
    };
  }
  if (!st.isFile()) {
    return { path, status: "clean", why: "not-a-regular-file", restricted: false };
  }
  const restricted = isRestrictedMode(st.mode);
  const text = sniff(path);
  if (text === null) {
    return { path, status: "unreadable", why: "cannot-open", restricted };
  }
  const why = classifyContent(text);
  if (why) return { path, status: "secret", why, restricted };
  if (restricted && /(^|\/)(id_[a-z0-9]+|.*\.pem|.*\.key|credentials|\.netrc)$/i.test(path)) {
    return { path, status: "restricted", why: "owner-only-key-shaped-file", restricted };
  }
  return { path, status: "clean", why: "no-secret-signature", restricted, name: basename(path) };
}

/**
 * Pull plausible filesystem paths out of a command string and tool args.
 *
 * Two rules that are not obvious:
 *
 * 1. Heredoc bodies are stripped first (see stripHeredocBodies) — written
 *    content must not be mistaken for paths being read.
 * 2. `cd` is TRACKED, so `cd ~/.ssh && cat id_ed25519` resolves the bare
 *    filename. Without it the gate missed the plainest possible read of a real
 *    key, because `id_ed25519` contains no slash. A bare token is only taken
 *    as a path when a `cd` established a directory AND the file EXISTS there —
 *    otherwise every subcommand and flag would be stat'd, and every miss would
 *    be counted as an absent path, which is the signal the phantom downgrade
 *    reads.
 *
 * `content` / `code` args are deliberately NOT scanned, for rule 1's reason.
 */
export function extractPaths(args = {}, opts = {}) {
  const found = new Set();
  const command = stripHeredocBodies(typeof args.command === "string" ? args.command : "");

  const vars = collectAssignments(command);

  let cwd = null;
  for (const segment of commandSegments(command)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    const prog = programOf(words);
    if (prog.name === "cd") {
      const raw = words[prog.index + 1];
      const target = raw ? derefToken(unquote(raw), vars) : null;
      const base = cwd ? { ...opts, projectDir: cwd } : opts;
      cwd = target ? canonicalPath(target, base) : (opts.home || homedir());
      continue;
    }
    if (NON_READING.has(prog.name)) continue;

    for (const tok of segment.split(/[\s()<>]+/)) {
      const raw = unquote(tok);
      if (!raw || raw.startsWith("-")) continue;
      // `NAME=value` assigns; it does not read. Stat'ing the whole token was a
      // guaranteed miss that also counted as an absent path.
      if (ASSIGN_TOKEN.test(raw)) continue;

      const t = derefToken(raw, vars);
      if (!t || t.startsWith("-")) continue;
      // A URL is not a file. Counting one as an "absent path" would pollute the
      // allAbsent signal the phantom downgrade depends on.
      if (isNonPathToken(t)) continue;
      if (t === "/dev/null") continue;

      if (GLOB_CHARS.test(t)) {
        for (const hit of expandGlob(t, opts, cwd)) found.add(hit);
        continue;
      }

      if (t.startsWith("~") || t.startsWith("$HOME") || t.startsWith("/")) {
        found.add(t);
        continue;
      }
      // Relative. Prefer the tracked cwd, but only on a real hit.
      if (cwd && existsSync(`${cwd}/${t}`)) {
        found.add(`${cwd}/${t}`);
        continue;
      }
      if (t.includes("/")) found.add(t);
    }
  }

  for (const key of ["path", "dest", "destination", "from", "to", "file"]) {
    if (typeof args[key] === "string" && args[key]) found.add(args[key]);
  }
  return [...found];
}

/**
 * Evidence for decide(). Pure data — no verdict, no content.
 *
 * secretPaths  proven secret material (content or owner-only key-shaped)
 * absentPaths  referenced but nonexistent — the phantom case
 * allAbsent    every referenced path is missing (nothing could be read)
 */
export function scanForSecrets(args = {}, opts = {}) {
  const candidates = extractPaths(args, opts);
  const inspected = candidates.map((p) => inspectPath(p, opts));
  const secretPaths = inspected.filter((r) => r.status === "secret" || r.status === "restricted");
  const absentPaths = inspected.filter((r) => r.status === "absent");
  return {
    scanned: inspected.length,
    inspected,
    secretPaths,
    absentPaths,
    hasRealSecret: secretPaths.length > 0,
    allAbsent: inspected.length > 0 && absentPaths.length === inspected.length,
    egress: isEgressCommand(args.command),
  };
}
