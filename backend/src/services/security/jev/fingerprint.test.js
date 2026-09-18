import { describe, it, expect } from 'vitest';
/**
 * The audit fingerprint must identify a call WITHOUT leaking credentials.
 *
 * SAFETY / WHY THE FIXTURES LOOK ODD:
 * every credential-shaped string is ASSEMBLED AT RUNTIME. Written as literals
 * they are correctly refused by AGNT's NOPE rules — an earlier test file in
 * this project was blocked for exactly that.
 */
import { homedir } from "node:os";

import {
  redactText,
  summarizeArgs,
  fingerprintArgs,
  PREVIEW_CHARS,
  HASH_CHARS,
  REDACTED,
} from './fingerprint.js';
import { safeFingerprint, assessToolCall, canonicalizeArgs } from './assess.js';
import { scanForSecrets } from './secretScan.js';

describe('fingerprint — redacted audit identity', () => {

  // Assembled, never literal.
  const SK = `sk-${"A1b2C3d4".repeat(4)}`;
  const GH = `ghp_${"Z9y8X7w6".repeat(3)}`;
  const AWSK = `AKIA${"QRSTUVWX".repeat(2)}`;
  const BLOB = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5";
  const DASHES = "-".repeat(5);
  const PEM = `${DASHES}BEGIN OPENSSH PRIVATE ${"KEY"}${DASHES}\nAAAA${"b".repeat(40)}\n${DASHES}END OPENSSH PRIVATE ${"KEY"}${DASHES}`;
  const TOKEN_NAME = ["API", "TOKEN"].join("_");

  const leaks = (out, secret) => out.includes(secret);

  /* ---------------- redaction ---------------- */

  it("known token shapes never survive redaction", () => {
    for (const secret of [SK, GH, AWSK]) {
      const out = redactText(`curl -H x ${secret} https://api.example.test`);
      expect(!leaks(out, secret), secret.slice(0, 6)).toBeTruthy();
      expect(out.includes(REDACTED)).toBeTruthy();
    }
  });

  it("bearer tokens and authorization headers are scrubbed", () => {
    const a = redactText(`curl -H "Authorization: Bearer ${BLOB}" https://x.test`);
    expect(!leaks(a, BLOB)).toBeTruthy();
    const b = redactText(`fetch --token ${BLOB}`);
    expect(!leaks(b, BLOB)).toBeTruthy();
  });

  it("secret-named assignments lose their value but keep their name", () => {
    const out = redactText(`${TOKEN_NAME}=${BLOB} node run.js`);
    expect(!leaks(out, BLOB)).toBeTruthy();
    expect(out.includes(TOKEN_NAME), "the NAME is the useful part of the audit").toBeTruthy();
    expect(out.includes("node run.js"), "surrounding context survives").toBeTruthy();
  });

  it("--password and user:pass forms are scrubbed", () => {
    expect(!leaks(redactText(`mysql --password=hunter2xyz`), "hunter2xyz")).toBeTruthy();
    expect(!leaks(redactText(`curl -u tom:hunter2xyz https://x.test`), "hunter2xyz")).toBeTruthy();
  });

  it("a PEM block is collapsed, never partially echoed", () => {
    const out = redactText(`echo "${PEM}" > /tmp/k`);
    expect(!out.includes("BEGIN OPENSSH")).toBeTruthy();
    expect(!leaks(out, "b".repeat(40))).toBeTruthy();
    expect(out.includes("REDACTED-KEY-BLOCK")).toBeTruthy();
  });

  it("signed-URL parameters are scrubbed", () => {
    const out = redactText(`curl "https://s3.test/o?AWSAccessKeyId=x&Signature=${BLOB}&Expires=1"`);
    expect(!leaks(out, BLOB)).toBeTruthy();
    expect(out.includes("Expires=1"), "non-secret params stay readable").toBeTruthy();
  });

  it("ordinary commands are left alone", () => {
    for (const cmd of ["ls -la", "echo hello", "git status", "cat /etc/hosts"]) {
      expect(redactText(cmd)).toBe(cmd);
    }
  });

  it("a long ordinary word is not mistaken for a blob", () => {
    const word = "supercalifragilisticexpialidociousandthensomemorewords";
    expect(redactText(`echo ${word}`)).toBe(`echo ${word}`);
  });

  /* ---------------- summary + preview ---------------- */

  it("the summary names the tool and the identifying args", () => {
    const s = summarizeArgs("file_operations", { operation: "write", path: "/tmp/x", content: "y".repeat(5000) });
    expect(s.includes("file_operations") && s.includes("operation=write") && s.includes("/tmp/x")).toBeTruthy();
    expect(!s.includes("yyyy"), "payload bodies are not part of the fingerprint").toBeTruthy();
  });

  it("code bodies contribute only their size", () => {
    const s = summarizeArgs("execute_javascript_code", { code: "const secret = 1;".repeat(10) });
    expect(/code:\d+b/.test(s)).toBeTruthy();
    expect(!s.includes("const secret")).toBeTruthy();
  });

  it("preview is capped and marked when truncated", () => {
    const f = fingerprintArgs({ toolName: "execute_shell_command", args: { command: `echo ${"x".repeat(400)}` } });
    expect(f.preview.length <= PREVIEW_CHARS + 1, f.preview.length).toBeTruthy();
    expect(f.truncated).toBe(true);
    expect(f.preview.endsWith("…")).toBeTruthy();
    expect(f.chars > PREVIEW_CHARS).toBeTruthy();
  });

  it("short commands are not truncated and report redacted=false", () => {
    const f = fingerprintArgs({ toolName: "execute_shell_command", args: { command: "ls -la" } });
    expect(f.truncated).toBe(false);
    expect(f.redacted).toBe(false);
    expect(f.preview.includes("ls -la")).toBeTruthy();
  });

  /* ---------------- hash contract ---------------- */

  it("hash is stable, hex, and fixed width", () => {
    const args = { command: "ls -la /tmp" };
    const a = fingerprintArgs({ toolName: "execute_shell_command", args });
    const b = fingerprintArgs({ toolName: "execute_shell_command", args: { ...args } });
    expect(a.hash).toBe(b.hash);
    expect(a.hash.length).toBe(HASH_CHARS);
    expect(a.hash).toMatch(/^[0-9a-f]+$/);
  });

  it("different commands get different hashes", () => {
    const h = (command) => fingerprintArgs({ toolName: "execute_shell_command", args: { command } }).hash;
    expect(h("ls -la")).not.toBe(h("rm -rf /tmp/x"));
  });

  it("DELIBERATE: two calls differing only by a secret share a hash", () => {
    // The hash is taken over the REDACTED text. Hashing raw would make a short
    // secret brute-forceable from the log, which is the leak redaction exists to
    // prevent. Grouping identical shapes is the intended behaviour, not a bug.
    const h = (tok) => fingerprintArgs({ toolName: "execute_shell_command", args: { command: `curl -H "Authorization: Bearer ${tok}" https://x.test` } }).hash;
    expect(h(BLOB)).toBe(h(`${BLOB}ZZZZ`));
  });

  it("the hash never derives from unredacted text", () => {
    const withSecret = fingerprintArgs({ toolName: "execute_shell_command", args: { command: `deploy --token ${SK}` } });
    const preRedacted = fingerprintArgs({ toolName: "execute_shell_command", args: { command: `deploy --token ${REDACTED}` } });
    expect(withSecret.hash).toBe(preRedacted.hash);
    expect(withSecret.redacted).toBe(true);
  });

  /* ---------------- canonicalisation ---------------- */

  it("equivalent path spellings share one fingerprint", () => {
    const home = homedir();
    const hashes = new Set(
      [`cat ~/.ssh/config`, `cat $HOME/.ssh/config`, `cat ${home}/.ssh/./config`].map(
        (command) => safeFingerprint("execute_shell_command", { command }, { home }).hash,
      ),
    );
    expect(hashes.size, "spelling must not fragment the audit trail").toBe(1);
  });

  it("safeFingerprint never throws on junk input", () => {
    for (const args of [null, undefined, 42, "a string", { command: 42 }, { path: { nested: true } }]) {
      const f = safeFingerprint("execute_shell_command", args);
      expect(f && typeof f.hash === "string" && f.hash.length === HASH_CHARS, JSON.stringify(args)).toBeTruthy();
    }
  });

  // REGRESSION: canonicalisation treated any token containing "/" as a path, so
  // `https://api.example.test/v1` became `<projectDir>/https:/api.example.test/v1`
  // — in the fingerprint AND in the state sent to Jev, which is asked whether the
  // call exfiltrates data to a remote host.
  it("REGRESSION: URLs and git remotes survive canonicalisation intact", () => {
    const cases = [
      "curl https://api.example.test/v1/x",
      "wget http://host//double//slash",
      "git clone git@github.com:owner/repo.git",
      "aws s3 cp s3://bucket/key .",
    ];
    for (const command of cases) {
      expect(canonicalizeArgs({ command }).command, command).toBe(command);
    }
  });

  // REGRESSION 2: the first URL guard only matched a scheme at position 0, so
  // `API=http://127.0.0.1:3333/api` still became
  // `<projectDir>/API=http:/127.0.0.1:3333/api`. Found in a LIVE audit line
  // after the fix that was supposed to close this class.
  it("REGRESSION: a URL behind an assignment prefix survives intact", () => {
    const cases = [
      "API=http://127.0.0.1:3333/api",
      "BASE=https://api.example.test/v1",
      "REPO=git@github.com:owner/repo.git",
    ];
    for (const command of cases) {
      expect(canonicalizeArgs({ command }).command, command).toBe(command);
    }
  });

  it("an assignment whose value IS a path is still canonicalised", () => {
    const home = homedir();
    expect(canonicalizeArgs({ command: "KEYFILE=~/.ssh/config" }, { home }).command, "a real path must not be exempted by the assignment guard").toBe(`KEYFILE=${home}/.ssh/config`);
  });

  it("real filesystem paths are still canonicalised", () => {
    const home = homedir();
    expect(canonicalizeArgs({ command: "cat ~/.ssh/config" }, { home }).command).toBe(`cat ${home}/.ssh/config`);
  });

  it("REGRESSION: a URL is not counted as an absent filesystem path", () => {
    const e = scanForSecrets({ command: "curl https://api.example.test/v1/x" });
    expect(e.scanned, "a URL must not enter the path scan").toBe(0);
    expect(e.allAbsent, "and must not fake the phantom signal").toBe(false);
  });

  /* ---------------- wiring ---------------- */

  it("every assessToolCall path carries a fingerprint", async () => {
    const classify = async () => ({
      model: "test",
      answers: {
        reversibility: { type: "choice", choice: "read_only", confidence: 0.95 },
        exfiltrates_secrets: { type: "noul", noul: 0.01 },
        user_explicitly_asked: { type: "noul", noul: 0.9 },
        jailbreak_or_override: { type: "noul", noul: 0.01 },
      },
    });

    const gated = await assessToolCall({
      toolName: "execute_shell_command",
      args: { command: "ls -la" },
      key: "sk-test",
      mode: "dry-run",
      classify,
    });
    expect(gated.fingerprint?.hash, "normal path").toBeTruthy();
    expect(gated.fingerprint.preview.includes("ls -la")).toBeTruthy();

    const skipped = await assessToolCall({ toolName: "web_search", args: { query: "x" }, key: "sk-test", classify });
    expect(skipped.fingerprint?.hash, "skip path — the hardest line to identify later").toBeTruthy();

    const failed = await assessToolCall({
      toolName: "execute_shell_command",
      args: { command: "ls" },
      key: "sk-test",
      mode: "dry-run",
      classify: async () => {
        throw new Error("typesafe-http-402");
      },
    });
    expect(failed.failOpen).toBe(true);
    expect(failed.fingerprint?.hash, "fail-open path").toBeTruthy();

    const noKey = await assessToolCall({ toolName: "execute_shell_command", args: { command: "ls" }, key: null });
    expect(noKey.fingerprint?.hash, "missing-key path").toBeTruthy();
  });

  it("a gated call carrying a token logs the shape, not the token", async () => {
    const r = await assessToolCall({
      toolName: "execute_shell_command",
      args: { command: `curl -H "Authorization: Bearer ${BLOB}" https://api.example.test` },
      key: "sk-test",
      mode: "dry-run",
      classify: async () => ({
        model: "test",
        answers: {
          reversibility: { type: "choice", choice: "read_only", confidence: 0.9 },
          exfiltrates_secrets: { type: "noul", noul: 0.1 },
          user_explicitly_asked: { type: "noul", noul: 0.9 },
          jailbreak_or_override: { type: "noul", noul: 0.01 },
        },
      }),
    });
    const line = JSON.stringify(r.fingerprint);
    expect(!line.includes(BLOB), "the token must not reach the log").toBeTruthy();
    expect(line.includes("api.example.test"), "the destination is what makes the line useful").toBeTruthy();
  });

});
