/**
 * Circuit breaker pattern
 * Prevents repeated attempts to failing services
 */
class Circuit {
  constructor({ failureThreshold = 5, cooldownMs = 30000 } = {}) {
    this.failures = 0;
    this.openUntil = 0;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
  }

  canAttempt() {
    return Date.now() >= this.openUntil;
  }

  recordSuccess() {
    this.failures = 0;
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.openUntil = Date.now() + this.cooldownMs;
      this.failures = 0;
    }
  }
}

export default Circuit;
