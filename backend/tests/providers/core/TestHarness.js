/**
 * TestHarness — the core orchestrator for provider tests.
 *
 * Wraps createLlmClient / createLlmAdapter so every test suite operates
 * through the exact same code-path the production app uses.
 *
 * Usage:
 *   const harness = new TestHarness({ name: 'openai', model: 'gpt-4.1', userId });
 *   await harness.setup();
 *   const results = await harness.runSuite(connectionSuite);
 */

import { createLlmClient } from '../../../src/services/ai/LlmService.js';
import { createLlmAdapter } from '../../../src/services/orchestrator/llmAdapters.js';
import { PROVIDER_CAPABILITIES } from '../../../src/services/ai/ProviderRegistry.js';
import LlmExecutionService from '../../../src/services/ai/LlmExecutionService.js';
import CustomOpenAIProviderService from '../../../src/services/ai/CustomOpenAIProviderService.js';
import { DEFAULTS } from '../config.js';

// ── Test result status constants ───────────────────────────────────────

export const STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  SKIP: 'skip',
  ERROR: 'error',
};

// ── Single test-case result ────────────────────────────────────────────

class TestResult {
  constructor(name, status, message = '', durationMs = 0, details = null) {
    this.name = name;
    this.status = status;
    this.message = message;
    this.durationMs = durationMs;
    this.details = details;
  }
}

// ── Suite result (collection of TestResults) ───────────────────────────

class SuiteResult {
  constructor(suiteName, providerName) {
    this.suite = suiteName;
    this.provider = providerName;
    this.tests = [];
    this.startedAt = null;
    this.finishedAt = null;
  }

  add(testResult) {
    this.tests.push(testResult);
  }

  get passed()  { return this.tests.filter((t) => t.status === STATUS.PASS).length; }
  get failed()  { return this.tests.filter((t) => t.status === STATUS.FAIL).length; }
  get skipped() { return this.tests.filter((t) => t.status === STATUS.SKIP).length; }
  get errored() { return this.tests.filter((t) => t.status === STATUS.ERROR).length; }
  get total()   { return this.tests.length; }
  get ok()      { return this.failed === 0 && this.errored === 0; }

  toJSON() {
    return {
      suite: this.suite,
      provider: this.provider,
      summary: { total: this.total, passed: this.passed, failed: this.failed, skipped: this.skipped, errored: this.errored },
      tests: this.tests,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }
}

// ── TestHarness ────────────────────────────────────────────────────────

export default class TestHarness {
  /**
   * @param {Object} providerConfig
   * @param {string} providerConfig.name       — provider key (e.g. 'openai', 'claude-code')
   * @param {string} providerConfig.model      — model id to test
   * @param {string} providerConfig.userId     — user id for auth lookups
   * @param {Object} [providerConfig.options]  — extra options forwarded to createLlmClient
   * @param {Object} [runtimeOpts]             — overrides for DEFAULTS
   */
  constructor(providerConfig, runtimeOpts = {}) {
    this.provider = providerConfig.name;
    this.model = providerConfig.model;
    this.userId = providerConfig.userId;
    this.clientOptions = providerConfig.options || {};
    this.opts = { ...DEFAULTS, ...runtimeOpts };

    // Resolved at setup()
    this.client = null;
    this.adapter = null;
    this.capabilities = null;
    this.isCustomProvider = false;

    // Re-use the singleton from the app
    this.executionService = LlmExecutionService;
  }

  // ── Capability helpers ─────────────────────────────────────────────

  get supportsTools() {
    return this.capabilities?.text?.supportsTools ?? false;
  }

  get supportsStreaming() {
    return this.capabilities?.text?.supportsStreaming ?? false;
  }

  get supportsVision() {
    return this.capabilities?.vision != null;
  }

  get supportsImageGen() {
    return this.capabilities?.imageGen != null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Create the LLM client and adapter exactly as production does.
   * Call this once before running any suites.
   */
  async setup() {
    // Detect custom provider
    this.isCustomProvider = await CustomOpenAIProviderService.isCustomProvider(this.provider);

    // Resolve capabilities
    const lowerProvider = this.provider.toLowerCase();
    this.capabilities = PROVIDER_CAPABILITIES[lowerProvider] || null;

    // Custom providers are assumed OpenAI-compatible
    if (!this.capabilities && this.isCustomProvider) {
      this.capabilities = {
        text: { models: [this.model], supportsStreaming: true, supportsTools: true },
        vision: null,
        imageGen: null,
      };
    }

    // Create client
    this.client = await createLlmClient(this.provider, this.userId, this.clientOptions);

    // Create adapter
    this.adapter = await createLlmAdapter(this.provider, this.client, this.model);
  }

  /**
   * Run a single test suite (object with `name` and `run(harness)` method).
   * Returns a SuiteResult.
   */
  async runSuite(suite) {
    const result = new SuiteResult(suite.name, this.provider);
    result.startedAt = new Date().toISOString();

    try {
      await suite.run(this, result);
    } catch (err) {
      result.add(new TestResult(
        `${suite.name}:fatal`,
        STATUS.ERROR,
        `Suite crashed: ${err.message}`,
        0,
        { stack: err.stack },
      ));
    }

    result.finishedAt = new Date().toISOString();
    return result;
  }

  // ── Test execution helpers (used inside suites) ────────────────────

  /**
   * Run a single test case with timeout and error wrapping.
   * @param {SuiteResult} suiteResult  — accumulator
   * @param {string}      testName     — human label
   * @param {Function}    fn           — async () => assertion[]
   */
  async runTest(suiteResult, testName, fn) {
    const start = Date.now();
    try {
      const assertions = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Test timed out')), this.opts.timeoutMs)
        ),
      ]);

      // fn() returns an array of { passed, message } objects
      const allPassed = assertions.every((a) => a.passed);
      const failMessages = assertions.filter((a) => !a.passed).map((a) => a.message);

      suiteResult.add(new TestResult(
        testName,
        allPassed ? STATUS.PASS : STATUS.FAIL,
        allPassed ? '' : failMessages.join(' | '),
        Date.now() - start,
      ));
    } catch (err) {
      suiteResult.add(new TestResult(
        testName,
        STATUS.ERROR,
        err.message,
        Date.now() - start,
        { stack: err.stack },
      ));
    }
  }

  /**
   * Skip a test with a reason.
   */
  skipTest(suiteResult, testName, reason) {
    suiteResult.add(new TestResult(testName, STATUS.SKIP, reason, 0));
  }
}

export { TestResult, SuiteResult };
