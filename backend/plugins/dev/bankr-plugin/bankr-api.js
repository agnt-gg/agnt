import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '..', '..', '..');

const BANKR_API_BASE = 'https://api.bankr.bot';

/**
 * Bankr API Plugin Tool — Unified
 *
 * A single tool that consolidates all Bankr action operations:
 *
 * PROMPT        — Send natural language commands to Bankr's AI agent (trade, swap, DCA, etc.)
 * GET_JOB       — Check status of an async job
 * CANCEL_JOB    — Cancel a pending job
 * GET_ACCOUNT   — Fetch wallet addresses, balances, socials, Bankr Club status
 * LAUNCH_TOKEN  — Deploy a token on Base or Solana with vaulting/vesting/fee-splitting
 * CHECK_FEES    — View accumulated trading fees for a deployed token
 * CLAIM_FEES    — Claim your trading fee share
 * SIGN          — Sign messages, typed data (EIP-712), or transactions without broadcasting
 * SUBMIT_TRANSACTION — Submit a transaction to the blockchain
 *
 * Supported chains: Base, Ethereum, Polygon, Unichain, Solana
 * API Reference: https://docs.bankr.bot/agent-api/overview
 */
class BankrAPI {
  constructor() {
    this.name = 'bankr_api';
  }

  // ─── Auth ──────────────────────────────────────────────────────────────

  /**
   * Resolve the Bankr API key from AGNT's AuthManager.
   * Users store their bk_... key via Settings → Connections.
   */
  async getApiKey(workflowEngine) {
    try {
      const authManagerPath = path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js');
      const normalizedPath = `file://${authManagerPath.replace(/\\/g, '/')}`;
      const AuthManagerModule = await import(normalizedPath);
      const AuthManager = AuthManagerModule.default;
      const apiKey = await AuthManager.getValidAccessToken(workflowEngine.userId, 'bankr');
      return apiKey;
    } catch (error) {
      console.error('[BankrPlugin] Auth error:', error.message);
      return null;
    }
  }

  // ─── Main execute ──────────────────────────────────────────────────────

