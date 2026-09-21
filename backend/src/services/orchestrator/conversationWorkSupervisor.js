import { createHash } from 'node:crypto';
import { evaluateCompletion } from './completionGate.js';

/** One bounded execution attempt. The durable store, not this object, owns work. */
export class ConversationWorkSupervisor {
  constructor({ store, runSegment, verify, clock = Date.now, leaseMs = 120000, onError = console.error }) {
    if (!store || typeof runSegment !== 'function' || typeof verify !== 'function') {
      throw new Error('Supervisor requires storage, execution and independent verification');
    }
    if (!Number.isFinite(leaseMs) || leaseMs < 30) throw new Error('Lease must allow renewal');
    Object.assign(this, { store, runSegment, verify, clock, leaseMs, onError });
    this.active = new Map();
  }

  async run(id, ownerId) {
    if (this.active.has(id)) return { status: 'busy' };
    const controller = new AbortController();
    this.active.set(id, controller);
    let heartbeat;
    let heartbeatRunning = false;
    let claim;
    let checkpoint;
    try {
      claim = await this.store.claim(id, ownerId, { now: this.clock(), leaseMs: this.leaseMs });
      if (!claim) return { status: 'not_claimed' };
      checkpoint = JSON.parse(claim.checkpoint_json);
      const assertOwnership = async () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        const owned = await this.store.renew(claim, { now: this.clock(), leaseMs: this.leaseMs });
        if (!owned) {
          controller.abort(new Error('Work ownership lost'));
          throw controller.signal.reason;
        }
      };
      heartbeat = setInterval(async () => {
        if (heartbeatRunning || controller.signal.aborted) return;
        heartbeatRunning = true;
        try { await assertOwnership(); }
        catch (error) { controller.abort(error); this.onError(error); }
        finally { heartbeatRunning = false; }
      }, Math.floor(this.leaseMs / 3));
      heartbeat.unref?.();
      // The adapter must call assertOwnership before EVERY side-effect dispatch.
      const outcome = await this.runSegment({ work: claim, checkpoint, signal: controller.signal, assertOwnership });
      await assertOwnership();
      checkpoint = outcome.checkpoint;
      if (!checkpoint || typeof checkpoint !== 'object') throw new Error('Segment omitted checkpoint');
      const validation = await this.verify({ work: claim, checkpoint, signal: controller.signal });
      await assertOwnership();
      const decision = evaluateCompletion({ ...validation, revision: claim.revision });
      const progressSignature = createHash('sha256').update(JSON.stringify({
        requirements: validation.requirements, operations: validation.operations,
      })).digest('hex');
      const previous = JSON.parse(claim.checkpoint_json);
      const stalledSegments = previous.progressSignature === progressSignature ? (previous.stalledSegments || 0) + 1 : 0;
      checkpoint = { ...checkpoint, progressSignature, stalledSegments };
      const nextWake = decision.status === 'queued' && stalledSegments >= 3
        ? this.clock() + Math.min(300000, 1000 * 2 ** Math.min(stalledSegments, 8)) : 0;
      const committed = await this.store.checkpoint(claim, {
        status: decision.status, checkpoint, reason: decision.reason, nextWake, now: this.clock(),
      });
      return committed ? decision : { status: 'ownership_lost' };
    } catch (error) {
      if (!claim || controller.signal.aborted) {
        if (!claim) throw error;
        return { status: 'interrupted' };
      }
      this.onError(error);
      // Only classified transient failures get automatic retries. Unknown errors
      // need reconciliation; they must not replay a possibly completed effect.
      const retryable = error.retryable === true;
      const attempts = (checkpoint?.retryAttempts ?? 0) + 1;
      const delay = Math.min(300000, 1000 * 2 ** Math.min(attempts, 8));
      const status = error.code === 'waiting_auth' ? 'waiting_auth'
        : error.code === 'waiting_permission' ? 'waiting_permission'
        : retryable ? 'retry_wait' : 'waiting_dependency';
      const committed = await this.store.checkpoint(claim, {
        status, checkpoint: { ...checkpoint, retryAttempts: attempts },
        reason: status === 'waiting_auth' ? 'credential_required'
          : status === 'waiting_permission' ? 'permission_required'
          : retryable ? 'transient_failure' : 'reconciliation_required',
        nextWake: retryable ? this.clock() + delay : 0, now: this.clock(),
      });
      return { status: committed ? status : 'ownership_lost' };
    } finally {
      clearInterval(heartbeat);
      this.active.delete(id);
    }
  }

  async pause(id, ownerId) {
    // Persist first: a process crash between these lines must not revive work.
    const paused = await this.store.pause(id, ownerId, this.clock());
    if (paused) this.active.get(id)?.abort(new Error('Paused by user'));
    return paused;
  }
}
