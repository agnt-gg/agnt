import { BUILTIN_RULES } from '@agnt-gg/nope';

export const SECURITY_MODES = ['off', 'observe', 'balanced', 'strict', 'custom'];
export const SECURITY_DECISIONS = ['allow', 'audit', 'block'];
export const OUTPUT_SCANNING_MODES = ['off', 'report', 'enforce'];

const PRESET_SEVERITIES = {
  off: { critical: 'allow', high: 'allow', medium: 'allow', low: 'allow' },
  observe: { critical: 'audit', high: 'audit', medium: 'audit', low: 'audit' },
  balanced: { critical: 'block', high: 'audit', medium: 'audit', low: 'audit' },
  strict: { critical: 'block', high: 'block', medium: 'audit', low: 'audit' },
};

export const BALANCED_RULE_OVERRIDES = {
  'cred-env-file-send': 'audit',
  'net-ssrf-private-10': 'audit',
  'net-ssrf-private-172': 'audit',
  'net-ssrf-private-192': 'audit',
  'net-ssrf-ipv6-private': 'audit',
};

export const DEFAULT_SECURITY_POLICY = Object.freeze({
  version: 1,
  mode: 'balanced',
  severityDecisions: { ...PRESET_SEVERITIES.balanced },
  categoryOverrides: {},
  ruleOverrides: { ...BALANCED_RULE_OVERRIDES },
  outputScanning: 'report',
});

const RULE_IDS = new Set(BUILTIN_RULES.map((rule) => rule.id));
const CATEGORIES = new Set(BUILTIN_RULES.map((rule) => rule.category));

function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
}

function validateDecisionMap(value, field, allowedKeys) {
  assertPlainObject(value, field);
  const result = {};
  for (const [key, decision] of Object.entries(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(`Unknown ${field} key: ${key}`);
    if (!SECURITY_DECISIONS.includes(decision)) throw new TypeError(`Invalid security decision: ${decision}`);
    result[key] = decision;
  }
  return result;
}

export function normalizeSecurityPolicy(input = {}) {
  assertPlainObject(input, 'policy');
  const mode = input.mode ?? DEFAULT_SECURITY_POLICY.mode;
  if (!SECURITY_MODES.includes(mode)) throw new TypeError(`Invalid security mode: ${mode}`);
  const outputScanning = input.outputScanning ?? DEFAULT_SECURITY_POLICY.outputScanning;
  if (!OUTPUT_SCANNING_MODES.includes(outputScanning)) throw new TypeError(`Invalid output scanning mode: ${outputScanning}`);

  const preset = PRESET_SEVERITIES[mode] || PRESET_SEVERITIES.balanced;
  const severityDecisions = mode === 'custom'
    ? validateDecisionMap(input.severityDecisions ?? DEFAULT_SECURITY_POLICY.severityDecisions, 'severityDecisions', new Set(['critical', 'high', 'medium', 'low']))
    : { ...preset };

  const categoryOverrides = validateDecisionMap(input.categoryOverrides ?? {}, 'categoryOverrides', CATEGORIES);
  const submittedRuleOverrides = validateDecisionMap(input.ruleOverrides ?? {}, 'ruleOverrides', RULE_IDS);
  const ruleOverrides = mode === 'balanced'
    ? { ...BALANCED_RULE_OVERRIDES, ...submittedRuleOverrides }
    : submittedRuleOverrides;

  return {
    version: 1,
    mode,
    severityDecisions,
    categoryOverrides,
    ruleOverrides,
    outputScanning,
  };
}

export function mergeSecurityPolicies(accountPolicy, workflowPolicy) {
  const account = normalizeSecurityPolicy(accountPolicy || {});
  if (!workflowPolicy || workflowPolicy.inherit !== false) return account;

  // inherit:false means the workflow owns its action policy. Keep the account's
  // output-scanning choice unless the workflow explicitly supplies one, but do
  // not leak account category/rule overrides into an Off/Observe/Strict mode.
  return normalizeSecurityPolicy({
    ...workflowPolicy,
    outputScanning: workflowPolicy.outputScanning ?? account.outputScanning,
  });
}

export function resolveViolationDecision(violation, policy) {
  const normalized = normalizeSecurityPolicy(policy || {});
  if (normalized.ruleOverrides[violation.rule]) {
    return { decision: normalized.ruleOverrides[violation.rule], source: 'rule' };
  }
  if (normalized.categoryOverrides[violation.category]) {
    return { decision: normalized.categoryOverrides[violation.category], source: 'category' };
  }
  return {
    decision: normalized.severityDecisions[violation.severity] || 'audit',
    source: 'severity',
  };
}

export function resolveCredentialDecision(policy) {
  return resolveViolationDecision({
    rule: 'cred-api-key-leak',
    category: 'credentials',
    severity: 'high',
  }, policy).decision;
}

export function getSecurityRuleCatalog() {
  return BUILTIN_RULES.map(({ id, description, severity, category }) => ({ id, description, severity, category }));
}
