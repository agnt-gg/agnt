import EventEmitter from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '..', '..', '..');

const BANKR_API_BASE = 'https://api.bankr.bot';

/**
 * Bankr Fee Monitor — Trigger Tool
 * 
 * Periodically checks accumulated trading fees for a deployed token.
 * When fees exceed a user-defined threshold, triggers the workflow.
 * 
 * Use cases:
 * - Auto-claim fees when they hit a threshold
 * - Alert when token trading volume generates significant fees
 * - Reinvest fees into DCA or other strategies
 * - Monitor revenue from token launches
 * 
 * Works with tokens launched on both Base (60% fee share) and
 * Solana (0.5% creator fee on bonding curve, LP fees post-migration).
 * 
 * API Reference: https://docs.bankr.bot/agent-api/overview
 */
class BankrFeeMonitor extends EventEmitter {
  constructor() {
    super();
    this.name = 'bankr_fee_monitor';
    this.pollTimer = null;
    this.apiKey = null;
    this.isRunning = false;
  }

  /**
   * Resolve the Bankr API key from AGNT's AuthManager.
   */
  async getApiKey(userId) {
    try {
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const normalizedPath = `file://${authManagerPath.replace(/\\/g, '/')}`;
      const AuthManagerModule = await import(normalizedPath);
      const AuthManager = AuthManagerModule.default;
      const apiKey = await AuthManager.getValidAccessToken(userId, 'bankr');
      return apiKey;
    } catch (error) {
      console.error('[BankrPlugin:bankr-fee-monitor] Auth error:', error.message);
      return null;
    }
  }

