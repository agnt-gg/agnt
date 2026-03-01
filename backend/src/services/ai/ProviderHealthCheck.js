import fetch from 'node-fetch';
import { getAllProviderConfigs } from './providerConfigs.js';

/**
 * Lightweight provider health check system.
 * Periodically pings each provider's /models endpoint and tracks status.
 *
 * Health states:
 * - 'healthy':   Last check succeeded and response time <= 5s
 * - 'degraded':  Last check succeeded but response time > 5s
 * - 'unhealthy': Last check failed
 * - 'unknown':   Not yet checked
 */
class ProviderHealthCheck {
  constructor() {
    this.status = new Map();
    this.monitorInterval = null;
    this.consecutiveFailures = new Map();

    // Initialize status for all providers
    for (const config of getAllProviderConfigs()) {
      if (!config.staticModels) {
        this.status.set(config.key, {
          status: 'unknown',
          lastCheck: null,
          responseMs: null,
          error: null,
        });
        this.consecutiveFailures.set(config.key, 0);
      }
    }
  }

  /**
   * Run a single health check for one provider.
   */
  async checkProvider(key, apiKey) {
    const configs = getAllProviderConfigs();
    const config = configs.find((c) => c.key === key);
    if (!config || config.staticModels) return null;

    const startTime = Date.now();

    try {
      const url = new URL(`${config.baseURL}${config.modelsPath || '/models'}`);
      const headers = { 'Content-Type': 'application/json' };

      if (config.authScheme === 'query-param') {
        url.searchParams.append('key', apiKey);
      } else if (config.authScheme === 'api-key') {
        headers['x-api-key'] = apiKey;
        if (config.fetchHeaders) Object.assign(headers, config.fetchHeaders);
      } else if (config.authScheme === 'bearer') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      const responseMs = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const healthStatus = responseMs > 5000 ? 'degraded' : 'healthy';

      this.consecutiveFailures.set(key, 0);
      const result = {
        status: healthStatus,
        lastCheck: new Date().toISOString(),
        responseMs,
        error: null,
      };

      this.status.set(key, result);
      return result;
    } catch (error) {
      const responseMs = Date.now() - startTime;
      const failures = (this.consecutiveFailures.get(key) || 0) + 1;
      this.consecutiveFailures.set(key, failures);

      if (failures >= 3) {
        console.warn(`[ProviderHealth] ${config.name} has failed ${failures} consecutive health checks: ${error.message}`);
      }

      const result = {
        status: 'unhealthy',
        lastCheck: new Date().toISOString(),
        responseMs,
        error: error.message,
      };

      this.status.set(key, result);
      return result;
    }
  }

  /**
   * Run health checks for all providers.
   * @param {Function} getApiKeyFn - async (providerKey) => apiKey | null
   */
  async checkAll(getApiKeyFn) {
    const configs = getAllProviderConfigs().filter((c) => !c.staticModels);
    const results = {};

    // Run checks in parallel (with concurrency limit)
    const concurrency = 5;
    for (let i = 0; i < configs.length; i += concurrency) {
      const batch = configs.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (config) => {
          try {
            const apiKey = await getApiKeyFn(config.key);
            if (apiKey) {
              results[config.key] = await this.checkProvider(config.key, apiKey);
            } else {
              results[config.key] = {
                status: 'unknown',
                lastCheck: new Date().toISOString(),
                responseMs: null,
                error: 'No API key available',
              };
              this.status.set(config.key, results[config.key]);
            }
          } catch (error) {
            results[config.key] = {
              status: 'unhealthy',
              lastCheck: new Date().toISOString(),
              responseMs: null,
              error: error.message,
            };
            this.status.set(config.key, results[config.key]);
          }
        }),
      );
    }

    return results;
  }

  /**
   * Get current health status for all providers.
   */
  getStatus() {
    const result = {};
    for (const [key, value] of this.status) {
      result[key] = { ...value };
    }
    return result;
  }

  /**
   * Get a summary of provider health.
   */
  getSummary() {
    const statuses = [...this.status.values()];
    const healthy = statuses.filter((s) => s.status === 'healthy').length;
    const degraded = statuses.filter((s) => s.status === 'degraded').length;
    const unhealthy = statuses.filter((s) => s.status === 'unhealthy').length;
    const unknown = statuses.filter((s) => s.status === 'unknown').length;

    let overall = 'healthy';
    if (unhealthy > 0 && healthy === 0) overall = 'critical';
    else if (unhealthy > 0 || degraded > 0) overall = 'degraded';
    else if (unknown === statuses.length) overall = 'unknown';

    return { overall, healthy, degraded, unhealthy, unknown, total: statuses.length };
  }

  /**
   * Start periodic health monitoring.
   * @param {Function} getApiKeyFn - async (providerKey) => apiKey | null
   * @param {number} intervalMs - Check interval (default: 5 minutes)
   */
  startMonitoring(getApiKeyFn, intervalMs = 300000) {
    if (this.monitorInterval) {
      this.stopMonitoring();
    }

    console.log(`[ProviderHealth] Starting health monitoring (interval: ${intervalMs / 1000}s)`);

    // Run initial check
    this.checkAll(getApiKeyFn).catch((err) => {
      console.error('[ProviderHealth] Initial health check failed:', err.message);
    });

    this.monitorInterval = setInterval(() => {
      this.checkAll(getApiKeyFn).catch((err) => {
        console.error('[ProviderHealth] Periodic health check failed:', err.message);
      });
    }, intervalMs);
  }

  /**
   * Stop periodic health monitoring.
   */
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      console.log('[ProviderHealth] Health monitoring stopped');
    }
  }
}

// Singleton instance
const providerHealthCheck = new ProviderHealthCheck();
export default providerHealthCheck;