  async execute(params, inputData, workflowEngine) {
    const action = (params.action || 'PROMPT').toUpperCase();
    console.log(`[BankrPlugin] Executing action: ${action}`);

    try {
      const apiKey = await this.getApiKey(workflowEngine);
      if (!apiKey) {
        throw new Error(
          'Bankr API key not found. Please add your Bankr API key (bk_...) in Settings → Connections → Bankr. ' +
          'Get your key at https://bankr.bot/api'
        );
      }

      const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      };

      switch (action) {
        case 'PROMPT':
          return await this.handlePrompt(params, headers);
        case 'GET_JOB':
          return await this.getJobStatus(params.jobId, headers);
        case 'CANCEL_JOB':
          return await this.cancelJob(params.jobId, headers);
        case 'GET_ACCOUNT':
          return await this.getAccount(headers);
        case 'LAUNCH_TOKEN':
          return await this.launchToken(params, headers);
        case 'CHECK_FEES':
          return await this.checkFees(params, headers);
        case 'CLAIM_FEES':
          return await this.claimFees(params, headers);
        case 'SIGN':
          return await this.sign(params, headers);
        case 'SUBMIT_TRANSACTION':
          return await this.submitTransaction(params, headers);
        default:
          throw new Error(
            `Unsupported action: ${action}. ` +
            'Use PROMPT, GET_JOB, CANCEL_JOB, GET_ACCOUNT, LAUNCH_TOKEN, CHECK_FEES, CLAIM_FEES, SIGN, or SUBMIT_TRANSACTION.'
          );
      }
    } catch (error) {
      console.error(`[BankrPlugin] Error (${action}):`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ─── PROMPT ────────────────────────────────────────────────────────────

  /**
   * Submit a natural language prompt and optionally wait for completion.
   *
   * The Bankr Agent API is async:
   * 1. POST /agent/prompt → returns { jobId, threadId, status: "pending" }
   * 2. GET /agent/job/{jobId} → poll until status is 'completed' or 'failed'
   *
   * Example prompts:
   * - "price of ETH"
   * - "swap $50 ETH to USDC on base"
   * - "my balances on base"
   * - "DCA $10 into ETH daily on base"
   * - "long BTC/USD 5x $100 on base" (Avantis)
   * - "odds eagles win" (Polymarket)
   */
  async handlePrompt(params, headers) {
    const { prompt, threadId, waitForCompletion = true, timeoutMs = 120000 } = params;

    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt is required. Examples: "price of ETH", "swap $50 USDC to ETH on base"');
    }

    // Step 1: Submit the prompt
    const body = { prompt: prompt.trim() };
    if (threadId) {
      body.threadId = threadId;
    }

    console.log(`[BankrPlugin] Submitting prompt: "${prompt.trim()}"`);

    const submitResponse = await fetch(`${BANKR_API_BASE}/agent/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!submitResponse.ok) {
      const errBody = await submitResponse.text();
      if (submitResponse.status === 401) {
        throw new Error('Invalid Bankr API key. Check your key at https://bankr.bot/api');
      }
      if (submitResponse.status === 429) {
        throw new Error('Bankr rate limit reached (100/day standard, 1000/day with Bankr Club). Try again later.');
      }
      throw new Error(`Bankr API error (${submitResponse.status}): ${errBody}`);
    }

    const submitData = await submitResponse.json();
    const jobId = submitData.jobId;

    if (!jobId) {
      throw new Error('Bankr API did not return a jobId. Response: ' + JSON.stringify(submitData));
    }

    console.log(`[BankrPlugin] Job submitted: ${jobId}, threadId: ${submitData.threadId || 'none'}`);

    // If user doesn't want to wait, return the jobId immediately
    if (!waitForCompletion) {
      return {
        success: true,
        message: `Job submitted successfully. Use GET_JOB with jobId "${jobId}" to check status.`,
        richData: null,
        jobId,
        threadId: submitData.threadId || threadId || null,
        status: 'pending',
        error: null,
      };
    }

    // Step 2: Poll for completion
    return await this.pollJob(jobId, headers, timeoutMs);
  }

  // ─── GET_JOB ───────────────────────────────────────────────────────────

  /**
   * Get the status and result of a specific job.
   *
   * Bankr API response shape (completed):
   * {
   *   success: true,
   *   jobId: "abc123",
   *   threadId: "thr_XYZ789",
   *   status: "completed",
   *   prompt: "what is the price of ETH?",
   *   response: "ETH is currently trading at $3,245.67",   ← top-level
   *   richData: [...],                                      ← top-level
   *   createdAt: "...",
   *   completedAt: "...",
   *   processingTime: 3000
   * }
   */
  async getJobStatus(jobId, headers) {
    if (!jobId) {
      throw new Error('jobId is required for GET_JOB action.');
    }

    const response = await fetch(`${BANKR_API_BASE}/agent/job/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to get job status (${response.status}): ${errText}`);
    }

    const data = await response.json();

    const isCompleted = data.status === 'completed';
    const isFailed = data.status === 'failed' || data.status === 'cancelled';

    return {
      success: isCompleted,
      message: data.response || null,
      richData: data.richData || null,
      jobId: data.jobId || jobId,
      threadId: data.threadId || null,
      status: data.status || 'unknown',
      prompt: data.prompt || null,
      processingTime: data.processingTime || null,
      error: isFailed ? (data.error || `Job ${data.status}`) : null,
    };
  }

  // ─── CANCEL_JOB ────────────────────────────────────────────────────────

  /**
   * Cancel a pending or processing job.
   * Maps to: POST /agent/job/{jobId}/cancel
   */
  async cancelJob(jobId, headers) {
    if (!jobId) {
      throw new Error('jobId is required for CANCEL_JOB action.');
    }

    const response = await fetch(`${BANKR_API_BASE}/agent/job/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to cancel job (${response.status}): ${errText}`);
    }

    const data = await response.json();

    console.log(`[BankrPlugin] Job ${jobId} cancelled`);

    return {
      success: true,
      message: `Job ${jobId} has been cancelled.`,
      richData: null,
      jobId: data.jobId || jobId,
      threadId: null,
      status: 'cancelled',
      error: null,
    };
  }

  // ─── GET_ACCOUNT ───────────────────────────────────────────────────────

  /**
   * Fetch user profile: wallet addresses, socials, Bankr Club status, leaderboard.
   * Maps to: GET /agent/me
   *
   * API response shape:
   * {
   *   success: true,
   *   wallets: [{ chain: "evm", address: "0x..." }, { chain: "solana", address: "5FH..." }],
   *   socialAccounts: [{ platform: "farcaster", username: "alice" }],
   *   refCode: "A1B2C3D4-BNKR",
   *   bankrClub: { active: true, subscriptionType: "monthly", renewOrCancelOn: 1720000000000 },
   *   leaderboard: { score: 1250, rank: 42 }
   * }
   */
  async getAccount(headers) {
    console.log('[BankrPlugin] Fetching account info');

    const response = await fetch(`${BANKR_API_BASE}/agent/me`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid Bankr API key. Check your key at https://bankr.bot/api');
      }
      throw new Error(`Bankr API error (${response.status}): ${errText}`);
    }

    const data = await response.json();

    console.log('[BankrPlugin] Account info retrieved successfully');

    return {
      success: true,
      wallets: data.wallets || [],
      socialAccounts: data.socialAccounts || [],
      bankrClub: data.bankrClub || { active: false },
      leaderboard: data.leaderboard || {},
      refCode: data.refCode || null,
      richData: data,
      error: null,
    };
  }

  // ─── LAUNCH_TOKEN ──────────────────────────────────────────────────────

  /**
   * Deploy a new token on Base or Solana with optional vaulting/vesting/fee-splitting.
   *
   * Base:   100B fixed supply, 60% fee share to deployer, gas sponsored
   * Solana: Configurable supply, 0.5% creator fee (bonding curve), Fee Key NFT after migration
   *
   * Token Launch Limits: 1/day standard, 10/day with Bankr Club
   */
  async launchToken(params, headers) {
    const { name, symbol, chain, vaultPercent, vestingCliffDays, vestingDurationDays, feeSplitAddress, timeoutMs = 600000 } = params;

    if (!name || name.trim().length === 0) {
      throw new Error('Token name is required (e.g., "My Agent Token")');
    }
    if (!symbol || symbol.trim().length === 0) {
      throw new Error('Token symbol is required (e.g., "AGENT")');
    }

    const targetChain = (chain || 'base').toLowerCase();
    if (!['base', 'solana'].includes(targetChain)) {
      throw new Error('Chain must be "base" or "solana". Token launching is only supported on these two chains.');
    }

    // Build the prompt dynamically
    let prompt = `deploy a token called ${name.trim()} with symbol ${symbol.trim()}`;
    const options = [];

    if (vaultPercent && vaultPercent > 0) {
      if (vaultPercent > 90) {
        throw new Error('Vault percentage cannot exceed 90%');
      }
      options.push(`${vaultPercent}% vault`);
    }

    if (vestingCliffDays && vestingCliffDays > 0) {
      if (targetChain === 'base' && vestingCliffDays < 7) {
        throw new Error('Minimum vesting cliff on Base is 7 days');
      }
      if (targetChain === 'solana') {
        const cliffSeconds = vestingCliffDays * 86400;
        options.push(`${cliffSeconds} second cliff`);
      } else {
        options.push(`${vestingCliffDays} day cliff`);
      }
    }

    if (vestingDurationDays && vestingDurationDays > 0) {
      if (targetChain === 'solana') {
        const durationSeconds = vestingDurationDays * 86400;
        options.push(`${durationSeconds} second vesting`);
      } else {
        options.push(`${vestingDurationDays} day vesting`);
      }
    }

    if (feeSplitAddress && feeSplitAddress.trim().length > 0) {
      options.push(`fees going to ${feeSplitAddress.trim()}`);
    }

    if (options.length > 0) {
      prompt += ', ' + options.join(', ');
    }

    prompt += ` on ${targetChain}`;

    console.log(`[BankrPlugin] Launch prompt: "${prompt}"`);

    const result = await this.submitAndPoll(prompt, headers, timeoutMs);

    return {
      ...result,
      chain: targetChain,
      tokenAddress: result.richData?.tokenAddress || result.richData?.contractAddress || result.richData?.address || null,
    };
  }

  // ─── CHECK_FEES ────────────────────────────────────────────────────────

  /**
   * View accumulated trading fees for a deployed token.
   *
   * Base:   Your token + WETH pair fees (60% share)
   * Solana: SOL creator fees (0.5%) or CPMM LP fees post-migration
   */
  async checkFees(params, headers) {
    const tokenName = params.tokenName || params.name;
    if (!tokenName || tokenName.trim().length === 0) {
      throw new Error('tokenName is required to check fees');
    }

    const prompt = `check my fees for ${tokenName.trim()}`;
    console.log(`[BankrPlugin] Checking fees: "${prompt}"`);

    const result = await this.submitAndPoll(prompt, headers, 60000);
    return {
      ...result,
      fees: result.richData?.fees || result.richData || null,
    };
  }

  // ─── CLAIM_FEES ────────────────────────────────────────────────────────

  /**
   * Claim accumulated trading fees for a token.
   */
  async claimFees(params, headers) {
    const tokenName = params.tokenName || params.name;
    if (!tokenName || tokenName.trim().length === 0) {
      throw new Error('tokenName is required to claim fees');
    }

    const prompt = `claim my fees for ${tokenName.trim()}`;
    console.log(`[BankrPlugin] Claiming fees: "${prompt}"`);

    const result = await this.submitAndPoll(prompt, headers, 120000);
    return {
      ...result,
      fees: result.richData?.fees || result.richData || null,
    };
  }

  // ─── SIGN ──────────────────────────────────────────────────────────────

  /**
   * Sign messages, typed data (EIP-712), or transaction data using your
   * Bankr wallet WITHOUT broadcasting to the blockchain.
   *
   * Supported signatureTypes:
   *   "message"     → personal_sign (plain text message signing)
   *   "typedData"   → eth_signTypedData_v4 (EIP-712 structured data)
   *   "transaction" → eth_signTransaction (sign tx without broadcasting)
   *
   * Maps to: POST /agent/sign
   *
   * API request shape:
   *   personal_sign:        { signatureType: "personal_sign", message: "..." }
   *   eth_signTypedData_v4: { signatureType: "eth_signTypedData_v4", typedData: { domain, types, primaryType, message } }
   *   eth_signTransaction:  { signatureType: "eth_signTransaction", transaction: { to, chainId, value, data, ... } }
   *
   * API response shape:
   *   { success: true, signature: "0x...", signer: "0x...", signatureType: "personal_sign" }
   */
  async sign(params, headers) {
    const signType = (params.signType || 'message').toLowerCase();
    if (!['message', 'typeddata', 'transaction'].includes(signType)) {
      throw new Error('signType must be "message", "typedData", or "transaction".');
    }

    if (!params.data || params.data.trim().length === 0) {
      throw new Error('Data to sign is required.');
    }

    // Build the correct request body per the Bankr API docs
    let body;

    if (signType === 'message') {
      // personal_sign — plain text message
      body = {
        signatureType: 'personal_sign',
        message: params.data.trim(),
      };
    } else if (signType === 'typeddata') {
      // eth_signTypedData_v4 — EIP-712 structured data
      let typedData;
      try {
        typedData = JSON.parse(params.data.trim());
      } catch (e) {
        throw new Error('typedData must be valid JSON containing domain, types, primaryType, and message fields.');
      }
      body = {
        signatureType: 'eth_signTypedData_v4',
        typedData,
      };
    } else {
      // eth_signTransaction — sign a transaction without broadcasting
      let transaction;
      try {
        transaction = JSON.parse(params.data.trim());
      } catch (e) {
        throw new Error('transaction must be valid JSON containing at least "to" and "chainId" fields.');
      }
      body = {
        signatureType: 'eth_signTransaction',
        transaction,
      };
    }

    console.log(`[BankrPlugin] Signing ${body.signatureType}`);

    const response = await fetch(`${BANKR_API_BASE}/agent/sign`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid Bankr API key. Check your key at https://bankr.bot/api');
      }
      if (response.status === 403) {
        throw new Error('Bankr API key does not have write access. Disable read-only mode at https://bankr.bot/api');
      }
      throw new Error(`Bankr sign error (${response.status}): ${errText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Signing failed');
    }

    console.log('[BankrPlugin] Signature generated successfully');

    return {
      success: true,
      signature: data.signature || null,
      signerAddress: data.signer || null,
      signatureType: data.signatureType || body.signatureType,
      error: null,
    };
  }

  // ─── SUBMIT_TRANSACTION ────────────────────────────────────────────────

  /**
   * Submit a transaction to the blockchain via Bankr.
   * Bankr signs and broadcasts the transaction for you.
   *
   * Supports chains: Base (8453), Ethereum (1), Polygon (137), Unichain (130), Solana
   *
   * Maps to: POST /agent/submit
   *
   * API request shape:
   * {
   *   transaction: {
   *     to: "0x...",
   *     chainId: 8453,
   *     value: "1000000000000000000",  // wei as string
   *     data: "0x...",                 // calldata (optional)
   *     gas: "21000",                  // optional
   *     maxFeePerGas: "...",           // optional EIP-1559
   *     maxPriorityFeePerGas: "...",   // optional EIP-1559
   *     nonce: 0                       // optional
   *   },
   *   description: "Transfer 1 ETH",
   *   waitForConfirmation: true
   * }
   *
   * API response shape:
   * { success: true, transactionHash: "0x...", status: "success", blockNumber: "...", gasUsed: "...", signer: "0x...", chainId: 8453 }
   */
  async submitTransaction(params, headers) {
    if (!params.signedTransaction || params.signedTransaction.trim().length === 0) {
      throw new Error(
        'signedTransaction is required. Provide a JSON transaction object with at least "to" and "chainId" fields. ' +
        'Example: {"to": "0x...", "chainId": 8453, "value": "1000000000000000000"}'
      );
    }

    // Parse the transaction data — it should be a JSON object
    let transaction;
    try {
      transaction = JSON.parse(params.signedTransaction.trim());
    } catch (e) {
      throw new Error(
        'signedTransaction must be valid JSON. ' +
        'Example: {"to": "0x...", "chainId": 8453, "value": "1000000000000000000"}'
      );
    }

    // Map chain name to chainId if chainId not already in the transaction
    if (!transaction.chainId) {
      const chain = (params.chain || 'base').toLowerCase();
      const chainIdMap = {
        base: 8453,
        ethereum: 1,
        polygon: 137,
        unichain: 130,
      };
      if (chain === 'solana') {
        throw new Error('The submit endpoint only supports EVM chains. Use PROMPT for Solana transactions.');
      }
      transaction.chainId = chainIdMap[chain] || 8453;
    }

    if (!transaction.to) {
      throw new Error('Transaction must include a "to" address.');
    }

    const body = {
      transaction,
      waitForConfirmation: true,
    };

    const chainName = params.chain || 'base';
    console.log(`[BankrPlugin] Submitting transaction to chain ${transaction.chainId} (${chainName})`);

    const response = await fetch(`${BANKR_API_BASE}/agent/submit`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid Bankr API key. Check your key at https://bankr.bot/api');
      }
      if (response.status === 403) {
        throw new Error('Bankr API key does not have write access. Disable read-only mode at https://bankr.bot/api');
      }
      throw new Error(`Bankr submit error (${response.status}): ${errText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Transaction submission failed');
    }

    const txHash = data.transactionHash || null;
    console.log(`[BankrPlugin] Transaction submitted: ${txHash}`);

    return {
      success: true,
      transactionHash: txHash,
      status: data.status || 'pending',
      blockNumber: data.blockNumber || null,
      gasUsed: data.gasUsed || null,
      signerAddress: data.signer || null,
      chain: chainName,
      chainId: data.chainId || transaction.chainId,
      error: null,
    };
  }

  // ─── Shared helpers ────────────────────────────────────────────────────

  /**
   * Submit a prompt to Bankr and poll for the result.
   * Shared by LAUNCH_TOKEN, CHECK_FEES, CLAIM_FEES.
   */
  async submitAndPoll(prompt, headers, timeoutMs = 120000) {
    // Step 1: Submit
    const submitResponse = await fetch(`${BANKR_API_BASE}/agent/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt }),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      if (submitResponse.status === 429) {
        throw new Error('Rate limit reached. Try again later or upgrade to Bankr Club.');
      }
      throw new Error(`Bankr API error (${submitResponse.status}): ${errText}`);
    }

    const submitData = await submitResponse.json();
    const jobId = submitData.jobId;

    if (!jobId) {
      throw new Error('Bankr API did not return a jobId');
    }

    console.log(`[BankrPlugin] Job submitted: ${jobId}`);

    // Step 2: Poll
    return await this.pollJob(jobId, headers, timeoutMs);
  }

