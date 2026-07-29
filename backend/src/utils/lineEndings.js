/**
 * Line-ending reconciliation for every path that writes text to disk.
 *
 * WHY THIS EXISTS
 * ---------------
 * `edit_file` learned to preserve a file's line endings in 2026-07-25. Nothing
 * else did. Measured against the real tool code on 2026-07-29, 4 of 8 behaviours
 * were wrong:
 *
 *   - `write_file` over an existing CRLF file rewrote the WHOLE file to LF.
 *     A one-line change to OrchestratorService.js restyled 3,654 lines.
 *   - `edit_file` on an already-mixed file left it mixed, forever. Its EOL
 *     coercion is a majority vote taken per call, so it perpetuates damage it
 *     could trivially repair.
 *   - Nothing anywhere parsed `.gitattributes`, so a repo that declares its own
 *     convention was ignored by every writer.
 *
 * The compounding case is the expensive one. `edit_file` inserts new lines with
 * the file's dominant EOL, but a `write_file` in between flips the file, and the
 * next edit's dominant vote flips back. Twenty files in agnt-pro are now
 * internally mixed — OrchestratorService.js at 3654 CRLF / 15 LF, Chat.vue at
 * 2926 / 32. Those LF counts are the patch hunks. A patch script that does
 * `detectEol(file)` once then builds a multi-line anchor silently matches ZERO
 * in the other half of the file, which is indistinguishable from a wrong anchor.
 *
 * WHY DETECTION IS PER-FILE AND NEVER `os.EOL`
 * -------------------------------------------
 * AGNT runs on Windows, macOS, Linux, inside Docker (Dockerfile, Dockerfile.lite)
 * and against a remote backend over the Connection feature. In the last two the
 * process OS and the file's OS are routinely different: a Linux container
 * bind-mounting a Windows checkout has `os.EOL === '\n'` and CRLF files. The
 * convention is a property of the FILE, not of the host, so it is read from the
 * bytes. That answer is identical on all six deployment surfaces.
 *
 * There is deliberately no `os.EOL` anywhere in this module, and a guard test
 * (lineEndings.contract.test.js) keeps it out of every write path.
 *
 * THE CONTRACT
 * ------------
 * `reconcile(existing, incoming, { policy })` decides the bytes that hit disk:
 *
 *   file absent      -> policy if the repo declares one, else incoming verbatim
 *   uniform CRLF/LF  -> EXISTING WINS; incoming is coerced to match
 *   mixed            -> heal the entire file to its dominant ending
 *   no line breaks   -> policy if any, else incoming verbatim
 *   binary marker    -> untouched, byte for byte
 *
 * Two choices worth defending:
 *
 * 1. Existing convention beats repo policy for a file that is already uniform.
 *    Letting `eol=lf` force-rewrite a CRLF working file would turn every edit
 *    into a whole-file restyle — exactly the bug being fixed, just with better
 *    manners. Bulk convergence is an explicit command (scripts/normalize-eol.mjs),
 *    never a side effect of editing.
 *
 * 2. Mixed always heals. There is no legitimate mixed-EOL source file; it is
 *    pure accumulated damage. Under `* text=auto eol=lf` git's clean filter
 *    normalises the blob anyway, so healing costs zero diff noise and removes
 *    the condition that breaks anchored patching.
 */

import fs from 'fs/promises';
import { resolveEolPolicy } from './gitAttributes.js';

/**
 * Bytes scanned when sniffing a file's convention.
 *
 * 64 KiB is far past any realistic header and keeps a multi-GB log cheap. Safe
 * for the overwrite path too: the whole file is being replaced, so whatever the
 * prefix says, the RESULT is uniform either way.
 */
export const SNIFF_BYTES = 64 * 1024;

/** Count CRLF and bare-LF occurrences. The lookbehind is what makes them disjoint. */
export function countEol(text) {
  if (typeof text !== 'string' || text.length === 0) return { crlf: 0, lf: 0 };
  return {
    crlf: (text.match(/\r\n/g) || []).length,
    lf: (text.match(/(?<!\r)\n/g) || []).length,
  };
}

/**
 * 'crlf' | 'lf' | 'mixed' | 'none'
 *
 * 'none' means the text has no line breaks at all, which is a genuinely
 * different situation from "we could not tell" and must not be conflated with
 * either convention.
 */
export function classify(text) {
  const { crlf, lf } = countEol(text);
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf > 0) return 'mixed';
  return crlf > 0 ? 'crlf' : 'lf';
}

/**
 * The file's line ending, or null when it has none.
 * A mixed file reports its DOMINANT ending — see dominantEol for the tie rule.
 */
export function detectEol(text) {
  const kind = classify(text);
  if (kind === 'none') return null;
  if (kind === 'crlf') return '\r\n';
  if (kind === 'lf') return '\n';
  return dominantEol(text);
}

/**
 * Majority ending of a mixed file. Ties resolve to LF.
 *
 * A tie is vanishingly rare and LF is the safe direction: every platform AGNT
 * targets reads LF correctly, and every repo here declares `eol=lf`.
 */
