/** Bounded admissions; the database holds wake times and survives this timer. */
export class ConversationWorkScheduler {
  constructor({ store, supervisor, concurrency = 1, intervalMs = 1000, clock = Date.now, onError = console.error }) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid concurrency');
    if (!Number.isFinite(intervalMs) || intervalMs < 10) throw new Error('Invalid interval');
    Object.assign(this, { store, supervisor, concurrency, intervalMs, clock, onError });
    this.pending = new Set();
    this.admitting = false;
    this.admissionFinished = Promise.resolve();
    this.stopped = true;
    this.timer = null;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { this.tick().catch(this.onError); }, this.intervalMs);
    this.timer.unref?.();
    this.tick().catch(this.onError);
  }
  async tick() {
    if (this.stopped || this.admitting || this.pending.size >= this.concurrency) return;
    this.admitting = true;
    let finishAdmission;
    this.admissionFinished = new Promise(resolve => { finishAdmission = resolve; });
    try {
      const due = await this.store.due({ now: this.clock(), limit: this.concurrency - this.pending.size });
      for (const work of due) {
        if (this.stopped) break;
        const execution = this.supervisor.run(work.id, work.owner_id);
        this.pending.add(execution);
        execution.catch(this.onError).finally(() => this.pending.delete(execution));
      }
    } finally { this.admitting = false; finishAdmission(); }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
  }
  async drain() {
    this.stop();
    await this.admissionFinished;
    await Promise.allSettled([...this.pending]);
  }
}
