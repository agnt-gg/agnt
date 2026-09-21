import { callService } from './agntServices.js';

/**
 * Bounded jobs on sandbox.agnt.gg: upload inputs, run one command in a fresh
 * VM, export named outputs, destroy the VM. Completion is reported only after
 * teardown, so a finished job has nothing left running.
 *
 * Spending is opt-in. `maxChargeMicroUSD` defaults to 0, which lets the job use
 * only the plan's included compute-minutes; a caller that wants to draw on
 * prepaid balance must say how much. There is no automatic card charge anywhere
 * in this path.
 */
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export async function runJob({ command, inputs = [], outputs = [], lifetimeSeconds = 120, size = 'small', maxChargeMicroUSD = 0, pollMs = 2000, timeoutMs }) {
  if (!command || typeof command !== 'string') throw new Error('command is required');
  const body = {
    command,
    lifetimeSeconds: Math.max(10, Math.min(900, Number(lifetimeSeconds) || 120)),
    maxChargeMicroUSD: Math.max(0, Number(maxChargeMicroUSD) || 0),
  };
  if (size && size !== 'small') body.size = size;
  if (inputs.length) body.inputs = inputs.map((i) => ({ path: i.path, base64: i.base64 ?? Buffer.from(String(i.content ?? ''), 'utf8').toString('base64') }));
  if (outputs.length) body.outputs = outputs;

  const job = await callService('sandbox', '/jobs', { method: 'POST', idempotent: true, body });
  const deadline = Date.now() + (timeoutMs || (body.lifetimeSeconds + 90) * 1000);
  let current = job;
  while (!TERMINAL.has(current.state)) {
    if (Date.now() > deadline) throw new Error(`sandbox job ${job.id} did not finish within the deadline (last state: ${current.state})`);
    await new Promise((r) => setTimeout(r, pollMs));
    current = await callService('sandbox', `/jobs/${job.id}`);
  }
  return current;
}

/** Download one exported artifact as a UTF-8 string (callers decide what to do with binary). */
export async function readArtifact(jobId, artifactId) {
  return callService('sandbox', `/jobs/${jobId}/artifacts/${artifactId}`);
}

/** Flatten a finished job into what a tool caller wants to see. */
export function summarizeJob(job) {
  // Shape as served: { state, error, execution: { exit_code, output: { exitCode, output, truncated, timedOut } }, artifacts: [{ id, path }], usage }
  const run = job.execution?.output || {};
  const exitCode = run.exitCode ?? job.execution?.exit_code ?? null;
  return {
    success: job.state === 'completed' && exitCode === 0,
    jobId: job.id,
    state: job.state,
    exitCode,
    output: run.output ?? '',
    truncated: !!run.truncated,
    timedOut: !!run.timedOut,
    artifacts: (job.artifacts || []).map((a) => ({ id: a.id, path: a.path })),
    usage: job.usage ? { minutesUsed: job.usage.actual_units, includedMinutes: job.usage.included_units, chargedMicroUSD: job.usage.chargedMicroUSD } : undefined,
    error: job.state === 'completed' ? null : job.error || job.state,
  };
}