export function dominantEol(text) {
  const { crlf, lf } = countEol(text);
  if (crlf === 0 && lf === 0) return null;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * Rewrite every line ending in `text` to `eol`.
 *
 * Two-step (collapse to LF, then expand) so the function is idempotent and
 * cannot produce \r\r\n by double-application — the classic bug in naive
 * `replace(/\n/g, '\r\n')`.
 */
export function applyEol(text, eol) {
  if (typeof text !== 'string' || !eol) return text;
  const lf = text.replace(/\r\n/g, '\n');
  return eol === '\n' ? lf : lf.replace(/\n/g, eol);
}

/**
 * A NUL byte in decoded text means this was never text.
 *
 * Rewriting line endings inside a binary corrupts it silently, so anything
 * carrying this marker is passed through untouched. Scoped to a prefix because
 * the decision only needs the first block and the file may be large.
 */
export function hasBinaryMarker(text) {
  if (typeof text !== 'string') return false;
  const head = text.length > 8192 ? text.slice(0, 8192) : text;
  return head.includes('\u0000');
}

/**
 * Decide the bytes to write.
 *
 * @param {string|null|undefined} existing  Current file content, null if absent.
 * @param {string} incoming                 Content the caller wants written.
 * @param {object} [opts]
 * @param {'\r\n'|'\n'|null} [opts.policy]  Repo-declared ending, if any.
 * @returns {{ content: string, eol: string|null, action: string, healed: boolean }}
 *
 * `action` is reported rather than logged so callers can surface it in a tool
 * result. A silent whole-file rewrite is precisely the failure mode this module
 * exists to end; a silent whole-file HEAL would be the same mistake wearing a
 * better hat.
 */
export function reconcile(existing, incoming, { policy = null } = {}) {
  if (typeof incoming !== 'string') {
    return { content: incoming, eol: null, action: 'not-text', healed: false };
  }
  if (hasBinaryMarker(incoming) || (typeof existing === 'string' && hasBinaryMarker(existing))) {
    return { content: incoming, eol: null, action: 'binary-untouched', healed: false };
  }

  const exists = typeof existing === 'string';

  if (!exists) {
    if (policy) {
      return { content: applyEol(incoming, policy), eol: policy, action: 'new-file-policy', healed: false };
    }
    // No file and no declared convention: the caller's own bytes are the only
    // signal there is. Heal them if they are self-inconsistent.
    if (classify(incoming) === 'mixed') {
      const eol = dominantEol(incoming);
      return { content: applyEol(incoming, eol), eol, action: 'new-file-healed', healed: true };
    }
    return { content: incoming, eol: detectEol(incoming), action: 'new-file-verbatim', healed: false };
  }

  const kind = classify(existing);

  if (kind === 'mixed') {
    const eol = dominantEol(existing);
    return { content: applyEol(incoming, eol), eol, action: 'healed-mixed', healed: true };
  }

  if (kind === 'crlf' || kind === 'lf') {
    const eol = kind === 'crlf' ? '\r\n' : '\n';
    const already = classify(incoming) === kind;
    return {
      content: already ? incoming : applyEol(incoming, eol),
      eol,
      action: already ? 'matched-existing' : 'coerced-to-existing',
      healed: false,
    };
  }

  // Existing file has no line breaks (empty, or a single line). It carries no
  // convention to preserve, so the repo's policy is the next best signal.
  if (policy) {
    return { content: applyEol(incoming, policy), eol: policy, action: 'no-signal-policy', healed: false };
  }
  if (classify(incoming) === 'mixed') {
    const eol = dominantEol(incoming);
    return { content: applyEol(incoming, eol), eol, action: 'no-signal-healed', healed: true };
  }
  return { content: incoming, eol: detectEol(incoming), action: 'no-signal-verbatim', healed: false };
}

/**
 * Coerce a chunk to a file's existing ending without reading the whole file.
 *
 * For append: the file may be a multi-GB log, and the only question is which
 * ending its lines already use. `SNIFF_BYTES` of prefix answers that.
 */
export function reconcileAppend(existingHead, incoming, { policy = null } = {}) {
  if (typeof incoming !== 'string') return { content: incoming, eol: null, action: 'not-text' };
  if (hasBinaryMarker(incoming)) return { content: incoming, eol: null, action: 'binary-untouched' };

  const eol = (typeof existingHead === 'string' ? detectEol(existingHead) : null) || policy;
  if (!eol) return { content: incoming, eol: null, action: 'no-signal-verbatim' };
  return { content: applyEol(incoming, eol), eol, action: 'coerced-to-existing' };
}

// ------------------------------------------------------------- the seam ---

/**
 * Read at most `SNIFF_BYTES` from the head of a file.
 *
 * Returns null when the file does not exist, which `reconcile` reads as "new
 * file". Any other error also yields null: a failed sniff must degrade to
 * "write the caller's bytes", never to a failed write.
 */
async function sniffHead(absPath) {
  let handle;
  try {
    handle = await fs.open(absPath, 'r');
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * THE single entry point for writing text to disk.
 *
 * Every text write boundary in AGNT calls this and writes `result.content`
 * instead of the caller's raw string. A source-contract test
 * (lineEndings.contract.test.js) fails the build if a new one does not, because
 * the original defect was never bad logic — it was correct logic wired into one
 * of several write paths while the rest quietly diverged.
 *
 * @param {string} absPath              Destination, already validated.
 * @param {string} incoming             Content the caller wants written.
 * @param {object} [opts]
 * @param {'overwrite'|'append'} [opts.mode]
 * @param {string|null} [opts.existing] Current content if the caller already
 *                                      holds it, sparing a re-read. Pass null
 *                                      to assert the file is new.
 * @returns {Promise<{content, eol, action, healed}>}
 */
export async function prepareWrite(absPath, incoming, { mode = 'overwrite', existing } = {}) {
  const policy = await resolveEolPolicy(absPath);

  if (mode === 'append') {
    const head = existing === undefined ? await sniffHead(absPath) : existing;
    return { healed: false, ...reconcileAppend(head, incoming, { policy }) };
  }

  const current = existing === undefined ? await sniffHead(absPath) : existing;
  return reconcile(current, incoming, { policy });
}
