/**
 * Behavioral verification for goal pause/stop cancellation.
 * Tests abortUtils directly, plus a simulation of the executeWithTools
 * multi-round loop pattern to prove abort unblocks mid-"LLM call".
 */
import { raceWithAbort, GoalCancelledError, isCancellationError } from './src/utils/abortUtils.js';

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Test 1: normal resolution passes through ----
{
  const ac = new AbortController();
  const v = await raceWithAbort(() => Promise.resolve(42), ac.signal);
  assert(v === 42, 'resolves normally when not aborted');
}

// ---- Test 2: normal rejection passes through ----
{
  const ac = new AbortController();
  let caught = null;
  try { await raceWithAbort(() => Promise.reject(new Error('provider 500')), ac.signal); }
  catch (e) { caught = e; }
  assert(caught?.message === 'provider 500', 'original rejection passes through');
  assert(!isCancellationError(caught), 'provider error is NOT classified as cancellation');
}

// ---- Test 3: abort mid-flight unblocks immediately (the core pause fix) ----
{
  const ac = new AbortController();
  const slowLlmCall = () => sleep(5000).then(() => 'should never be seen');
  const t0 = Date.now();
  setTimeout(() => ac.abort(new GoalCancelledError('goal-123', 'paused')), 50);
  let caught = null;
  try { await raceWithAbort(slowLlmCall, ac.signal); } catch (e) { caught = e; }
  const elapsed = Date.now() - t0;
  assert(caught instanceof GoalCancelledError, 'abort rejects with GoalCancelledError');
  assert(caught?.reason === 'paused', 'cancellation reason is preserved (paused)');
  assert(elapsed < 1000, `unblocks in ${elapsed}ms, not 5000ms (was: uninterruptible)`);
  assert(isCancellationError(caught), 'isCancellationError recognizes GoalCancelledError');
}

// ---- Test 4: already-aborted signal never fires the factory (no doomed HTTP call) ----
{
  const ac = new AbortController();
  ac.abort(new GoalCancelledError('goal-456', 'stopped'));
  let factoryFired = false;
  let caught = null;
  try {
    await raceWithAbort(() => { factoryFired = true; return sleep(1000); }, ac.signal);
  } catch (e) { caught = e; }
  assert(!factoryFired, 'factory never invoked when signal already aborted');
  assert(caught?.reason === 'stopped', 'stop reason preserved');
}

// ---- Test 5: no signal = plain passthrough ----
{
  const v = await raceWithAbort(() => Promise.resolve('ok'), null);
  assert(v === 'ok', 'null signal runs unwrapped');
}

// ---- Test 6: orphaned promise rejection after abort does NOT crash process ----
{
  const ac = new AbortController();
  const orphan = () => sleep(100).then(() => { throw new Error('late failure from abandoned call'); });
  setTimeout(() => ac.abort(new GoalCancelledError('goal-789', 'stopped')), 10);
  try { await raceWithAbort(orphan, ac.signal); } catch { /* expected */ }
  await sleep(200); // if the orphan's rejection were unhandled, node would emit unhandledRejection
  assert(true, 'orphaned rejection swallowed (no unhandledRejection crash)');
}

// ---- Test 7: simulate the executeWithTools multi-round loop ----
{
  const ac = new AbortController();
  let roundsExecuted = 0;
  const fakeAdapterCall = () => sleep(80).then(() => { roundsExecuted++; return { toolCalls: [1] }; });

  const loop = (async () => {
    // mirrors executeWithTools: initial call + up to 10 rounds, each raced
    await raceWithAbort(fakeAdapterCall, ac.signal);
    for (let round = 0; round < 10; round++) {
      await raceWithAbort(fakeAdapterCall, ac.signal);
    }
    return 'completed all rounds';
  })();

  // pause after ~2 rounds worth of time
  setTimeout(() => ac.abort(new GoalCancelledError('goal-loop', 'paused')), 200);

  let caught = null;
  try { await loop; } catch (e) { caught = e; }
  await sleep(150);
  assert(isCancellationError(caught), 'multi-round loop rejects on pause');
  assert(roundsExecuted <= 4, `only ${roundsExecuted} rounds ran before pause (not all 11)`);
}

process.on('unhandledRejection', (e) => {
  failed++;
  console.error('  FAIL: unhandledRejection leaked:', e.message);
});

await sleep(100);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