  /**
   * Poll a job until it completes, fails, or times out.
   * Recommended: 2s interval, 60 attempts max (~2 min).
   */
  async pollJob(jobId, headers, timeoutMs = 120000) {
    const startTime = Date.now();
    const pollInterval = 2000; // Bankr docs recommend 2 seconds

    while (Date.now() - startTime < timeoutMs) {
      await this.sleep(pollInterval);

      try {
        const result = await this.getJobStatus(jobId, headers);

        if (result.status === 'completed') {
          const elapsed = Date.now() - startTime;
          console.log(`[BankrPlugin] Job ${jobId} completed in ${elapsed}ms`);
          return result;
        }

        if (result.status === 'failed' || result.status === 'cancelled') {
          console.log(`[BankrPlugin] Job ${jobId} ${result.status}`);
          return result;
        }

        // Log progress for statusUpdates if available
        if (result.status === 'processing') {
          console.log(`[BankrPlugin] Job ${jobId} still processing...`);
        }
      } catch (pollError) {
        // Tolerate transient poll errors — keep trying until timeout
        console.warn(`[BankrPlugin] Poll error (will retry): ${pollError.message}`);
      }
    }

    // Timeout
    const elapsed = Date.now() - startTime;
    console.warn(`[BankrPlugin] Job ${jobId} timed out after ${elapsed}ms`);
    return {
      success: false,
      message: `Job ${jobId} timed out after ${Math.round(timeoutMs / 1000)}s. Use GET_JOB action to check later.`,
      richData: null,
      jobId,
      threadId: null,
      status: 'timeout',
      error: `Timeout after ${timeoutMs}ms. The job may still be processing — check with GET_JOB.`,
    };
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new BankrAPI();