  /**
   * Setup the trigger — called when workflow starts.
   * Begins periodic polling of fee status.
   */
  async setup(engine, node) {
    console.log('[BankrPlugin:bankr-fee-monitor] Setting up fee monitor trigger');

    const { tokenName, thresholdUsd = 10, pollIntervalMs = 300000 } = node.parameters || {};

    if (!tokenName || tokenName.trim().length === 0) {
      throw new Error('tokenName is required for the fee monitor trigger (e.g., "AGENT")');
    }

    this.apiKey = await this.getApiKey(engine.userId);
    if (!this.apiKey) {
      throw new Error(
        'Bankr API key not found. Please add your Bankr API key (bk_...) in Settings → Connections → Bankr. ' +
        'Get your key at https://bankr.bot/api'
      );
    }

    // Register in engine receivers for cleanup
    if (engine.receivers) {
      engine.receivers.bankrFeeMonitor = this;
    }

    this.isRunning = true;

    const interval = Math.max(pollIntervalMs, 60000); // Minimum 1 minute to avoid rate limits
    const threshold = Math.max(thresholdUsd, 0.01);

    console.log(
      `[BankrPlugin:bankr-fee-monitor] Monitoring fees for "${tokenName}" ` +
      `(threshold: $${threshold}, interval: ${interval / 1000}s)`
    );

    // Start periodic polling
    this.pollTimer = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const feeData = await this.checkFees(tokenName.trim());

        if (feeData && feeData.feeUsdValue >= threshold) {
          console.log(
            `[BankrPlugin:bankr-fee-monitor] Fee threshold reached: ` +
            `$${feeData.feeUsdValue.toFixed(2)} >= $${threshold}`
          );
          engine.processWorkflowTrigger(feeData);
        } else {
          console.log(
            `[BankrPlugin:bankr-fee-monitor] Fees at $${feeData?.feeUsdValue?.toFixed(2) || '0.00'}, ` +
            `below threshold of $${threshold}`
          );
        }
      } catch (err) {
        console.error('[BankrPlugin:bankr-fee-monitor] Fee check error:', err.message);
      }
    }, interval);

    // Also do an immediate check on setup
    try {
      const initialCheck = await this.checkFees(tokenName.trim());
      if (initialCheck && initialCheck.feeUsdValue >= threshold) {
        console.log('[BankrPlugin:bankr-fee-monitor] Initial check triggered workflow');
        engine.processWorkflowTrigger(initialCheck);
      }
    } catch (err) {
      console.warn('[BankrPlugin:bankr-fee-monitor] Initial check failed (non-fatal):', err.message);
    }
  }

  /**
   * Check fees for a token via Bankr's prompt API.
   * Uses the "check my fees for TOKEN" prompt.
   *
   * Flow:
   * 1. POST /agent/prompt → { jobId }
   * 2. GET /agent/job/{jobId} → poll until completed
   *
   * Job response shape (completed):
   * {
   *   status: "completed",
   *   response: "Your fees are...",     ← top-level
   *   richData: [...]                    ← top-level
   * }
   */
  async checkFees(tokenName) {
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
    };

    // Submit the fee check prompt
    const submitResponse = await fetch(`${BANKR_API_BASE}/agent/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: `check my fees for ${tokenName}` }),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      throw new Error(`Fee check submission failed (${submitResponse.status}): ${errText}`);
    }

    const submitData = await submitResponse.json();
    const jobId = submitData.jobId;

    if (!jobId) {
      throw new Error('No jobId returned from fee check');
    }

    // Poll for result (30s timeout for fee queries — they should be fast)
    const startTime = Date.now();
    const timeoutMs = 30000;
    const pollInterval = 2000; // Bankr docs recommend 2s

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      try {
        const response = await fetch(`${BANKR_API_BASE}/agent/job/${encodeURIComponent(jobId)}`, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();

        if (data.status === 'completed') {
          // Response and richData are at the TOP LEVEL of the API response
          const richData = data.richData || [];
          const responseText = data.response || '';

          // Try to extract fee amounts from richData or parse from response text
          let feeAmount = 0;
          let feeCurrency = 'WETH';
          let feeUsdValue = 0;

          // Check richData array for fee information
          if (Array.isArray(richData)) {
            for (const item of richData) {
              if (item.feeAmount !== undefined) feeAmount = item.feeAmount;
              if (item.feeCurrency !== undefined) feeCurrency = item.feeCurrency;
              if (item.feeUsdValue !== undefined) feeUsdValue = item.feeUsdValue;
              if (item.fees) {
                if (item.fees.amount !== undefined) feeAmount = item.fees.amount;
                if (item.fees.currency !== undefined) feeCurrency = item.fees.currency;
                if (item.fees.usdValue !== undefined) feeUsdValue = item.fees.usdValue;
              }
            }
          } else if (typeof richData === 'object' && richData !== null) {
            feeAmount = richData.feeAmount || richData.fees?.amount || 0;
            feeCurrency = richData.feeCurrency || richData.fees?.currency || 'WETH';
            feeUsdValue = richData.feeUsdValue || richData.fees?.usdValue || feeAmount;
          }

          return {
            tokenName,
            feeAmount: typeof feeAmount === 'number' ? feeAmount : parseFloat(feeAmount) || 0,
            feeCurrency,
            feeUsdValue: typeof feeUsdValue === 'number' ? feeUsdValue : parseFloat(feeUsdValue) || 0,
            lastChecked: new Date().toISOString(),
            rawMessage: responseText,
            rawData: richData,
          };
        }

        if (data.status === 'failed' || data.status === 'cancelled') {
          console.warn(`[BankrPlugin:bankr-fee-monitor] Fee check job ${data.status}: ${data.error || 'unknown'}`);
          return null;
        }
      } catch (pollError) {
        // Tolerate transient errors
      }
    }

    console.warn('[BankrPlugin:bankr-fee-monitor] Fee check timed out');
    return null;
  }

  /**
   * Validate that trigger data has the expected shape.
   */
  validate(triggerData) {
    return triggerData && 'tokenName' in triggerData && 'feeUsdValue' in triggerData;
  }

  /**
   * Process trigger data for downstream workflow nodes.
   */
  async process(inputData, engine) {
    return {
      tokenName: inputData.tokenName,
      feeAmount: inputData.feeAmount,
      feeCurrency: inputData.feeCurrency,
      feeUsdValue: inputData.feeUsdValue,
      lastChecked: inputData.lastChecked,
      rawMessage: inputData.rawMessage || null,
      rawData: inputData.rawData || null,
    };
  }

  /**
   * Teardown — called when workflow stops. Cleans up the polling timer.
   */
  async teardown() {
    console.log('[BankrPlugin:bankr-fee-monitor] Tearing down fee monitor');
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export default new BankrFeeMonitor();
