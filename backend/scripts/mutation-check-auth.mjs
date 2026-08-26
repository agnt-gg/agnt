/**
 * Negative control for the new auth suites.
 *
 * A green suite proves nothing on its own — it can be green because the code is
 * right, or because the assertions never bite. This reintroduces each defect the
 * suite is supposed to guard and requires the suite to go RED. A mutation that
 * survives means the corresponding test is decorative.
 *
 * Usage: node backend/scripts/mutation-check-auth.mjs   (from the repo root)
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLAUDE = path.join(ROOT, 'backend/src/services/auth/ClaudeCodeAuthManager.js');
const RESOLVER = path.join(ROOT, 'backend/src/services/auth/credentialResolver.js');
const SECRET = path.join(ROOT, 'backend/src/services/auth/secretStore.js');

const SUITES = [
  'backend/src/services/auth/ClaudeCodeAuthManager.test.js',
  'backend/src/services/auth/credentialResolver.test.js',
  'backend/src/services/auth/secretStore.test.js',
  'backend/src/services/auth/agntCredentialStore.test.js',
];

const MUTATIONS = [
  {
    name: 'issue #82: remove the keychain discovery tier',
    file: CLAUDE,
    find: '    {\n      tier: TIER.SECRET_STORE,\n      source: \'claude-keychain\',',
    replace: '    {\n      tier: TIER.SECRET_STORE,\n      source: \'claude-keychain\',\n      __disabled: true,',
    extra: (src) => src.replace(
      'function claudeCandidates() {\n  return [',
      'function claudeCandidates() {\n  return [].concat([',
    ).replace(
      '  ];\n}\n\nfunction resolveClaudeCredential()',
      '  ].filter((c) => !c.__disabled));\n}\n\nfunction resolveClaudeCredential()',
    ),
  },
  {
    name: 'clobber bug: write AGNT tokens back into ~/.claude by assignment',
    file: CLAUDE,
    find: 'function writeClaudeCredentials(oauthData) {\n  agntStore.writeCredential(PROVIDER_ID, { claudeAiOauth: oauthData });\n  clearSecretCache();\n}',
    replace: `function writeClaudeCredentials(oauthData) {
  const credDir = path.join(os.homedir(), '.claude');
  const credPath = resolveClaudeCredentialsPath();
  if (!fs.existsSync(credDir)) fs.mkdirSync(credDir, { recursive: true });
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(credPath, 'utf8')); } catch { /* none */ }
  existing.claudeAiOauth = oauthData;
  fs.writeFileSync(credPath, JSON.stringify(existing, null, 2), 'utf8');
  agntStore.writeCredential(PROVIDER_ID, { claudeAiOauth: oauthData });
  clearSecretCache();
}`,
  },
  {
    name: 'remove the refresh ownership guard (rotate the CLI\'s refresh token)',
    file: CLAUDE,
    find: '    if (resolved && !resolved.ownedByAgnt) {\n      return {\n        success: false,\n        revoked: false,\n        error: \'Credential belongs to the Claude Code CLI; AGNT does not refresh it.\',\n      };\n    }',
    replace: '    // guard removed by mutation',
  },
  {
    name: 'remove the getAccessToken ownership short-circuit',
    file: CLAUDE,
    find: '    if (autoRefresh && !resolved.ownedByAgnt) return token;',
    replace: '    // short-circuit removed by mutation',
  },
  {
    name: 'ownership discriminator always says "not the CLI"',
    file: CLAUDE,
    find: '  return CLI_ONLY_KEYS.some((key) => oauth[key] !== undefined);',
    replace: '  return false;',
  },
  {
    name: 'resolver ignores ownership declared by read()',
    file: RESOLVER,
    find: '    const ownedByAgnt = typeof normalized.ownedByAgnt === \'boolean\'\n      ? normalized.ownedByAgnt\n      : typeof candidate.ownedByAgnt === \'boolean\'',
    replace: '    const ownedByAgnt = typeof candidate.ownedByAgnt === \'boolean\'\n      ? candidate.ownedByAgnt\n      : typeof candidate.ownedByAgnt === \'boolean\'',
  },
  {
    name: 'secret store: drop the spawn timeout',
    file: SECRET,
    find: '      timeout: LOOKUP_TIMEOUT_MS,',
    replace: '',
  },
  {
    name: 'secret store: ignore the opt-out',
    file: SECRET,
    find: "  if (String(env.AGNT_DISABLE_SECRET_STORE || '') === '1') return null;\n\n  // Windows has no user-level",
    replace: '  // opt-out removed by mutation\n\n  // Windows has no user-level',
  },
  {
    name: 'secret store: never cache (prompt storm)',
    file: SECRET,
    find: '  if (hit && nowMs - hit.at < CACHE_TTL_MS) return hit.value;',
    replace: '  if (false) return hit.value;',
  },
  {
    name: 'secret store: read the keychain on Windows too',
    file: SECRET,
    find: "  if (platform !== 'darwin' && platform !== 'linux') return null;",
    replace: '  // platform gate removed by mutation',
  },
];

// Spawn the real node binary against vitest's ESM entry rather than the .cmd
// shim: since the CVE-2024-27980 fix Node refuses to spawn .cmd/.bat without a
// shell, and shell:true would drag cmd.exe quoting into the loop.
const VITEST_ENTRY = path.join(ROOT, 'node_modules/vitest/vitest.mjs');

function runSuites() {
  const result = spawnSync(
    process.execPath,
    [VITEST_ENTRY, 'run', ...SUITES, '--reporter=dot'],
    { cwd: ROOT, encoding: 'utf8', shell: false },
  );
  if (result.error) {
    console.error('  spawn failed:', result.error.message);
    return false;
  }
  return result.status === 0;
}

console.log('Baseline (unmutated) …');
if (!runSuites()) {
  console.error('FATAL: the suite is not green before mutation. Fix that first.');
  process.exit(1);
}
console.log('  baseline GREEN\n');

let survivors = 0;

for (const mutation of MUTATIONS) {
  const original = fs.readFileSync(mutation.file, 'utf8');

  let mutated = original;
  if (mutation.find) {
    if (!original.includes(mutation.find)) {
      console.error(`SKIP (anchor missing): ${mutation.name}`);
      survivors++;
      continue;
    }
    mutated = original.replace(mutation.find, mutation.replace);
  }
  if (mutation.extra) mutated = mutation.extra(mutated);

  fs.writeFileSync(mutation.file, mutated);
  let green;
  try {
    green = runSuites();
  } finally {
    fs.writeFileSync(mutation.file, original);
  }

  if (green) {
    console.error(`  SURVIVED  ${mutation.name}  <-- no test catches this`);
    survivors++;
  } else {
    console.log(`  killed    ${mutation.name}`);
  }
}

console.log('');
if (survivors > 0) {
  console.error(`${survivors} mutation(s) survived — the suite has blind spots.`);
  process.exit(1);
}
console.log(`All ${MUTATIONS.length} mutations killed. The suite bites.`);
