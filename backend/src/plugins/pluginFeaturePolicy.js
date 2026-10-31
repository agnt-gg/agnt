/** Owner grants apply across verified official plugins, never from a package's own trust claims. */
export const PLUGIN_FEATURES = Object.freeze([
  { id: 'network', label: 'Internet access' },
  { id: 'filesystem', label: 'Filesystem access' },
  { id: 'spawn-process', label: 'Run processes' },
  { id: 'env-access', label: 'Read environment variables' },
  { id: 'dynamic-eval', label: 'Execute dynamic code' },
  { id: 'dynamic-import', label: 'Load dynamic modules' },
]);
const REQUIREMENTS = Object.freeze({ network: ['network'], filesystem: ['filesystem'],
  'spawn-process': ['spawn-process'], 'env-access': ['env-access'],
  'dynamic-eval': ['dynamic-eval'], 'dynamic-import': ['dynamic-import'] });
export const DEFAULT_FEATURES = Object.freeze(['network']);

export function pluginFeatureGrant(name, report, policy = {}) {
  if (!report || report.success === false || !report.valid || report.integrityState !== 'verified') return null;
  if ((policy.blockedPlugins || []).includes(name)) return null;
  if ((policy.preApproved || []).includes(name)) return 'pre-approved';
  if (report.trustTier !== 'official') return null;
  if (policy.membersAllOfficial === true) return 'all-official';
  // A missing scan is not an empty scan. Unknown capabilities always need approval.
  if (!report.detected || typeof report.detected !== 'object' || Array.isArray(report.detected)) return null;
  const allowed = new Set(policy.allowedFeatures || DEFAULT_FEATURES);
  return Object.keys(report.detected).every(capability => REQUIREMENTS[capability]?.every(feature => allowed.has(feature)))
    ? 'features' : null;
}

export function pluginEntryGrant(entry, policy) {
  if (!entry || entry.scanFailed || !Array.isArray(entry.detectedCapabilities)) return null;
  return pluginFeatureGrant(entry.name, { ...entry, valid: true,
    detected: Object.fromEntries(entry.detectedCapabilities.map(capability => [capability, true])) }, policy);
}
