/**
 * Exponential backoff with jitter
 * Used for retry logic with increasing delays
 */
class Backoff {
  constructor({ baseMs = 250, maxMs = 30000, factor = 2, jitter = 0.25 } = {}) {
    this.base = baseMs;
    this.max = maxMs;
    this.factor = factor;
    this.jitter = jitter;
    this.attempt = 0;
  }

  nextDelay() {
    const raw = Math.min(this.max, this.base * Math.pow(this.factor, this.attempt++));
    const jitterAmount = raw * this.jitter * (Math.random() * 2 - 1);
    return Math.max(0, raw + jitterAmount);
  }

  reset() {
    this.attempt = 0;
  }
}

export default Backoff;
