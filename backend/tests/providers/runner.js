#!/usr/bin/env node

/**
 * Provider Test Runner
 *
 * Executes provider test suites through the real LlmService / adapter stack.
 * Outputs results to the console and optionally to a JSON report file.
 *
 * Usage:
 *   node backend/tests/providers/runner.js [options]
 *
 * Options:
 *   --provider <name>     Run tests for a single provider (e.g. "claude-code")
 *   --category <api|cli>  Run only API or CLI providers
 *   --suite <name>        Run a single suite (e.g. "tool-calls")
 *   --report <path>       Write JSON report to file
 *   --verbose             Extra logging
 *   --list                List available providers and exit
 *   --dry-run             Show what would run without executing
 *   --timeout <ms>        Per-test timeout (default 60000)
 *   --help                Show this help
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROVIDERS, DEFAULTS, SUITE_ORDER } from './config.js';
import TestHarness, { STATUS } from './core/TestHarness.js';

// ── Suites ─────────────────────────────────────────────────────────────

import connectionSuite from './suites/01-connection.test.js';
import modelsSuite from './suites/02-models.test.js';
import responseSuite from './suites/03-response.test.js';
import streamingSuite from './suites/04-streaming.test.js';
import toolCallsSuite from './suites/05-tool-calls.test.js';
import toolStreamingSuite from './suites/06-tool-streaming.test.js';
import mcpSuite from './suites/07-mcp.test.js';
import visionSuite from './suites/08-vision.test.js';
import imageGenSuite from './suites/09-image-gen.test.js';
import contextSuite from './suites/10-context.test.js';
import errorHandlingSuite from './suites/11-error-handling.test.js';

// Provider-specific suites
import claudeCodeSuite from './providers/claude-code.test.js';
import codexCliSuite from './providers/codex-cli.test.js';
import kimiCodeSuite from './providers/kimi-code.test.js';
import codexApiSuite from './providers/codex-api.test.js';

const ALL_SUITES = {
  'connection':     connectionSuite,
  'models':         modelsSuite,
  'response':       responseSuite,
  'streaming':      streamingSuite,
  'tool-calls':     toolCallsSuite,
  'tool-streaming': toolStreamingSuite,
  'mcp':            mcpSuite,
  'vision':         visionSuite,
  'image-gen':      imageGenSuite,
  'context':        contextSuite,
  'error-handling': errorHandlingSuite,
};

const PROVIDER_SUITES = [
  claudeCodeSuite,
  codexCliSuite,
  kimiCodeSuite,
  codexApiSuite,
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── CLI argument parsing ───────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    provider: null,
    category: null,
    suite: null,
    report: null,
    verbose: DEFAULTS.verbose,
    list: false,
    dryRun: false,
    timeout: DEFAULTS.timeoutMs,
    help: false,
    userId: process.env.AGNT_TEST_USER_ID || 'test-user',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--provider':  args.provider = argv[++i]; break;
      case '--category':  args.category = argv[++i]; break;
      case '--suite':     args.suite = argv[++i]; break;
      case '--report':    args.report = argv[++i]; break;
      case '--verbose':   args.verbose = true; break;
      case '--list':      args.list = true; break;
      case '--dry-run':   args.dryRun = true; break;
      case '--timeout':   args.timeout = parseInt(argv[++i], 10); break;
      case '--help':      args.help = true; break;
      case '--user-id':   args.userId = argv[++i]; break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

// ── Formatting ─────────────────────────────────────────────────────────

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function statusIcon(status) {
  switch (status) {
    case STATUS.PASS:  return `${COLORS.green}PASS${COLORS.reset}`;
    case STATUS.FAIL:  return `${COLORS.red}FAIL${COLORS.reset}`;
    case STATUS.SKIP:  return `${COLORS.yellow}SKIP${COLORS.reset}`;
    case STATUS.ERROR: return `${COLORS.red}ERR!${COLORS.reset}`;
    default: return '????';
  }
}

function printSuiteResult(suiteResult, verbose) {
  const { suite, provider, tests } = suiteResult;
  const summary = suiteResult.toJSON().summary;

  console.log('');
  console.log(
    `${COLORS.bold}${COLORS.cyan}[${provider}]${COLORS.reset} ${COLORS.bold}${suite}${COLORS.reset}` +
    `  ${COLORS.green}${summary.passed} passed${COLORS.reset}` +
    (summary.failed > 0 ? `  ${COLORS.red}${summary.failed} failed${COLORS.reset}` : '') +
    (summary.skipped > 0 ? `  ${COLORS.yellow}${summary.skipped} skipped${COLORS.reset}` : '') +
    (summary.errored > 0 ? `  ${COLORS.red}${summary.errored} errors${COLORS.reset}` : ''),
  );

  for (const test of tests) {
    const icon = statusIcon(test.status);
    const duration = test.durationMs > 0 ? ` ${COLORS.dim}(${test.durationMs}ms)${COLORS.reset}` : '';
    const msg = test.message ? `  ${COLORS.dim}${test.message}${COLORS.reset}` : '';

    if (test.status === STATUS.PASS && !verbose) continue; // Only show non-pass in non-verbose
    console.log(`  ${icon} ${test.name}${duration}${msg}`);
  }
}

function printFinalSummary(allResults) {
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalErrored = 0;

  for (const suiteResult of allResults) {
    totalPassed += suiteResult.passed;
    totalFailed += suiteResult.failed;
    totalSkipped += suiteResult.skipped;
    totalErrored += suiteResult.errored;
  }

  const total = totalPassed + totalFailed + totalSkipped + totalErrored;

  console.log('');
  console.log(`${COLORS.bold}${'='.repeat(60)}${COLORS.reset}`);
  console.log(`${COLORS.bold}SUMMARY${COLORS.reset}`);
  console.log(`  Total:   ${total}`);
  console.log(`  ${COLORS.green}Passed:  ${totalPassed}${COLORS.reset}`);
  if (totalFailed > 0) console.log(`  ${COLORS.red}Failed:  ${totalFailed}${COLORS.reset}`);
  if (totalSkipped > 0) console.log(`  ${COLORS.yellow}Skipped: ${totalSkipped}${COLORS.reset}`);
  if (totalErrored > 0) console.log(`  ${COLORS.red}Errors:  ${totalErrored}${COLORS.reset}`);
  console.log(`${'='.repeat(60)}`);

  return totalFailed + totalErrored;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(`
Provider Test Runner

Usage: node backend/tests/providers/runner.js [options]

Options:
  --provider <name>     Run tests for a single provider
  --category <api|cli>  Run only API or CLI providers
  --suite <name>        Run a single suite (e.g. "tool-calls")
  --report <path>       Write JSON report to file
  --verbose             Show all test results (including passed)
  --list                List available providers and exit
  --dry-run             Show what would run without executing
  --timeout <ms>        Per-test timeout (default 60000)
  --user-id <id>        User ID for auth (default: AGNT_TEST_USER_ID env)
  --help                Show this help

Suites: ${SUITE_ORDER.join(', ')}
`);
    process.exit(0);
  }

  if (args.list) {
    console.log(`${COLORS.bold}Available Providers:${COLORS.reset}\n`);
    for (const [name, config] of Object.entries(PROVIDERS)) {
      console.log(`  ${COLORS.cyan}${name.padEnd(20)}${COLORS.reset} model=${config.model}  category=${config.category}  adapter=${config.adapter}`);
    }
    process.exit(0);
  }

  // ── Determine which providers to test ────────────────────────────
  let providerEntries = Object.entries(PROVIDERS);

  if (args.provider) {
    const match = providerEntries.filter(([name]) => name === args.provider.toLowerCase());
    if (match.length === 0) {
      console.error(`Unknown provider: ${args.provider}`);
      console.error(`Available: ${Object.keys(PROVIDERS).join(', ')}`);
      process.exit(1);
    }
    providerEntries = match;
  }

  if (args.category) {
    providerEntries = providerEntries.filter(([, config]) => config.category === args.category);
    if (providerEntries.length === 0) {
      console.error(`No providers in category: ${args.category}`);
      process.exit(1);
    }
  }

  // ── Determine which suites to run ────────────────────────────────
  let suiteNames = SUITE_ORDER;
  if (args.suite) {
    if (!ALL_SUITES[args.suite]) {
      console.error(`Unknown suite: ${args.suite}`);
      console.error(`Available: ${SUITE_ORDER.join(', ')}`);
      process.exit(1);
    }
    suiteNames = [args.suite];
  }

  // ── Dry run ──────────────────────────────────────────────────────
  if (args.dryRun) {
    console.log(`${COLORS.bold}Dry Run — would execute:${COLORS.reset}\n`);
    for (const [name, config] of providerEntries) {
      console.log(`  ${COLORS.cyan}${name}${COLORS.reset} (${config.model})`);
      for (const suiteName of suiteNames) {
        console.log(`    - ${suiteName}`);
      }
      // Provider-specific suites
      for (const ps of PROVIDER_SUITES) {
        if (ps.provider === name) {
          console.log(`    - ${ps.name} (provider-specific)`);
        }
      }
    }
    process.exit(0);
  }

  // ── Execute ──────────────────────────────────────────────────────
  console.log(`\n${COLORS.bold}AGNT Provider Test Suite${COLORS.reset}`);
  console.log(`${COLORS.dim}Providers: ${providerEntries.map(([n]) => n).join(', ')}${COLORS.reset}`);
  console.log(`${COLORS.dim}Suites: ${suiteNames.join(', ')}${COLORS.reset}`);
  console.log(`${COLORS.dim}User ID: ${args.userId}${COLORS.reset}`);
  console.log('');

  const allResults = [];

  for (const [providerName, providerConfig] of providerEntries) {
    console.log(`${COLORS.bold}${'─'.repeat(60)}${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}Provider: ${providerName}${COLORS.reset} (model: ${providerConfig.model})`);

    // Setup harness
    const harness = new TestHarness(
      {
        name: providerName,
        model: providerConfig.model,
        userId: args.userId,
        options: {},
      },
      { timeoutMs: args.timeout, verbose: args.verbose },
    );

    try {
      await harness.setup();
    } catch (setupError) {
      console.log(`  ${COLORS.red}SETUP FAILED: ${setupError.message}${COLORS.reset}`);
      if (args.verbose) {
        console.log(`  ${COLORS.dim}${setupError.stack}${COLORS.reset}`);
      }
      // Record as a connection failure
      const { SuiteResult, TestResult } = await import('./core/TestHarness.js');
      const failResult = new SuiteResult('connection', providerName);
      failResult.add(new TestResult(
        'setup',
        STATUS.ERROR,
        `Setup failed: ${setupError.message}`,
      ));
      failResult.startedAt = new Date().toISOString();
      failResult.finishedAt = new Date().toISOString();
      allResults.push(failResult);
      printSuiteResult(failResult, args.verbose);
      continue;
    }

    // Run generic suites
    for (const suiteName of suiteNames) {
      const suite = ALL_SUITES[suiteName];
      const suiteResult = await harness.runSuite(suite);
      allResults.push(suiteResult);
      printSuiteResult(suiteResult, args.verbose);
    }

    // Run provider-specific suites
    for (const providerSuite of PROVIDER_SUITES) {
      if (providerSuite.provider === providerName || !providerSuite.provider) {
        const suiteResult = await harness.runSuite(providerSuite);
        // Only add if it actually ran tests (not all skipped due to wrong provider)
        if (suiteResult.total > 0) {
          allResults.push(suiteResult);
          printSuiteResult(suiteResult, args.verbose);
        }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  const failureCount = printFinalSummary(allResults);

  // ── Report ───────────────────────────────────────────────────────
  if (args.report) {
    const reportData = {
      timestamp: new Date().toISOString(),
      args: {
        provider: args.provider,
        category: args.category,
        suite: args.suite,
        timeout: args.timeout,
      },
      summary: {
        total: allResults.reduce((s, r) => s + r.total, 0),
        passed: allResults.reduce((s, r) => s + r.passed, 0),
        failed: allResults.reduce((s, r) => s + r.failed, 0),
        skipped: allResults.reduce((s, r) => s + r.skipped, 0),
        errored: allResults.reduce((s, r) => s + r.errored, 0),
      },
      providers: {},
    };

    for (const suiteResult of allResults) {
      if (!reportData.providers[suiteResult.provider]) {
        reportData.providers[suiteResult.provider] = {};
      }
      reportData.providers[suiteResult.provider][suiteResult.suite] = suiteResult.toJSON();
    }

    const reportPath = path.resolve(args.report);
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n${COLORS.dim}Report written to: ${reportPath}${COLORS.reset}`);
  }

  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Runner crashed:', err);
  process.exit(2);
});
