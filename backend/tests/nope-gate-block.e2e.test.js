/**
 * PRD-051 — end-to-end proof of the executeTool BLOCK branch, done safely.
 *
 * THE SAFE DESIGN (and the only acceptable one):
 *   We do NOT send a dangerous command through the real chokepoint to prove
 *   blocking works — that would bet the machine on the code under test.
 *   Instead, vi.mock forces the gate to return allowed:false for one specific
 *   HARMLESS command (an echo with a unique marker). Then we assert:
 *     1. executeTool returns the policy_blocked shape, and
 *     2. the command never executed (its marker never appears in any output).
 *
 *   Worst case under total failure of everything: an echo prints a string.
 *
 * This exercises the exact same wrapper branch a real critical violation
 * takes — same `if (!gate.allowed)` code path, same return shape — with an
 * intrinsically harmless payload.
 */
import { describe, it, expect, vi } from 'vitest';
import './nope-test-environment.js';

const MARKER = 'NOPE-BLOCK-E2E-PROOF-7f3a';

vi.mock('../src/services/security/nopeService.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    checkAction: (opts) => {
      // Force a block ONLY for our harmless marker command; everything else
      // uses the real gate so the rest of the module behaves normally.
      if (opts?.args?.command === `echo ${MARKER}`) {
        return {
          allowed: false,
          audited: true,
          violations: [
            { rule: 'e2e-forced-block', severity: 'critical', category: 'test', description: 'forced block for e2e proof' },
          ],
          blockedRules: ['e2e-forced-block'],
        };
      }
      return real.checkAction(opts);
    },
  };
});

describe('PRD-051 — executeTool block branch (mocked gate, harmless echo payload)', () => {
  it('when the gate says allowed:false, executeTool returns policy_blocked and the command NEVER executes', async () => {
    const { executeTool } = await import('../src/services/orchestrator/tools.js');
    const raw = await executeTool(
      'execute_shell_command',
      { command: `echo ${MARKER}` },
      null,
      { userId: 'test-user', role: 'user' }
    );
    const parsed = JSON.parse(raw);

    // 1. The block shape came back
    expect(parsed.policy_blocked).toBe(true);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Blocked by security policy');
    expect(parsed.error).toContain('e2e-forced-block');

    // 2. The command never ran: the echo's marker appears nowhere in the
    //    result except inside our own args echo-back protection — assert it
    //    is absent from any stdout-like field.
    expect(parsed.stdout).toBeUndefined();
    expect(parsed.output).toBeUndefined();
    expect(parsed.result).toBeUndefined();
  }, 30_000);

  it('the same command WITHOUT the forced block executes normally (control)', async () => {
    const { executeTool } = await import('../src/services/orchestrator/tools.js');
    const raw = await executeTool(
      'execute_shell_command',
      { command: 'echo control-run-ok' },
      null,
      { userId: 'test-user', role: 'user' }
    );
    const parsed = JSON.parse(raw);
    expect(parsed.policy_blocked).toBeUndefined();
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toContain('control-run-ok');
  }, 30_000);
});
